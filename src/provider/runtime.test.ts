import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createPublicClient, custom, type Hex, numberToHex } from "viem"
import { base, optimism } from "viem/chains"
import { getSliceWalletP256SignerId } from "../p256"
import {
  getWalletPermissionId,
  serializeWalletPolicyDescriptor
} from "../policy"
import { buildRecoveryPermissionInitConfig } from "../recovery"
import { parseSliceWalletUncompressedPublicKey } from "../rootValidator"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletRegistryCredential
} from "../types"
import type {
  SliceWalletProviderConfig,
  StoredGenericGrant,
  StoredGenericGrantRotation
} from "../types/providerInternal"
import {
  assertSliceWalletDeployedRootIdentity,
  assertSliceWalletRegistryAccountIdentity,
  createSliceWalletProviderRuntime,
  deriveSliceWalletRegistryAccountAddress,
  executeSliceWalletGenericGrantReplacement,
  getSliceWalletGenericGrantInstallationAction,
  resumeSliceWalletGenericGrantReplacement,
  submitSliceWalletGenericGrantInstallation
} from "./runtime"
import {
  readStoredSliceWalletAccount,
  writeStoredSliceWalletAccount
} from "./storage"

type RuntimeDependencies = NonNullable<
  Parameters<typeof createSliceWalletProviderRuntime>[1]
>
type ChainRuntimeFactory = NonNullable<
  RuntimeDependencies["createChainRuntime"]
>
type ChainRuntime = ReturnType<ChainRuntimeFactory>

const account = "0x0000000000000000000000000000000000000001" as const
const secondAccount = "0x0000000000000000000000000000000000000002" as const
const userOperationHash = `0x${"11".repeat(32)}` as const
const credentialIdHash = `0x${"22".repeat(32)}` as const
const rootPublicKey = `0x04${"33".repeat(64)}` as const
const storedAccount = (
  accountAddress: typeof account | typeof secondAccount
) => ({
  accountAddress,
  accountIndex: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  credentialIdHash,
  factoryVersion: "1",
  publicKey: rootPublicKey,
  recoveryPermissionId: null,
  recoverySignerAddress: null,
  registrationKind: "initial" as const
})
const storageValues = new Map<string, string>()
const storage = {
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  get length() {
    return storageValues.size
  },
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => storageValues.delete(key),
  setItem: (key: string, value: string) => storageValues.set(key, value)
} satisfies Storage

const config = {
  chains: [
    {
      bundlerUrl: "https://bundler.example/base",
      chain: base,
      rpcUrl: "https://rpc.example/base"
    },
    {
      bundlerUrl: "https://bundler.example/op",
      chain: optimism,
      rpcUrl: "https://rpc.example/op"
    }
  ],
  defaultChainId: base.id,
  document: Object.create(null) as Document,
  idOrigin: "https://id.slice.so",
  storage,
  window: Object.assign(Object.create(null) as Window, {
    crypto: globalThis.crypto,
    location: { href: "https://dapp.example" }
  })
} satisfies SliceWalletProviderConfig

beforeEach(() => storageValues.clear())

const createRotationGrant = (publicKey: Hex): StoredGenericGrant => {
  const policy = {
    account,
    calls: [
      {
        parameterRules: [],
        selector: "0x00000000",
        target: secondAccount,
        valueLimit: 1n
      }
    ],
    chainId: base.id,
    grantKind: "generic",
    rateLimit: { count: 1, intervalSec: 3600 },
    validAfter: 1_800_000_000,
    validUntil: 1_800_003_600,
    version: 1
  } as const
  const signerId = getSliceWalletP256SignerId(publicKey)
  return {
    account,
    chainId: base.id,
    createdAt: 1_800_000_000,
    enableSignature: "0x1234",
    expiresAt: policy.validUntil,
    permissionId: getWalletPermissionId(policy, signerId),
    permissions: [
      {
        data: {
          maximumValue: "0x1",
          recipient: secondAccount,
          template: "native-transfer"
        },
        policies: [
          {
            data: { count: 1, intervalSec: 3600 },
            type: "rate-limit"
          }
        ],
        type: "slice-call"
      }
    ],
    policy: serializeWalletPolicyDescriptor(policy),
    publicKey,
    signerId
  }
}

