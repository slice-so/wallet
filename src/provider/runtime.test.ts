import { beforeEach, describe, expect, mock, test } from "bun:test"
import { numberToHex } from "viem"
import { base, optimism } from "viem/chains"
import type { SliceWalletCeremonyBroker } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { createSliceWalletProviderRuntime } from "./runtime"
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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

    try {
      await runtime.revokePermissions()
      throw new Error("Expected permission revocation to fail.")
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([failure])
    }
    expect(readStoredSliceWalletAccount(storage)).toEqual({
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })
  })

  test("disconnect locks the account without revoking persistent grants", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(optimism.id)
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

    await runtime.disconnect()

    expect(readStoredSliceWalletAccount(storage)).toBeNull()
    expect(fixture.lockAccountByChain.get(optimism.id)).toHaveBeenCalledWith(
      account
    )
    expect(fixture.lockAccountByChain.has(base.id)).toBe(false)
    expect(fixture.revokeGrantByChain.get(optimism.id)).not.toHaveBeenCalled()
  })

  test("clears the stored account after every chain revokes successfully", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

    await runtime.revokePermissions()

    expect(readStoredSliceWalletAccount(storage)).toBeNull()
    const baseRevocation = fixture.revokeGrantByChain.get(base.id)
    const optimismRevocation = fixture.revokeGrantByChain.get(optimism.id)
    if (baseRevocation === undefined || optimismRevocation === undefined) {
      throw new Error("Missing chain revocation fixture.")
    }
    expect(baseRevocation).toHaveBeenCalledTimes(1)
    expect(optimismRevocation).toHaveBeenCalledTimes(1)
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
        accountAddress: secondAccount,
        accountIndex: 1,
        credentialIdHash
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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

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
        accountAddress: secondAccount,
        accountIndex: 1,
        credentialIdHash
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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

    const staleHydration = runtime.connect()
    await runtime.switchAccount()
    resolveHydration({ rootAccount: { address: account } })
    await staleHydration

    expect((await runtime.connect()).rootAccount.address).toBe(secondAccount)
  })

  test("cancels an open signer frame before switching to B", async () => {
    const selection = {
      connected: {
        accountAddress: secondAccount,
        accountIndex: 1,
        credentialIdHash
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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })
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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

    await expect(runtime.switchAccount()).rejects.toThrow(
      "registry lookup failed"
    )
    expect(readStoredSliceWalletAccount(storage)?.accountAddress).toBe(account)
  })

  test("keeps B active when switching chains after an account switch", async () => {
    const selection = {
      connected: {
        accountAddress: secondAccount,
        accountIndex: 1,
        credentialIdHash
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
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 0,
      credentialIdHash
    })

    await runtime.switchAccount()
    runtime.switchChain(optimism.id)

    expect((await runtime.connect()).rootAccount.address).toBe(secondAccount)
  })
})