const createRotation = (
  phase: Exclude<
    StoredGenericGrantRotation["phase"],
    "submitted" | "transport-pending"
  > = "prepared"
): StoredGenericGrantRotation => ({
  phase,
  predecessor: createRotationGrant(`0x04${"55".repeat(64)}`),
  replacement: createRotationGrant(`0x04${"66".repeat(64)}`),
  version: 2
})

const installation = {
  callDataHash: `0x${"77".repeat(32)}` as Hex,
  entryPoint: secondAccount,
  nonce: "0x1" as Hex,
  sender: account,
  userOperationHash
}

const createSubmittedRotation = (
  phase: "submitted" | "transport-pending" = "submitted"
): StoredGenericGrantRotation => ({
  ...createRotation(),
  phase,
  installation
})

const updateRotationPhase = (
  rotation: StoredGenericGrantRotation,
  phase: StoredGenericGrantRotation["phase"],
  nextInstallation:
    | StoredGenericGrantRotation["installation"]
    | null
    | undefined = rotation.installation
): StoredGenericGrantRotation => {
  const { installation: _installation, ...rest } = rotation
  const base = {
    predecessor: rest.predecessor,
    replacement: rest.replacement,
    version: 2 as const
  }
  if (phase === "prepared") return { ...base, phase }
  if (phase === "submitted" || phase === "transport-pending") {
    if (nextInstallation === null || nextInstallation === undefined) {
      throw new Error("Test transport phase requires installation identity.")
    }
    return { ...base, installation: nextInstallation, phase }
  }
  return {
    ...base,
    ...(nextInstallation === null || nextInstallation === undefined
      ? {}
      : { installation: nextInstallation }),
    phase
  }
}

describe("generic grant replacement ordering", () => {
  test("installs and verifies before disabling, then commits last", async () => {
    const events: string[] = []

    const result = await executeSliceWalletGenericGrantReplacement({
      authorize: async () => {
        events.push("authorize")
        return "authorization"
      },
      commit: async (authorization) => {
        events.push(`commit:${authorization}`)
        return "complete"
      },
      disablePredecessor: async () => {
        events.push("disable")
      },
      discardPending: async () => {
        events.push("discard")
      },
      installReplacement: async () => {
        events.push("install")
      },
      persistPrepared: async (authorization) => {
        events.push(`persist:${authorization}`)
      },
      verifyReplacement: async () => {
        events.push("verify")
      }
    })

    expect(result).toBe("complete")
    expect(events).toEqual([
      "authorize",
      "persist:authorization",
      "install",
      "verify",
      "disable",
      "commit:authorization"
    ])
  })

  test("keeps both validations and the replacement key retryable when predecessor disablement fails", async () => {
    const events: string[] = []
    const failure = new Error("predecessor disablement failed")

    await expect(
      executeSliceWalletGenericGrantReplacement({
        authorize: async () => {
          events.push("authorize")
          return "authorization"
        },
        commit: async () => {
          events.push("commit")
        },
        disablePredecessor: async () => {
          events.push("disable")
          throw failure
        },
        discardPending: async () => {
          events.push("discard")
        },
        installReplacement: async () => {
          events.push("install")
        },
        persistPrepared: async () => {
          events.push("persist")
        },
        verifyReplacement: async () => {
          events.push("verify")
        }
      })
    ).rejects.toBe(failure)
    expect(events).toEqual([
      "authorize",
      "persist",
      "install",
      "verify",
      "disable"
    ])
  })

  test("discards a replacement when its journal is rejected before submission", async () => {
    const events: string[] = []
    const failure = new Error("rotation storage rejected")

    await expect(
      executeSliceWalletGenericGrantReplacement({
        authorize: async () => {
          events.push("authorize")
          return "authorization"
        },
        commit: async () => {
          events.push("commit")
        },
        disablePredecessor: async () => {
          events.push("disable")
        },
        discardPending: async () => {
          events.push("discard")
        },
        installReplacement: async () => {
          events.push("install")
        },
        persistPrepared: async () => {
          events.push("persist")
          throw failure
        },
        verifyReplacement: async () => {
          events.push("verify")
        }
      })
    ).rejects.toBe(failure)
    expect(events).toEqual(["authorize", "persist", "discard"])
  })

  test("retries once after root passkey signing is cancelled before transport", async () => {
    const cancellation = new Error("passkey cancelled")
    let journal = createRotation()
    let prepareCount = 0
    let signCount = 0
    let transportCount = 0
    const submit = () =>
      submitSliceWalletGenericGrantInstallation({
        initialRotation: journal,
        isDefiniteTransportRejection: () => false,
        prepare: async () => {
          prepareCount += 1
          return "prepared"
        },
        setPhase: async (rotation, phase, nextInstallation) => {
          journal = updateRotationPhase(rotation, phase, nextInstallation)
          return journal
        },
        sign: async () => {
          signCount += 1
          if (signCount === 1) throw cancellation
          return { installation, request: "signed" }
        },
        transport: async () => {
          transportCount += 1
          return userOperationHash
        }
      })

    await expect(submit()).rejects.toBe(cancellation)
    expect(journal.phase).toBe("prepared")
    expect({ prepareCount, signCount, transportCount }).toEqual({
      prepareCount: 1,
      signCount: 1,
      transportCount: 0
    })

    await expect(submit()).resolves.toMatchObject({
      rotation: { phase: "submitted" }
    })
    expect({ prepareCount, signCount, transportCount }).toEqual({
      prepareCount: 2,
      signCount: 2,
      transportCount: 1
    })
  })

  test("retries once after preparation or estimation fails before signing", async () => {
    const estimationFailure = new Error("gas estimation failed")
    let journal = createRotation()
    let prepareCount = 0
    let signCount = 0
    let transportCount = 0
    const submit = () =>
      submitSliceWalletGenericGrantInstallation({
        initialRotation: journal,
        isDefiniteTransportRejection: () => false,
        prepare: async () => {
          prepareCount += 1
          if (prepareCount === 1) throw estimationFailure
          return "prepared"
        },
        setPhase: async (rotation, phase, nextInstallation) => {
          journal = updateRotationPhase(rotation, phase, nextInstallation)
          return journal
        },
        sign: async () => {
          signCount += 1
          return { installation, request: "signed" }
        },
        transport: async () => {
          transportCount += 1
          return userOperationHash
        }
      })

    await expect(submit()).rejects.toBe(estimationFailure)
    expect(journal.phase).toBe("prepared")
    expect({ prepareCount, signCount, transportCount }).toEqual({
      prepareCount: 1,
      signCount: 0,
      transportCount: 0
    })

    await expect(submit()).resolves.toMatchObject({
      rotation: { phase: "submitted" }
    })
    expect({ prepareCount, signCount, transportCount }).toEqual({
      prepareCount: 2,
      signCount: 1,
      transportCount: 1
    })
  })

  test("retries once after the pre-transport journal write is rejected", async () => {
    const persistenceRejection = new Error("journal write rejected")
    let journal = createRotation()
    let journalWriteCount = 0
    let transportCount = 0
    const submit = () =>
      submitSliceWalletGenericGrantInstallation({
        initialRotation: journal,
        isDefiniteTransportRejection: () => false,
        prepare: async () => "prepared",
        setPhase: async (rotation, phase, nextInstallation) => {
          journalWriteCount += 1
          if (journalWriteCount === 1) throw persistenceRejection
          journal = updateRotationPhase(rotation, phase, nextInstallation)
          return journal
        },
        sign: async () => ({ installation, request: "signed" }),
        transport: async () => {
          transportCount += 1
          return userOperationHash
        }
      })

    await expect(submit()).rejects.toBe(persistenceRejection)
    expect(journal.phase).toBe("prepared")
    expect(transportCount).toBe(0)

    await expect(submit()).resolves.toMatchObject({
      rotation: { phase: "submitted" }
    })
    expect(journalWriteCount).toBe(4)
    expect(transportCount).toBe(1)
  })

  test("restores prepared state after a definite bundler rejection", async () => {
    const rejection = new Error("bundler rejected operation")
    let journal = createRotation()
    let transportCount = 0
    const submit = () =>
      submitSliceWalletGenericGrantInstallation({
        initialRotation: journal,
        isDefiniteTransportRejection: (error) => error === rejection,
        prepare: async () => "prepared",
        setPhase: async (rotation, phase, nextInstallation) => {
          journal = updateRotationPhase(rotation, phase, nextInstallation)
          return journal
        },
        sign: async () => ({ installation, request: "signed" }),
        transport: async () => {
          transportCount += 1
          if (transportCount === 1) throw rejection
          return userOperationHash
        }
      })

    await expect(submit()).rejects.toBe(rejection)
    expect(journal).toMatchObject({ phase: "prepared" })
    expect(journal.installation).toBeUndefined()
    expect(transportCount).toBe(1)

    await expect(submit()).resolves.toMatchObject({
      rotation: { phase: "submitted" }
    })
    expect(transportCount).toBe(2)
  })

  test("records the hash before transport and never duplicates an ambiguous submission", async () => {
    const events: string[] = []
    const responseLoss = new Error("response lost")
    let journal = createRotation()
    let transportCount = 0

    await expect(
      submitSliceWalletGenericGrantInstallation({
        initialRotation: journal,
        isDefiniteTransportRejection: () => false,
        prepare: async () => {
          events.push("prepare")
          return "prepared"
        },
        setPhase: async (rotation, phase, nextInstallation) => {
          journal = updateRotationPhase(rotation, phase, nextInstallation)
          events.push(`phase:${phase}`)
          return journal
        },
        sign: async () => {
          events.push("sign")
          return { installation, request: "signed" }
        },
        transport: async () => {
          transportCount += 1
          events.push("transport")
          throw responseLoss
        }
      })
    ).rejects.toBe(responseLoss)

    expect(events).toEqual([
      "prepare",
      "sign",
      "phase:transport-pending",
      "transport"
    ])
    expect(journal).toMatchObject({
      installation: { userOperationHash },
      phase: "transport-pending"
    })
    expect(
      getSliceWalletGenericGrantInstallationAction({
        finalizedBlockNumber: null,
        installed: false,
        receipt: null,
        rotation: journal
      })
    ).toBe("wait")
    expect(transportCount).toBe(1)

    const finalized = await resumeSliceWalletGenericGrantReplacement({
      clearJournal: async () => {
        events.push("clear")
      },
      disablePredecessor: async () => {
        events.push("disable")
      },
      ensureFrameCommitted: async () => {
        events.push("frame")
      },
      ensureInstalled: async (rotation) => {
        expect(
          getSliceWalletGenericGrantInstallationAction({
            finalizedBlockNumber: null,
            installed: true,
            receipt: null,
            rotation
          })
        ).toBe("installed")
        return updateRotationPhase(rotation, "installed")
      },
      initialRotation: journal,
      persistActiveGrant: async () => {
        events.push("active")
      },
      setPhase: async (rotation, phase) => {
        journal = updateRotationPhase(rotation, phase)
        events.push(`phase:${phase}`)
        return journal
      },
      verifyFinalized: async () => {
        events.push("verify")
      }
    })
    expect(finalized.phase).toBe("active-grant-committed")
    expect(transportCount).toBe(1)
    expect(events.slice(4)).toEqual([
      "disable",
      "phase:predecessor-disabled",
      "frame",
      "phase:frame-committed",
      "active",
      "phase:active-grant-committed",
      "verify",
      "clear"
    ])
  })

  test("retries only after a reverted installation is definitive", async () => {
    const events: string[] = []
    const receiptFailure = new Error("installation reverted")
    const submitted = createSubmittedRotation()
    let attempt = 0
    expect(
      getSliceWalletGenericGrantInstallationAction({
        finalizedBlockNumber: 9n,
        installed: false,
        receipt: { blockNumber: 10n, success: false },
        rotation: submitted
      })
    ).toBe("wait")
    expect(
      getSliceWalletGenericGrantInstallationAction({
        finalizedBlockNumber: 10n,
        installed: false,
        receipt: { blockNumber: 10n, success: false },
        rotation: submitted
      })
    ).toBe("retry")
    const run = () =>
      resumeSliceWalletGenericGrantReplacement({
        clearJournal: async () => {
          events.push("clear")
        },
        disablePredecessor: async () => {
          events.push("disable")
        },
        ensureFrameCommitted: async () => {
          events.push("frame")
        },
        ensureInstalled: async (rotation) => {
          attempt += 1
          events.push(`install:${attempt}`)
          if (attempt === 1) throw receiptFailure
          return updateRotationPhase(rotation, "installed")
        },
        initialRotation: submitted,
        persistActiveGrant: async () => {
          events.push("active")
        },
        setPhase: async (rotation, phase) => {
          events.push(`phase:${phase}`)
          return updateRotationPhase(rotation, phase)
        },
        verifyFinalized: async () => {
          events.push("verify")
        }
      })

    await expect(run()).rejects.toBe(receiptFailure)
    expect(events).toEqual(["install:1"])
    await expect(run()).resolves.toMatchObject({
      phase: "active-grant-committed"
    })
    expect(events).toEqual([
      "install:1",
      "install:2",
      "disable",
      "phase:predecessor-disabled",
      "frame",
      "phase:frame-committed",
      "active",
      "phase:active-grant-committed",
      "verify",
      "clear"
    ])
  })

  test("resumes finalization after active storage fails post-disablement", async () => {
    const events: string[] = []
    const storageFailure = new Error("active storage unavailable")
    let journal = createRotation("installed")
    let activeAttempts = 0
    const run = () =>
      resumeSliceWalletGenericGrantReplacement({
        clearJournal: async () => {
          events.push("clear")
        },
        disablePredecessor: async () => {
          events.push("disable")
        },
        ensureFrameCommitted: async () => {
          events.push("frame")
        },
        ensureInstalled: async (rotation) => rotation,
        initialRotation: journal,
        persistActiveGrant: async () => {
          activeAttempts += 1
          events.push(`active:${activeAttempts}`)
          if (activeAttempts === 1) throw storageFailure
        },
        setPhase: async (rotation, phase) => {
          journal = updateRotationPhase(rotation, phase)
          events.push(`phase:${phase}`)
          return journal
        },
        verifyFinalized: async () => {
          events.push("verify")
        }
      })

    await expect(run()).rejects.toBe(storageFailure)
    expect(journal.phase).toBe("frame-committed")
    expect(events).toEqual([
      "disable",
      "phase:predecessor-disabled",
      "frame",
      "phase:frame-committed",
      "active:1"
    ])

    await expect(run()).resolves.toMatchObject({
      phase: "active-grant-committed"
    })
    expect(events.slice(5)).toEqual([
      "frame",
      "active:2",
      "phase:active-grant-committed",
      "verify",
      "clear"
    ])
  })
})

describe("registry-outage account identity", () => {
  const offlineClient = createPublicClient({
    chain: base,
    transport: custom({
      async request({ method }) {
        throw new Error(`Unexpected identity-derivation RPC: ${method}`)
      }
    })
  })
  const alternateRootPublicKey = `0x04${"44".repeat(64)}` as const

  const createCredential = async (
    overrides: Partial<SliceWalletRegistryCredential> = {}
  ): Promise<SliceWalletRegistryCredential> => {
    const seed = {
      accountAddress: account,
      accountIndex: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      credentialIdHash,
      factoryVersion: "1",
      publicKey: rootPublicKey,
      recoveryPermissionId: null,
      recoverySignerAddress: null,
      registrationKind: "initial" as const,
      ...overrides
    }
    const derived = await deriveSliceWalletRegistryAccountAddress({
      client: offlineClient,
      credential: seed
    })
    return { ...seed, accountAddress: derived.address }
  }

  test("accepts valid undeployed and deployed local snapshots", async () => {
    const credential = await createCredential()
    await expect(
      assertSliceWalletRegistryAccountIdentity({
        client: offlineClient,
        credential
      })
    ).resolves.toMatchObject({ address: credential.accountAddress })

    const coordinates = parseSliceWalletUncompressedPublicKey(
      credential.publicKey
    )
    expect(() =>
      assertSliceWalletDeployedRootIdentity({
        credential,
        currentRoot: coordinates
      })
    ).not.toThrow()
  })

  test("rejects tampered address, index, root, and recovery metadata", async () => {
    const credential = await createCredential()
    const tamperedSnapshots = [
      { ...credential, accountAddress: secondAccount },
      { ...credential, accountIndex: 1 },
      { ...credential, publicKey: alternateRootPublicKey }
    ] satisfies readonly SliceWalletRegistryCredential[]

    for (const tampered of tamperedSnapshots) {
      await expect(
        assertSliceWalletRegistryAccountIdentity({
          client: offlineClient,
          credential: tampered
        })
      ).rejects.toThrow("does not match its root")
    }

    const recoverySignerAddress =
      "0x0000000000000000000000000000000000000011" as const
    const recovery = await buildRecoveryPermissionInitConfig({
      client: offlineClient,
      recoverySignerAddress
    })
    const recovered = await createCredential({
      recoveryPermissionId: recovery.permissionId,
      recoverySignerAddress
    })
    await expect(
      assertSliceWalletRegistryAccountIdentity({
        client: offlineClient,
        credential: {
          ...recovered,
          recoverySignerAddress: "0x0000000000000000000000000000000000000012"
        }
      })
    ).rejects.toThrow("recovery metadata is inconsistent")
    await expect(
      assertSliceWalletRegistryAccountIdentity({
        client: offlineClient,
        credential: {
          ...recovered,
          recoveryPermissionId: "0x01020304"
        }
      })
    ).rejects.toThrow("recovery metadata is inconsistent")
  })

  test("rejects a deployed account whose root coordinates were changed", async () => {
    const credential = await createCredential()
    const tamperedCoordinates = parseSliceWalletUncompressedPublicKey(
      alternateRootPublicKey
    )
    expect(() =>
      assertSliceWalletDeployedRootIdentity({
        credential,
        currentRoot: tamperedCoordinates
      })
    ).toThrow("does not match local metadata")
  })
})

const createRuntimeFixture = (
  override?: (chainId: number, creation: number) => Partial<ChainRuntime>
) => {
  const brokerByChain = new Map<number, SliceWalletCeremonyBroker>()
  const callsByChain = new Map<number, Set<string>>()
  const lockAccountByChain = new Map<number, ReturnType<typeof mock>>()
  const sendCallsByChain = new Map<number, ReturnType<typeof mock>>()
  const revokeGrantByChain = new Map<number, ReturnType<typeof mock>>()
  const statusChains: number[] = []
  let creation = 0
  const createChainRuntime: ChainRuntimeFactory = (chainConfig) => {
    creation += 1
    brokerByChain.set(chainConfig.chain.id, chainConfig.ceremonyBroker)
    const calls = new Set<string>()
    callsByChain.set(chainConfig.chain.id, calls)
    const sendCalls = mock(async (_calls, requestedId?: string) => ({
      id: requestedId ?? `call-${chainConfig.chain.id}`,
      userOperationHash
    }))
    sendCallsByChain.set(chainConfig.chain.id, sendCalls)
    const revokeGrant = mock(async () => undefined)
    revokeGrantByChain.set(chainConfig.chain.id, revokeGrant)
    const lockAccount = mock(async () => undefined)
    lockAccountByChain.set(chainConfig.chain.id, lockAccount)
    const runtime = {
      chainId: chainConfig.chain.id,
      chooseAccount: mock(async () => null as never),
      commitAccount: mock(() => null as never),
      connect: mock(async () => null as never),
      connectWithSession: mock(async () => null as never),
      createGrant: mock(async () => null as never),
      destroy: mock(() => undefined),
      forwardRpc: mock(async () => ({ handled: false as const })),
      getAccounts: mock(async () => [account]),
      getCallsStatus: mock(async (id: string) => {
        statusChains.push(chainConfig.chain.id)
        return {
          atomic: true,
          chainId: numberToHex(chainConfig.chain.id),
          id,
          status: 100 as const,
          version: "2.0.0" as const
        }
      }),
      getGrants: mock(async () => []),
      hasCall: (id: string) => calls.has(id),
      lockAccount,
      paymasterAvailable: false,
      revokeGrant,
      requestSession: mock(async () => ({
        status: "preparation_failed" as const
      })),
      rotateGrant: mock(async () => null as never),
      sendCalls,
      signMessage: mock(async () => userOperationHash),
      signTypedData: mock(async () => userOperationHash),
      waitForSuccessfulUserOperation: mock(async () => null as never)
    } satisfies ChainRuntime
    return { ...runtime, ...override?.(chainConfig.chain.id, creation) }
  }
  return {
    brokerByChain,
    callsByChain,
    createChainRuntime,
    lockAccountByChain,
    revokeGrantByChain,
    sendCallsByChain,
    statusChains
  }
}

describe("multichain provider runtime routing", () => {
  test("forwards the configured ceremony surface to account connection", async () => {
    const stopped = new Error("stop after capturing account ceremony input")
    const connectAccount = mock(async () => {
      throw stopped
    })
    const runtime = createSliceWalletProviderRuntime(
      { ...config, ceremonyMode: "auto" },
      {
        acquireFrame: async () => ({
          destroy: () => undefined,
          request: async () => null
        }),
        connectAccount
      }
    )

    await expect(runtime.connect()).rejects.toBe(stopped)
    expect(connectAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        ceremonyMode: "auto",
        document: config.document
      })
    )
  })

  test("routes calls to an inactive configured chain", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)

    await runtime.sendCalls([], "op-call", undefined, optimism.id)

    expect(fixture.sendCallsByChain.get(optimism.id)).toHaveBeenCalledWith(
      [],
      "op-call",
      undefined
    )
    expect(fixture.sendCallsByChain.has(base.id)).toBe(false)
  })

  test("finds an in-memory call after switching away from its chain", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(optimism.id)
    fixture.callsByChain.get(optimism.id)?.add("op-call")
    runtime.switchChain(optimism.id)
    runtime.switchChain(base.id)

    await runtime.getCallsStatus("op-call")

    expect(fixture.statusChains).toEqual([optimism.id])
  })

  test("keeps the account retryable after a partial permission revocation failure", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(optimism.id)
    const failure = new Error("onchain revoke failed")
    fixture.revokeGrantByChain
      .get(optimism.id)
      ?.mockImplementation(async () => {
        throw failure
      })
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    try {
      await runtime.revokePermissions()
      throw new Error("Expected permission revocation to fail.")
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([failure])
    }
    expect(readStoredSliceWalletAccount(storage)).toEqual(
      storedAccount(account)
    )
  })

  test("disconnect locks the account without revoking persistent grants", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(optimism.id)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    await runtime.disconnect()

    expect(readStoredSliceWalletAccount(storage)).toBeNull()
    expect(fixture.lockAccountByChain.get(optimism.id)).toHaveBeenCalledWith(
      account
    )
    expect(fixture.lockAccountByChain.has(base.id)).toBe(false)
    expect(fixture.revokeGrantByChain.get(optimism.id)).not.toHaveBeenCalled()
  })

  test("disconnect creates a signer frame when no chain runtime is active", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    await runtime.disconnect()

    expect(fixture.lockAccountByChain.get(base.id)).toHaveBeenCalledWith(
      account
    )
    expect(readStoredSliceWalletAccount(storage)).toBeNull()
  })

  test("clears the stored account after every chain revokes successfully", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    expect(await runtime.revokePermissions()).toBe(true)

    expect(readStoredSliceWalletAccount(storage)).toBeNull()
    const baseRevocation = fixture.revokeGrantByChain.get(base.id)
    const optimismRevocation = fixture.revokeGrantByChain.get(optimism.id)
    if (baseRevocation === undefined || optimismRevocation === undefined) {
      throw new Error("Missing chain revocation fixture.")
    }
    expect(baseRevocation).toHaveBeenCalledTimes(1)
    expect(optimismRevocation).toHaveBeenCalledTimes(1)
    expect(fixture.lockAccountByChain.get(base.id)).toHaveBeenCalledWith(
      account
    )
  })

  test("reports when permission revocation had no stored account", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)

    expect(await runtime.revokePermissions()).toBe(false)
  })

  test("cancels pending ceremonies on chain changes and teardown", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(base.id)
    const broker = fixture.brokerByChain.get(base.id)
    if (broker === undefined) throw new Error("Missing runtime broker.")
    const switched = broker.defer({
      kind: "grant",
      reason: "popup_blocked",
      resume: async () => userOperationHash
    })
    runtime.switchChain(optimism.id)
    await expect(switched).rejects.toThrow("cancelled")
    expect(runtime.pendingCeremony).toBeNull()

    const teardown = broker.defer({
      kind: "root_sign",
      reason: "user_activation_expired",
      resume: async () => userOperationHash
    })
    runtime.destroy()
    await expect(teardown).rejects.toThrow("cancelled")
  })

  test("keeps a switch to B when hydration of A resolves afterward", async () => {
    let resolveHydration = (_wallet: {
      rootAccount: { address: typeof account }
    }) => {}
    const hydration = new Promise<{ rootAccount: { address: typeof account } }>(
      (resolve) => {
        resolveHydration = resolve
      }
    )
    const selection = {
      connected: {
        ...storedAccount(secondAccount),
        accountIndex: 1
      }
    }
    const fixture = createRuntimeFixture((_chainId, creation) =>
      creation === 1
        ? { connect: mock(() => hydration as never) }
        : {
            chooseAccount: mock(async () => selection as never),
            commitAccount: mock(() => {
              writeStoredSliceWalletAccount(storage, selection.connected)
              return { rootAccount: { address: secondAccount } } as never
            })
          }
    )
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    const staleHydration = runtime.connect()
    const switched = await runtime.switchAccount()
    resolveHydration({ rootAccount: { address: account } })
    await staleHydration

    expect(switched.rootAccount.address).toBe(secondAccount)
    expect(readStoredSliceWalletAccount(storage)?.accountAddress).toBe(
      secondAccount
    )
  })

  test("an old hydration finally cannot clear the current runtime identity", async () => {
    let resolveHydration = (_wallet: {
      rootAccount: { address: typeof account }
    }) => {}
    const hydration = new Promise<{ rootAccount: { address: typeof account } }>(
      (resolve) => {
        resolveHydration = resolve
      }
    )
    const selection = {
      connected: {
        ...storedAccount(secondAccount),
        accountIndex: 1
      }
    }
    const fixture = createRuntimeFixture((_chainId, creation) =>
      creation === 1
        ? { connect: mock(() => hydration as never) }
        : {
            chooseAccount: mock(async () => selection as never),
            commitAccount: mock(() => {
              writeStoredSliceWalletAccount(storage, selection.connected)
              return { rootAccount: { address: secondAccount } } as never
            }),
            connect: mock(
              async () =>
                ({
                  rootAccount: { address: secondAccount }
                }) as never
            )
          }
    )
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    const staleHydration = runtime.connect()
    await runtime.switchAccount()
    resolveHydration({ rootAccount: { address: account } })
    await staleHydration

    expect((await runtime.connect()).rootAccount.address).toBe(secondAccount)
  })

  test("cancels an open signer frame before switching to B", async () => {
    const selection = {
      connected: {
        ...storedAccount(secondAccount),
        accountIndex: 1
      }
    }
    const fixture = createRuntimeFixture(() => ({
      chooseAccount: mock(async () => selection as never),
      commitAccount: mock(
        () =>
          ({
            rootAccount: { address: secondAccount }
          }) as never
      )
    }))
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))
    runtime.getChainRuntime()
    const broker = fixture.brokerByChain.get(base.id)
    if (broker === undefined) throw new Error("Missing runtime broker.")
    const pending = broker.defer({
      kind: "root_sign",
      reason: "popup_blocked",
      resume: async () => userOperationHash
    })

    await runtime.switchAccount()

    await expect(pending).rejects.toThrow("cancelled")
  })

  test("keeps A when the account chooser is cancelled", async () => {
    const fixture = createRuntimeFixture(() => ({
      chooseAccount: mock(async () => {
        throw new Error("chooser cancelled")
      }),
      connect: mock(
        async () => ({ rootAccount: { address: account } }) as never
      )
    }))
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    await expect(runtime.switchAccount()).rejects.toThrow("chooser cancelled")
    expect(readStoredSliceWalletAccount(storage)?.accountAddress).toBe(account)
  })

  test("keeps A when chooser lookup throws before commit", async () => {
    const fixture = createRuntimeFixture(() => ({
      chooseAccount: mock(async () => {
        throw new Error("registry lookup failed")
      }),
      connect: mock(
        async () => ({ rootAccount: { address: account } }) as never
      )
    }))
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    await expect(runtime.switchAccount()).rejects.toThrow(
      "registry lookup failed"
    )
    expect(readStoredSliceWalletAccount(storage)?.accountAddress).toBe(account)
  })

  test("keeps B active when switching chains after an account switch", async () => {
    const selection = {
      connected: {
        ...storedAccount(secondAccount),
        accountIndex: 1
      }
    }
    const fixture = createRuntimeFixture(() => ({
      chooseAccount: mock(async () => selection as never),
      commitAccount: mock(() => {
        writeStoredSliceWalletAccount(storage, selection.connected)
        return { rootAccount: { address: secondAccount } } as never
      }),
      connect: mock(
        async () =>
          ({
            rootAccount: {
              address:
                readStoredSliceWalletAccount(storage)?.accountAddress ?? account
            }
          }) as never
      )
    }))
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, storedAccount(account))

    await runtime.switchAccount()
    runtime.switchChain(optimism.id)

    expect((await runtime.connect()).rootAccount.address).toBe(secondAccount)
  })
})
