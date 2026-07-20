"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  isAddress,
  isAddressEqual,
  isHex
} from "viem"
import { anvil } from "viem/chains"
import {
  createKernelPasskeySliceAccountClient,
  createSliceCheckoutPolicyDescriptor,
  createSliceKernelPasskeyTransport,
  createSliceStoreManagementPolicyDescriptor,
  getSliceBundlerApiUrl,
  parseSliceWalletExecutionSessionDescriptor,
  type SliceWalletCheckoutExecutionClient,
  type SliceWalletCheckoutExecutionDelegationSnapshot,
  type SliceWalletExecutionSessionDescriptor,
  type SliceWalletManagementExecutionClient
} from "../execution"
import {
  authorizeSliceWalletSession,
  buildRecoveryPermissionInitConfig,
  buildSliceWalletPermissionRevocationCalls,
  connectSliceWalletAccount,
  connectSliceWalletSignerFrame,
  createSliceWalletCeremonyBroker,
  createSliceWalletCeremonyKernelAccount,
  createSliceWalletPermissionAccount,
  createSliceWalletRegistryClient,
  getSliceWalletCallsHash,
  getSliceWalletChainManifest,
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor,
  parseSliceWalletFrameSession,
  requestSliceWalletSession,
  type SliceWalletCeremonyBroker,
  type SliceWalletFrameSession,
  type SliceWalletPermissionAuthorization,
  type SliceWalletProtocolValue,
  type SliceWalletRegistryCredential,
  type SliceWalletSignerFrameClient,
  serializeWalletPolicyDescriptor
} from "../index"
import { buildRecoveryCancelCall } from "../recovery"
import type { SliceAccountClient } from "../types/accountClient"
import type {
  SliceWalletContextValue,
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletPendingAction,
  SliceWalletProviderProps,
  SliceWalletRecoveryPendingAction,
  SliceWalletRecoverySnapshot,
  SliceWalletStatus,
  StoredSliceWalletExecutionSession
} from "../types/react"
import {
  clearStoredExecutionSession,
  clearStoredPendingReplacement,
  readStoredExecutionSession,
  readStoredPendingReplacement,
  writeStoredExecutionSession,
  writeStoredPendingReplacement
} from "./executionKeyStore"
import {
  getSliceWalletPendingRegistrationAction,
  resumeSliceWalletRegisteredReplacement,
  retrySliceWalletFinalityAction
} from "./permissionLifecycle"
import { useSliceWalletSessionIntegration } from "./sessionIntegration"

const defaultWalletMetadataStorageKey = "slice.passkey-wallet"

/** Default per-grant checkout budget: $100 in micro-USD. */
export const defaultExecutionAllowanceUsdMicros = 100_000_000n

const SliceWalletContext = createContext<SliceWalletContextValue | null>(null)

type SliceWalletRootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

const getCredentialStorage = () =>
  typeof window === "undefined" ? null : window.localStorage

const toCredentialRecord = (
  value: SliceWalletRegistryCredential
): SliceWalletCredentialRecord => {
  if (
    !isHex(value.credentialIdHash, { strict: true }) ||
    !isHex(value.publicKey, { strict: true }) ||
    !isAddress(value.accountAddress) ||
    !Number.isSafeInteger(value.accountIndex) ||
    value.accountIndex < 0
  ) {
    throw new Error("Invalid Slice Wallet registry record.")
  }

  return {
    accountAddress: value.accountAddress,
    accountIndex: value.accountIndex,
    credentialIdHash: value.credentialIdHash,
    publicKey: value.publicKey,
    recoveryPermissionId: value.recoveryPermissionId,
    recoverySignerAddress: value.recoverySignerAddress
  }
}

const readStoredWalletMetadata = (storageKey: string) => {
  const value = getCredentialStorage()?.getItem(storageKey)
  if (value === null || value === undefined) return null
  try {
    const parsed = JSON.parse(value) as {
      accountAddress?: string
      accountIndex?: number
      credentialIdHash?: string
    }
    if (
      !isAddress(parsed.accountAddress ?? "") ||
      !isHex(parsed.credentialIdHash ?? "", { strict: true }) ||
      !Number.isSafeInteger(parsed.accountIndex) ||
      (parsed.accountIndex ?? -1) < 0
    ) {
      return null
    }
    return {
      accountAddress: parsed.accountAddress as Address,
      accountIndex: parsed.accountIndex as number,
      credentialIdHash: parsed.credentialIdHash as Hex
    }
  } catch {
    return null
  }
}

const storeWalletMetadata = (
  storageKey: string,
  credential: SliceWalletCredentialRecord
) => {
  getCredentialStorage()?.setItem(
    storageKey,
    JSON.stringify({
      accountAddress: credential.accountAddress,
      accountIndex: credential.accountIndex,
      credentialIdHash: credential.credentialIdHash
    })
  )
}

const devFundBalanceHex = `0x${(10n * 10n ** 18n).toString(16)}`

/**
 * Dev/staging forks have no paymaster, so the smart account pays its own gas.
 * Anvil exposes unauthenticated state cheatcodes — fund the account directly.
 */
const fundDevWalletAccount = async (chain: Chain, address: Address) => {
  if (chain.id !== anvil.id) return

  const rpcUrl = chain.rpcUrls.default.http[0]
  if (!rpcUrl) return

  try {
    await fetch(rpcUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "anvil_setBalance",
        params: [address, devFundBalanceHex]
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  } catch {
    // Funding is a dev convenience; checkout surfaces any gas shortfall.
  }
}

export function SliceWalletProvider({
  adapters,
  alchemyId,
  capabilities,
  ceremonyMode = "popup",
  children,
  credentialStorageKey = defaultWalletMetadataStorageKey,
  idOrigin,
  notifications,
  preferredChainId,
  session: sessionConfig
}: SliceWalletProviderProps) {
  const checkoutExecution = capabilities?.checkoutExecution
    ? adapters.checkoutExecution
    : undefined
  const fetchWalletRecovery = capabilities?.recovery
    ? adapters.fetchWalletRecovery
    : undefined
  const storeManagement = capabilities?.storeManagement
    ? adapters.storeManagement
    : undefined
  const walletChain = useMemo(
    () => getSliceWalletChainManifest(preferredChainId).chain,
    [preferredChainId]
  )
  const normalizedIdOrigin = useMemo(() => new URL(idOrigin).origin, [idOrigin])
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: walletChain,
        transport: http(
          walletChain.id === 31_337
            ? "http://localhost:8545"
            : `https://base-mainnet.g.alchemy.com/v2/${alchemyId}`
        )
      }),
    [alchemyId, walletChain]
  )
  const [status, setStatus] = useState<SliceWalletStatus>("loading")
  const [pendingAction, setPendingAction] =
    useState<SliceWalletPendingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountAddress, setAccountAddress] = useState<Address | null>(null)
  const [sliceAccountClient, setSliceAccountClient] =
    useState<SliceAccountClient | null>(null)
  const [hasStoredCredential, setHasStoredCredential] = useState(false)
  const [executionSession, setExecutionSession] =
    useState<SliceWalletExecutionSession | null>(null)
  const [managementExecutionSession, setManagementExecutionSession] =
    useState<SliceWalletManagementExecutionSession | null>(null)
  const [recovery, setRecovery] = useState<SliceWalletRecoverySnapshot | null>(
    null
  )
  const warnSession = useCallback(
    (message: string) => {
      console.warn("[slice-wallet]", message)
      notifications?.error?.(message)
    },
    [notifications]
  )
  const sessionIntegration = useSliceWalletSessionIntegration({
    account: accountAddress,
    ...(sessionConfig === undefined
      ? {}
      : {
          adapter: sessionConfig.adapter,
          audience: sessionConfig.audience
        }),
    chainId: walletChain.id,
    warn: warnSession
  })
  const [recoveryPendingAction, setRecoveryPendingAction] =
    useState<SliceWalletRecoveryPendingAction>(null)
  const ceremonyBrokerRef = useRef<SliceWalletCeremonyBroker | null>(null)
  if (ceremonyBrokerRef.current === null) {
    ceremonyBrokerRef.current = createSliceWalletCeremonyBroker()
  }
  const ceremonyBroker = ceremonyBrokerRef.current
  const [pendingCeremony, setPendingCeremony] = useState(
    ceremonyBroker.getPending()
  )
  const activeWalletRef = useRef<{
    credential: SliceWalletCredentialRecord
    kernelAccount: SliceWalletRootAccount
  } | null>(null)
  const frameClientRef = useRef<SliceWalletSignerFrameClient | null>(null)
  const frameClientPromiseRef =
    useRef<Promise<SliceWalletSignerFrameClient> | null>(null)
  const frameClientDisposedRef = useRef(false)

  useEffect(
    () => ceremonyBroker.subscribe(setPendingCeremony),
    [ceremonyBroker]
  )

  useEffect(() => () => ceremonyBroker.cancel(), [ceremonyBroker])

  const getFrameClient = useCallback(async () => {
    if (frameClientRef.current !== null) return frameClientRef.current

    const pending =
      frameClientPromiseRef.current ??
      connectSliceWalletSignerFrame({
        document,
        frameUrl: new URL("/frame", normalizedIdOrigin).href,
        window
      })
    frameClientPromiseRef.current = pending

    try {
      const client = await pending
      if (frameClientDisposedRef.current) {
        client.destroy()
        throw new Error("Slice wallet frame client was disposed.")
      }
      frameClientRef.current = client
      return client
    } finally {
      if (frameClientPromiseRef.current === pending) {
        frameClientPromiseRef.current = null
      }
    }
  }, [normalizedIdOrigin])

  const createCheckoutSessionProof = useCallback(
    async ({
      action,
      delegationId,
      frameClient,
      session
    }: {
      action: "predecessor_descriptors" | "revoke" | "status"
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      session: SliceWalletFrameSession
    }) => {
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      const challenge =
        await checkoutExecution.client.createSessionChallenge(delegationId)
      const proofSignature = await frameClient.request({
        method: "signSessionRequest",
        params: {
          action,
          ...challenge,
          delegationId,
          session: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind
          }
        }
      })
      if (typeof proofSignature !== "string" || !isHex(proofSignature)) {
        throw new Error("Slice wallet returned an invalid session proof.")
      }
      return { ...challenge, delegationId, proofSignature }
    },
    [checkoutExecution]
  )

  const createReplacementFinalizationProof = useCallback(
    async ({
      action = "finalize_replacement",
      client,
      delegationId,
      frameClient,
      session
    }: {
      action?: "finalize_replacement" | "predecessor_descriptors" | "revoke"
      client: {
        createSessionChallenge: (
          delegationId: string
        ) => Promise<{ challenge: Hex; expiresAt: number }>
      }
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      session: SliceWalletFrameSession
    }) => {
      const challenge = await client.createSessionChallenge(delegationId)
      const proofSignature = await frameClient.request({
        method: "signSessionRequest",
        params: {
          action,
          ...challenge,
          delegationId,
          session: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind
          }
        }
      })
      if (typeof proofSignature !== "string" || !isHex(proofSignature)) {
        throw new Error("Slice wallet returned an invalid replacement proof.")
      }
      return { ...challenge, delegationId, proofSignature }
    },
    []
  )

  const finalizeRegisteredReplacement = useCallback(
    async ({
      client,
      delegationId,
      frameClient,
      previousSessions,
      session
    }: {
      client:
        | Pick<
            SliceWalletCheckoutExecutionClient,
            "createSessionChallenge" | "finalizeReplacement"
          >
        | Pick<
            SliceWalletManagementExecutionClient,
            "createSessionChallenge" | "finalizeReplacement"
          >
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
      session: SliceWalletFrameSession
    }) => {
      const calls = []
      for (const descriptor of previousSessions) {
        const built = await buildSliceWalletPermissionRevocationCalls({
          account: session.account,
          client: publicClient,
          session: parseSliceWalletExecutionSessionDescriptor(descriptor)
        })
        calls.push(...built.calls)
      }
      if (calls.length > 0 && sliceAccountClient === null) {
        throw new Error("Unlock your Slice wallet first.")
      }
      const execution =
        calls.length === 0 || sliceAccountClient === null
          ? null
          : await sliceAccountClient.sendCalls({ calls })
      const operation =
        execution === null
          ? {}
          : {
              expectedDisableCallHash: getSliceWalletCallsHash(calls),
              userOperationHash: execution.executionId
            }
      await retrySliceWalletFinalityAction({
        createProof: () =>
          createReplacementFinalizationProof({
            client,
            delegationId,
            frameClient,
            session
          }),
        operation,
        request: async (proof) => {
          await client.finalizeReplacement(proof)
        }
      })
    },
    [createReplacementFinalizationProof, publicClient, sliceAccountClient]
  )

  const fetchCheckoutDelegation = useCallback(
    async (input: {
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      session: SliceWalletFrameSession
    }) => {
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      return checkoutExecution.client.fetchDelegation(
        await createCheckoutSessionProof({ action: "status", ...input })
      )
    },
    [checkoutExecution, createCheckoutSessionProof]
  )

  useEffect(() => {
    frameClientDisposedRef.current = false

    return () => {
      frameClientDisposedRef.current = true
      const pending = frameClientPromiseRef.current
      frameClientPromiseRef.current = null
      frameClientRef.current?.destroy()
      frameClientRef.current = null
      void pending?.then(
        (client) => client.destroy(),
        () => undefined
      )
    }
  }, [])

  const refreshRecovery = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet || !fetchWalletRecovery) {
      setRecovery(null)
      return
    }

    try {
      const snapshot = await fetchWalletRecovery({
        address: activeWallet.kernelAccount.address
      })
      setRecovery(snapshot)
    } catch {
      setRecovery(null)
    }
  }, [fetchWalletRecovery])

  const buildExecutionClient = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: SliceWalletRootAccount
      session: SliceWalletFrameSession
      stored: Extract<StoredSliceWalletExecutionSession, { kind: "checkout" }>
    }) => {
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      const frameClient = await getFrameClient()
      const executionAccount = await createSliceWalletPermissionAccount({
        address: kernelAccount.address,
        accountIndex: BigInt(credential.accountIndex),
        checkoutCoSigner: checkoutExecution.client,
        client: publicClient,
        credential: {
          credentialIdHash: credential.credentialIdHash,
          publicKey: credential.publicKey
        },
        delegationId: stored.delegationId,
        enableSignature: stored.enableSignature,
        frameClient,
        getFactoryArgs: () => kernelAccount.getFactoryArgs(),
        mode: "checkout",
        session
      })
      const transport = createSliceKernelPasskeyTransport({
        account: executionAccount,
        bundlerUrl: getSliceBundlerApiUrl(window.location.origin),
        chain: walletChain,
        client: publicClient
      })

      return createKernelPasskeySliceAccountClient({
        account: kernelAccount.address,
        chainId: walletChain.id,
        transport
      })
    },
    [checkoutExecution, getFrameClient, publicClient, walletChain]
  )

  const activateExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      snapshot,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: SliceWalletRootAccount
      session: SliceWalletFrameSession
      snapshot: SliceWalletCheckoutExecutionDelegationSnapshot
      stored: Extract<StoredSliceWalletExecutionSession, { kind: "checkout" }>
    }) => {
      const client = await buildExecutionClient({
        credential,
        kernelAccount,
        session,
        stored
      })

      setExecutionSession({
        allowanceUsdMicros: BigInt(snapshot.allowanceUsdMicros),
        ...(snapshot.budgetPeriodSec === undefined
          ? {}
          : { budgetPeriodSec: snapshot.budgetPeriodSec }),
        expiresAt: new Date(snapshot.expiresAt),
        remainingUsdMicros: BigInt(snapshot.remainingUsdMicros),
        sliceAccountClient: client
      })
    },
    [buildExecutionClient]
  )

  const hydrateExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: SliceWalletRootAccount
    }) => {
      try {
        const stored = await readStoredExecutionSession(
          kernelAccount.address,
          "checkout"
        )
        if (stored?.kind !== "checkout") {
          return
        }

        if (!checkoutExecution) {
          return
        }
        const frameClient = await getFrameClient()
        const frameResult = await frameClient.request({
          method: "getSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChain.id,
            grantKind: "checkout"
          }
        })
        if (frameResult === null || typeof frameResult !== "object") {
          await clearStoredExecutionSession(kernelAccount.address, "checkout")
          return
        }
        const session = parseSliceWalletFrameSession(
          frameResult as SliceWalletProtocolValue
        )
        const { delegation: snapshot } = await fetchCheckoutDelegation({
          delegationId: stored.delegationId,
          frameClient,
          session
        })
        const apiPolicy =
          snapshot?.walletPolicy === undefined
            ? null
            : parseSerializedWalletPolicyDescriptor(snapshot.walletPolicy)
        if (
          snapshot?.signerScheme !== "p256" ||
          snapshot.permissionId?.toLowerCase() !==
            session.permissionId.toLowerCase() ||
          apiPolicy === null ||
          getWalletPolicyHash(apiPolicy) !==
            getWalletPolicyHash(session.policy) ||
          snapshot.coSignerAddress.toLowerCase() !==
            stored.coSignerAddress.toLowerCase() ||
          snapshot.signerAddress.toLowerCase() !==
            stored.signerAddress.toLowerCase() ||
          session.signerId.toLowerCase() !==
            stored.signerAddress.toLowerCase() ||
          session.permissionId.toLowerCase() !==
            stored.permissionId.toLowerCase()
        ) {
          await clearStoredExecutionSession(kernelAccount.address, "checkout")
          await frameClient
            .request({
              method: "clearSession",
              params: {
                account: kernelAccount.address,
                chainId: walletChain.id,
                grantKind: "checkout"
              }
            })
            .catch(() => undefined)
          return
        }

        await activateExecutionSession({
          credential,
          kernelAccount,
          session,
          snapshot,
          stored
        })
      } catch {
        // Missing frame state, stale delegation, or a transient failure leaves checkout root-signed.
      }
    },
    [
      activateExecutionSession,
      checkoutExecution,
      fetchCheckoutDelegation,
      getFrameClient,
      walletChain.id
    ]
  )

  const buildManagementExecutionClient = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: SliceWalletRootAccount
      session: SliceWalletFrameSession
      stored: Extract<
        StoredSliceWalletExecutionSession,
        { kind: "store_management" }
      >
    }) => {
      const frameClient = await getFrameClient()
      const executionAccount = await createSliceWalletPermissionAccount({
        address: kernelAccount.address,
        accountIndex: BigInt(credential.accountIndex),
        client: publicClient,
        credential: {
          credentialIdHash: credential.credentialIdHash,
          publicKey: credential.publicKey
        },
        enableSignature: stored.enableSignature,
        frameClient,
        getFactoryArgs: () => kernelAccount.getFactoryArgs(),
        mode: "management",
        session
      })
      const transport = createSliceKernelPasskeyTransport({
        account: executionAccount,
        bundlerUrl: getSliceBundlerApiUrl(window.location.origin),
        chain: walletChain,
        client: publicClient
      })
      return createKernelPasskeySliceAccountClient({
        account: kernelAccount.address,
        chainId: walletChain.id,
        transport
      })
    },
    [getFrameClient, publicClient, walletChain]
  )

  const activateManagementExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: SliceWalletRootAccount
      session: SliceWalletFrameSession
      stored: Extract<
        StoredSliceWalletExecutionSession,
        { kind: "store_management" }
      >
    }) => {
      const client = await buildManagementExecutionClient({
        credential,
        kernelAccount,
        session,
        stored
      })
      setManagementExecutionSession({
        expiresAt: new Date(stored.expiresAt),
        slicerAddress: stored.slicerAddress,
        slicerId: stored.slicerId,
        sliceAccountClient: client
      })
    },
    [buildManagementExecutionClient]
  )

  const hydrateManagementExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: SliceWalletRootAccount
    }) => {
      try {
        const stored = await readStoredExecutionSession(
          kernelAccount.address,
          "store_management"
        )
        if (stored?.kind !== "store_management" || !storeManagement) return
        const frameClient = await getFrameClient()
        const [frameResult, { delegation }] = await Promise.all([
          frameClient.request({
            method: "getSession",
            params: {
              account: kernelAccount.address,
              chainId: walletChain.id,
              grantKind: "management"
            }
          }),
          storeManagement.fetchDelegation()
        ])
        if (
          frameResult === null ||
          typeof frameResult !== "object" ||
          delegation === null ||
          delegation.signerScheme !== "p256" ||
          delegation.permissionId === null ||
          delegation.signerPublicKey === null ||
          delegation.walletPolicy === null ||
          delegation.slicerId !== stored.slicerId
        ) {
          await clearStoredExecutionSession(
            kernelAccount.address,
            "store_management"
          )
          try {
            await frameClient.request({
              method: "clearSession",
              params: {
                account: kernelAccount.address,
                chainId: walletChain.id,
                grantKind: "management"
              }
            })
          } catch {
            // The API row is unusable without the origin-isolated key.
          }
          return
        }
        const session = parseSliceWalletFrameSession(
          frameResult as SliceWalletProtocolValue
        )
        const apiPolicy = parseSerializedWalletPolicyDescriptor(
          delegation.walletPolicy
        )
        const expectedPolicy = createSliceStoreManagementPolicyDescriptor({
          account: kernelAccount.address,
          chainId: walletChain.id,
          expiresAt: session.expiresAt,
          slicerAddress: stored.slicerAddress,
          slicerId: stored.slicerId,
          startsAt: session.policy.validAfter
        })
        if (
          getWalletPolicyHash(apiPolicy) !==
            getWalletPolicyHash(session.policy) ||
          getWalletPolicyHash(expectedPolicy) !==
            getWalletPolicyHash(session.policy) ||
          delegation.permissionId.toLowerCase() !==
            session.permissionId.toLowerCase() ||
          delegation.signerAddress.toLowerCase() !==
            session.signerId.toLowerCase() ||
          delegation.signerPublicKey.toLowerCase() !==
            session.publicKey.toLowerCase() ||
          stored.permissionId.toLowerCase() !==
            session.permissionId.toLowerCase() ||
          stored.signerAddress.toLowerCase() !== session.signerId.toLowerCase()
        ) {
          await clearStoredExecutionSession(
            kernelAccount.address,
            "store_management"
          )
          await frameClient
            .request({
              method: "clearSession",
              params: {
                account: kernelAccount.address,
                chainId: walletChain.id,
                grantKind: "management"
              }
            })
            .catch(() => undefined)
          return
        }
        await activateManagementExecutionSession({
          credential,
          kernelAccount,
          session,
          stored
        })
      } catch {
        setManagementExecutionSession(null)
      }
    },
    [
      activateManagementExecutionSession,
      getFrameClient,
      storeManagement,
      walletChain.id
    ]
  )

  const activateCredential = useCallback(
    async (credential: SliceWalletCredentialRecord) => {
      const recovery =
        credential.recoveryPermissionId === null ||
        credential.recoverySignerAddress === null
          ? undefined
          : await buildRecoveryPermissionInitConfig({
              client: publicClient,
              recoverySignerAddress: credential.recoverySignerAddress
            })
      if (
        recovery !== undefined &&
        recovery.permissionId.toLowerCase() !==
          credential.recoveryPermissionId?.toLowerCase()
      ) {
        throw new Error("Slice wallet recovery metadata is inconsistent.")
      }
      const kernelAccount = await createSliceWalletCeremonyKernelAccount({
        address: credential.accountAddress,
        ceremonyBroker,
        ceremonyMode,
        chainId: walletChain.id,
        client: publicClient,
        credential: {
          credentialIdHash: credential.credentialIdHash,
          publicKey: credential.publicKey
        },
        document,
        idOrigin: normalizedIdOrigin,
        ...(recovery === undefined ? {} : { initConfig: recovery.initConfig }),
        window
      })

      if (!isAddressEqual(kernelAccount.address, credential.accountAddress)) {
        throw new Error("Slice wallet credential does not match its account.")
      }
      const transport = createSliceKernelPasskeyTransport({
        account: kernelAccount,
        bundlerUrl: getSliceBundlerApiUrl(window.location.origin),
        chain: walletChain,
        client: publicClient
      })
      const nextSliceAccountClient = createKernelPasskeySliceAccountClient({
        account: kernelAccount.address,
        chainId: walletChain.id,
        transport
      })

      await fundDevWalletAccount(walletChain, kernelAccount.address)

      activeWalletRef.current = { credential, kernelAccount }
      setAccountAddress(kernelAccount.address)
      setSliceAccountClient(nextSliceAccountClient)
      setStatus("ready")

      if (checkoutExecution) {
        void hydrateExecutionSession({ credential, kernelAccount })
      }
      if (storeManagement) {
        void hydrateManagementExecutionSession({ credential, kernelAccount })
      }
      if (fetchWalletRecovery) {
        void refreshRecovery()
      }

      return {
        kernelAccount,
        sliceAccountClient: nextSliceAccountClient
      }
    },
    [
      checkoutExecution,
      ceremonyBroker,
      ceremonyMode,
      fetchWalletRecovery,
      hydrateExecutionSession,
      hydrateManagementExecutionSession,
      normalizedIdOrigin,
      publicClient,
      refreshRecovery,
      storeManagement,
      walletChain
    ]
  )

  useEffect(() => {
    let isActive = true

    const hydrateStoredCredential = async () => {
      const metadata = readStoredWalletMetadata(credentialStorageKey)
      setHasStoredCredential(metadata !== null)
      if (metadata === null) {
        setStatus("idle")
        return
      }

      try {
        const registered = await createSliceWalletRegistryClient({
          baseUrl: normalizedIdOrigin
        }).lookupCredential({
          accountAddress: metadata.accountAddress,
          credentialIdHash: metadata.credentialIdHash
        })
        if (
          registered === null ||
          !isAddressEqual(registered.accountAddress, metadata.accountAddress)
        ) {
          throw new Error("Stored Slice Wallet metadata is no longer valid.")
        }
        const credential = toCredentialRecord(registered)
        if (!isActive) return
        await activateCredential(credential)
      } catch {
        if (!isActive) return
        setStatus("idle")
        setRecovery(null)
      }
    }

    void hydrateStoredCredential()

    return () => {
      isActive = false
    }
  }, [activateCredential, credentialStorageKey, normalizedIdOrigin])

  const runWalletAction = useCallback(
    async (
      action: Exclude<SliceWalletPendingAction, null>,
      task: () => Promise<void>
    ) => {
      setPendingAction(action)
      setError(null)

      try {
        await task()
        return true
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to use Slice wallet."
        activeWalletRef.current = null
        setAccountAddress(null)
        setExecutionSession(null)
        setManagementExecutionSession(null)
        setSliceAccountClient(null)
        setError(message)
        setStatus("error")
        notifications?.error?.(message)
        return false
      } finally {
        setPendingAction(null)
      }
    },
    [notifications]
  )

  const connectWallet = useCallback(async () => {
    const connected = await connectSliceWalletAccount({
      ceremonyBroker,
      ceremonyMode,
      chainId: walletChain.id,
      document,
      idOrigin: normalizedIdOrigin,
      ...(sessionConfig === undefined
        ? {}
        : {
            session: {
              audience: sessionConfig.audience,
              prepare: sessionConfig.adapter.prepare,
              ...(sessionConfig.scopes === undefined
                ? {}
                : { scopes: sessionConfig.scopes }),
              ...(sessionConfig.ttlSeconds === undefined
                ? {}
                : { ttlSeconds: sessionConfig.ttlSeconds })
            }
          }),
      window
    })
    if (connected.recovery === undefined) {
      throw new Error("Complete recovery enrollment before connecting.")
    }
    const record = toCredentialRecord(connected)
    if (
      record.recoveryPermissionId !== null &&
      (record.recoveryPermissionId.toLowerCase() !==
        connected.recovery.permissionId.toLowerCase() ||
        record.recoverySignerAddress?.toLowerCase() !==
          connected.recovery.signerAddress.toLowerCase())
    ) {
      throw new Error("Recovery permission does not match its ceremony.")
    }
    await activateCredential(record)
    storeWalletMetadata(credentialStorageKey, record)
    setHasStoredCredential(true)
    await sessionIntegration.complete(
      connected.session,
      connected.accountAddress
    )
    notifications?.success?.("Slice wallet ready")
  }, [
    activateCredential,
    ceremonyBroker,
    ceremonyMode,
    credentialStorageKey,
    normalizedIdOrigin,
    notifications,
    sessionConfig,
    sessionIntegration,
    walletChain.id
  ])

  const createWallet = useCallback(
    () => runWalletAction("create", connectWallet),
    [connectWallet, runWalletAction]
  )

  const loginWallet = useCallback(
    () => runWalletAction("login", connectWallet),
    [connectWallet, runWalletAction]
  )

  const switchAccount = useCallback(async () => {
    setPendingAction("login")
    setError(null)
    try {
      await connectWallet()
      return true
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to switch Slice wallet accounts."
      setError(message)
      notifications?.error?.(message)
      return false
    } finally {
      setPendingAction(null)
    }
  }, [connectWallet, notifications])

  const signInWallet = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet) throw new Error("Unlock your Slice wallet first.")

    if (sessionConfig !== undefined) {
      const result = await requestSliceWalletSession({
        account: activeWallet.kernelAccount.address,
        ceremonyBroker,
        ceremonyMode,
        chainId: walletChain.id,
        document,
        idOrigin: normalizedIdOrigin,
        session: {
          audience: sessionConfig.audience,
          prepare: sessionConfig.adapter.prepare,
          ...(sessionConfig.scopes === undefined
            ? {}
            : { scopes: sessionConfig.scopes }),
          ...(sessionConfig.ttlSeconds === undefined
            ? {}
            : { ttlSeconds: sessionConfig.ttlSeconds })
        },
        window
      })
      await sessionIntegration.complete(
        result,
        activeWallet.kernelAccount.address
      )
      return
    }
    if (adapters.signInWithWallet === undefined) {
      throw new Error("Wallet sign-in is not configured.")
    }

    try {
      await adapters.signInWithWallet({
        address: activeWallet.kernelAccount.address,
        signMessage: (message) =>
          activeWallet.kernelAccount.signMessage({ message })
      })
      if (storeManagement) {
        await hydrateManagementExecutionSession(activeWallet)
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign in."
      setError(message)
      notifications?.error?.(message)
      throw caughtError
    }
  }, [
    adapters,
    ceremonyBroker,
    ceremonyMode,
    normalizedIdOrigin,
    hydrateManagementExecutionSession,
    notifications,
    sessionConfig,
    sessionIntegration,
    storeManagement,
    walletChain.id
  ])

  const enableExecutionSession = useCallback(
    async ({
      allowanceUsdMicros = defaultExecutionAllowanceUsdMicros,
      budgetPeriodSec,
      tokenAddresses = []
    }: {
      allowanceUsdMicros?: bigint
      budgetPeriodSec?: number
      tokenAddresses?: readonly Address[]
    } = {}) => {
      const activeWallet = activeWalletRef.current
      if (!activeWallet) {
        throw new Error("Unlock your Slice wallet first.")
      }
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }

      const { credential, kernelAccount } = activeWallet
      if (!sliceAccountClient)
        throw new Error("Unlock your Slice wallet first.")
      const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const validUntil = Math.floor(expiresAtDate.getTime() / 1000)
      const { coSignerAddress } =
        await checkoutExecution.client.getConfiguration(walletChain.id)
      const policy = createSliceCheckoutPolicyDescriptor({
        account: kernelAccount.address,
        chainId: walletChain.id,
        expiresAt: validUntil,
        tokenAddresses: [
          ...new Set(tokenAddresses.map((value) => value.toLowerCase()))
        ].filter((value): value is Address => isAddress(value))
      })
      const frameClient = await getFrameClient()
      let [pendingFrameResult, pendingReplacement] = await Promise.all([
        frameClient.request({
          method: "getPendingSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChain.id,
            grantKind: "checkout"
          }
        }),
        readStoredPendingReplacement(kernelAccount.address, "checkout")
      ])
      if (
        pendingFrameResult !== null &&
        typeof pendingFrameResult === "object" &&
        parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        ).expiresAt <= Math.floor(Date.now() / 1_000)
      ) {
        await Promise.all([
          frameClient.request({
            method: "discardSession",
            params: {
              account: kernelAccount.address,
              chainId: walletChain.id,
              grantKind: "checkout"
            }
          }),
          clearStoredPendingReplacement(kernelAccount.address, "checkout")
        ])
        pendingFrameResult = null
        pendingReplacement = null
      }
      const pendingRegistrationAction = getSliceWalletPendingRegistrationAction(
        {
          hasPendingFrame:
            pendingFrameResult !== null &&
            typeof pendingFrameResult === "object",
          replacement: pendingReplacement
        }
      )
      if (pendingRegistrationAction === "discard_orphan") {
        await frameClient.request({
          method: "discardSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChain.id,
            grantKind: "checkout"
          }
        })
        pendingFrameResult = null
        pendingReplacement = null
      } else if (pendingRegistrationAction === "ambiguous") {
        throw new Error(
          "A pending checkout registration must be recovered from Slice ID."
        )
      } else if (pendingRegistrationAction === "resume") {
        if (
          pendingFrameResult === null ||
          typeof pendingFrameResult !== "object" ||
          pendingReplacement === null ||
          pendingReplacement.phase === "registering" ||
          pendingReplacement.session.kind !== "checkout" ||
          pendingReplacement.allowanceUsdMicros === undefined
        ) {
          throw new Error("Invalid pending checkout replacement state.")
        }
        const replacementSession = pendingReplacement.session
        const replacementPreviousSessions = pendingReplacement.previousSessions
        const replacementAllowanceUsdMicros =
          pendingReplacement.allowanceUsdMicros
        const pendingSession = parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        )
        const outcome = await resumeSliceWalletRegisteredReplacement({
          activate: () =>
            activateExecutionSession({
              credential,
              kernelAccount,
              session: pendingSession,
              snapshot: {
                allowanceUsdMicros: replacementAllowanceUsdMicros,
                ...(replacementSession.budgetPeriodSec !== undefined
                  ? {
                      budgetPeriodSec: replacementSession.budgetPeriodSec
                    }
                  : {}),
                coSignerAddress: replacementSession.coSignerAddress,
                delegationId: replacementSession.delegationId,
                expiresAt: replacementSession.expiresAt,
                permissionId: replacementSession.permissionId,
                remainingUsdMicros: replacementAllowanceUsdMicros,
                signerAddress: replacementSession.signerAddress,
                signerScheme: "p256",
                walletPolicy: serializeWalletPolicyDescriptor(
                  pendingSession.policy
                )
              },
              stored: replacementSession
            }),
          clear: () =>
            clearStoredPendingReplacement(kernelAccount.address, "checkout"),
          commit: async () => {
            await frameClient.request({
              method: "commitSession",
              params: {
                account: pendingSession.account,
                chainId: pendingSession.chainId,
                grantKind: pendingSession.grantKind
              }
            })
          },
          discard: async () => {
            await frameClient.request({
              method: "discardSession",
              params: {
                account: pendingSession.account,
                chainId: pendingSession.chainId,
                grantKind: pendingSession.grantKind
              }
            })
          },
          finalize: () =>
            finalizeRegisteredReplacement({
              client: checkoutExecution.client,
              delegationId: replacementSession.delegationId,
              frameClient,
              previousSessions: replacementPreviousSessions,
              session: pendingSession
            }),
          notifyRevoked: () =>
            notifications?.error?.(
              "This checkout permission was revoked from Slice ID. Enable it again to continue."
            ),
          persist: () => writeStoredExecutionSession(replacementSession)
        })
        if (outcome === "resumed") {
          notifications?.success?.("1-tap checkout enabled")
        }
        return
      }
      const created = await frameClient.request({
        method: "createSession",
        params: {
          checkout: {
            allowanceUsdMicros: allowanceUsdMicros.toString(),
            ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
            coSignerAddress
          },
          policy
        }
      })
      if (created === null || typeof created !== "object") {
        throw new Error(
          "Slice Wallet signer did not create a checkout session."
        )
      }
      const session = parseSliceWalletFrameSession(
        created as SliceWalletProtocolValue
      )
      let authorization: SliceWalletPermissionAuthorization
      let registration: Awaited<
        ReturnType<typeof checkoutExecution.client.registerAuthorization>
      > | null = null
      try {
        authorization = await authorizeSliceWalletSession({
          ceremonyBroker,
          ceremonyMode,
          document,
          idOrigin: normalizedIdOrigin,
          session,
          window
        })
        await writeStoredPendingReplacement({
          phase: "registering",
          previousSessions: [],
          session: {
            accountAddress: kernelAccount.address,
            ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
            coSignerAddress,
            enableSignature: authorization.enableSignature,
            expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
            kind: "checkout",
            permissionId: session.permissionId,
            signerAddress: session.signerId
          }
        })
        registration =
          await checkoutExecution.client.registerAuthorization(authorization)
        const stored = {
          accountAddress: kernelAccount.address,
          ...(registration.budgetPeriodSec === undefined
            ? {}
            : { budgetPeriodSec: registration.budgetPeriodSec }),
          coSignerAddress: registration.coSignerAddress,
          delegationId: registration.delegationId,
          enableSignature: authorization.enableSignature,
          expiresAt: registration.expiresAt,
          kind: "checkout",
          permissionId: registration.permissionId,
          signerAddress: registration.signerAddress
        } satisfies StoredSliceWalletExecutionSession
        await writeStoredPendingReplacement({
          allowanceUsdMicros: registration.allowanceUsdMicros,
          phase: "registered",
          previousSessions: registration.previousSessions,
          session: stored
        })
        if (registration.requiresFinalization) {
          await finalizeRegisteredReplacement({
            client: checkoutExecution.client,
            delegationId: registration.delegationId,
            frameClient,
            previousSessions: registration.previousSessions,
            session
          })
        }
        await frameClient.request({
          method: "commitSession",
          params: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind
          }
        })
      } catch (error) {
        if (registration === null) {
          await Promise.all([
            frameClient
              .request({
                method: "discardSession",
                params: {
                  account: session.account,
                  chainId: session.chainId,
                  grantKind: session.grantKind
                }
              })
              .catch(() => undefined),
            clearStoredPendingReplacement(
              kernelAccount.address,
              "checkout"
            ).catch(() => undefined)
          ])
        }
        throw error
      }

      if (registration === null) {
        throw new Error("Slice checkout delegation registration failed.")
      }

      const stored = {
        accountAddress: kernelAccount.address,
        ...(registration.budgetPeriodSec === undefined
          ? {}
          : { budgetPeriodSec: registration.budgetPeriodSec }),
        coSignerAddress: registration.coSignerAddress,
        delegationId: registration.delegationId,
        enableSignature: authorization.enableSignature,
        expiresAt: registration.expiresAt,
        kind: "checkout",
        permissionId: registration.permissionId,
        signerAddress: registration.signerAddress
      } satisfies StoredSliceWalletExecutionSession
      await writeStoredExecutionSession(stored)
      await clearStoredPendingReplacement(kernelAccount.address, "checkout")

      await activateExecutionSession({
        credential,
        kernelAccount,
        session,
        snapshot: {
          allowanceUsdMicros: registration.allowanceUsdMicros,
          ...(registration.budgetPeriodSec === undefined
            ? {}
            : { budgetPeriodSec: registration.budgetPeriodSec }),
          coSignerAddress: registration.coSignerAddress,
          delegationId: registration.delegationId,
          expiresAt: registration.expiresAt,
          permissionId: registration.permissionId,
          remainingUsdMicros: registration.allowanceUsdMicros,
          signerAddress: registration.signerAddress,
          signerScheme: "p256",
          walletPolicy: serializeWalletPolicyDescriptor(session.policy)
        },
        stored
      })
      notifications?.success?.("1-tap checkout enabled")
    },
    [
      activateExecutionSession,
      ceremonyBroker,
      ceremonyMode,
      checkoutExecution,
      finalizeRegisteredReplacement,
      getFrameClient,
      normalizedIdOrigin,
      notifications,
      sliceAccountClient,
      walletChain.id
    ]
  )

  const enableManagementExecutionSession = useCallback(
    async ({
      slicerAddress,
      slicerId
    }: {
      slicerAddress: Address
      slicerId: number
    }) => {
      const activeWallet = activeWalletRef.current
      if (!activeWallet) throw new Error("Unlock your Slice wallet first.")
      if (!storeManagement) {
        throw new Error("1-tap management is not available in this app.")
      }
      const { credential, kernelAccount } = activeWallet
      if (!sliceAccountClient)
        throw new Error("Unlock your Slice wallet first.")
      const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
      const policy = createSliceStoreManagementPolicyDescriptor({
        account: kernelAccount.address,
        chainId: walletChain.id,
        expiresAt: Math.floor(expiresAtDate.getTime() / 1_000),
        slicerAddress,
        slicerId
      })
      const frameClient = await getFrameClient()
      let [pendingFrameResult, pendingReplacement] = await Promise.all([
        frameClient.request({
          method: "getPendingSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChain.id,
            grantKind: "management"
          }
        }),
        readStoredPendingReplacement(kernelAccount.address, "store_management")
      ])
      if (
        pendingFrameResult !== null &&
        typeof pendingFrameResult === "object" &&
        parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        ).expiresAt <= Math.floor(Date.now() / 1_000)
      ) {
        await Promise.all([
          frameClient.request({
            method: "discardSession",
            params: {
              account: kernelAccount.address,
              chainId: walletChain.id,
              grantKind: "management"
            }
          }),
          clearStoredPendingReplacement(
            kernelAccount.address,
            "store_management"
          )
        ])
        pendingFrameResult = null
        pendingReplacement = null
      }
      const pendingRegistrationAction = getSliceWalletPendingRegistrationAction(
        {
          hasPendingFrame:
            pendingFrameResult !== null &&
            typeof pendingFrameResult === "object",
          replacement: pendingReplacement
        }
      )
      if (pendingRegistrationAction === "discard_orphan") {
        await frameClient.request({
          method: "discardSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChain.id,
            grantKind: "management"
          }
        })
        pendingFrameResult = null
        pendingReplacement = null
      } else if (pendingRegistrationAction === "ambiguous") {
        throw new Error(
          "A pending management registration must be recovered from Slice ID."
        )
      } else if (pendingRegistrationAction === "resume") {
        if (
          pendingFrameResult === null ||
          typeof pendingFrameResult !== "object" ||
          pendingReplacement === null ||
          pendingReplacement.phase === "registering" ||
          pendingReplacement.session.kind !== "store_management"
        ) {
          throw new Error("Invalid pending management replacement state.")
        }
        const replacementSession = pendingReplacement.session
        const replacementPreviousSessions = pendingReplacement.previousSessions
        const pendingSession = parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        )
        const outcome = await resumeSliceWalletRegisteredReplacement({
          activate: () =>
            activateManagementExecutionSession({
              credential,
              kernelAccount,
              session: pendingSession,
              stored: replacementSession
            }),
          clear: () =>
            clearStoredPendingReplacement(
              kernelAccount.address,
              "store_management"
            ),
          commit: async () => {
            await frameClient.request({
              method: "commitSession",
              params: {
                account: pendingSession.account,
                chainId: pendingSession.chainId,
                grantKind: pendingSession.grantKind
              }
            })
          },
          discard: async () => {
            await frameClient.request({
              method: "discardSession",
              params: {
                account: pendingSession.account,
                chainId: pendingSession.chainId,
                grantKind: pendingSession.grantKind
              }
            })
          },
          finalize: () =>
            finalizeRegisteredReplacement({
              client: storeManagement.client,
              delegationId: replacementSession.delegationId,
              frameClient,
              previousSessions: replacementPreviousSessions,
              session: pendingSession
            }),
          notifyRevoked: () =>
            notifications?.error?.(
              "This management permission was revoked from Slice ID. Enable it again to continue."
            ),
          persist: () => writeStoredExecutionSession(replacementSession)
        })
        if (outcome === "resumed") {
          notifications?.success?.("1-tap management enabled")
        }
        return
      }
      const created = await frameClient.request({
        method: "createSession",
        params: { policy }
      })
      if (created === null || typeof created !== "object") {
        throw new Error(
          "Slice Wallet signer did not create a management session."
        )
      }
      const session = parseSliceWalletFrameSession(
        created as SliceWalletProtocolValue
      )
      let authorization: SliceWalletPermissionAuthorization
      let registration: Awaited<
        ReturnType<typeof storeManagement.client.registerAuthorization>
      >
      let registered = false
      try {
        authorization = await authorizeSliceWalletSession({
          ceremonyBroker,
          ceremonyMode,
          document,
          idOrigin: normalizedIdOrigin,
          session,
          window
        })
        await writeStoredPendingReplacement({
          phase: "registering",
          previousSessions: [],
          session: {
            accountAddress: kernelAccount.address,
            enableSignature: authorization.enableSignature,
            expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
            kind: "store_management",
            permissionId: session.permissionId,
            signerAddress: session.signerId,
            slicerAddress,
            slicerId
          }
        })
        registration = await storeManagement.client.registerAuthorization({
          authorization,
          slicerAddress,
          slicerId
        })
        registered = true
        const stored = {
          accountAddress: kernelAccount.address,
          delegationId: registration.delegationId,
          enableSignature: authorization.enableSignature,
          expiresAt: registration.expiresAt,
          kind: "store_management",
          permissionId: registration.permissionId,
          signerAddress: registration.signerAddress,
          slicerAddress,
          slicerId
        } satisfies StoredSliceWalletExecutionSession
        await writeStoredPendingReplacement({
          phase: "registered",
          previousSessions: registration.previousSessions,
          session: stored
        })
        if (registration.requiresFinalization) {
          await finalizeRegisteredReplacement({
            client: storeManagement.client,
            delegationId: registration.delegationId,
            frameClient,
            previousSessions: registration.previousSessions,
            session
          })
        }
        await frameClient.request({
          method: "commitSession",
          params: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind
          }
        })
      } catch (error) {
        if (!registered) {
          await Promise.all([
            frameClient
              .request({
                method: "discardSession",
                params: {
                  account: session.account,
                  chainId: session.chainId,
                  grantKind: "management"
                }
              })
              .catch(() => undefined),
            clearStoredPendingReplacement(
              kernelAccount.address,
              "store_management"
            ).catch(() => undefined)
          ])
        }
        throw error
      }
      const stored = {
        accountAddress: kernelAccount.address,
        delegationId: registration.delegationId,
        enableSignature: authorization.enableSignature,
        expiresAt: registration.expiresAt,
        kind: "store_management",
        permissionId: registration.permissionId,
        signerAddress: registration.signerAddress,
        slicerAddress,
        slicerId
      } satisfies StoredSliceWalletExecutionSession
      await writeStoredExecutionSession(stored)
      await clearStoredPendingReplacement(
        kernelAccount.address,
        "store_management"
      )
      await activateManagementExecutionSession({
        credential,
        kernelAccount,
        session,
        stored
      })
      notifications?.success?.("1-tap management enabled")
    },
    [
      activateManagementExecutionSession,
      ceremonyBroker,
      ceremonyMode,
      finalizeRegisteredReplacement,
      getFrameClient,
      normalizedIdOrigin,
      notifications,
      sliceAccountClient,
      storeManagement,
      walletChain.id
    ]
  )

  const refreshExecutionAllowance = useCallback(async () => {
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (!executionSession || !activeAccount) {
      return
    }

    try {
      if (!checkoutExecution) {
        return
      }
      const stored = await readStoredExecutionSession(activeAccount, "checkout")
      if (stored?.kind !== "checkout") return
      const frameClient = await getFrameClient()
      const frameResult = await frameClient.request({
        method: "getSession",
        params: {
          account: activeAccount,
          chainId: walletChain.id,
          grantKind: "checkout"
        }
      })
      if (frameResult === null || typeof frameResult !== "object") return
      const session = parseSliceWalletFrameSession(
        frameResult as SliceWalletProtocolValue
      )
      const snapshot = await fetchCheckoutDelegation({
        delegationId: stored.delegationId,
        frameClient,
        session
      })
      if (!snapshot.delegation) {
        setExecutionSession(null)
        return
      }
      const delegation = snapshot.delegation

      setExecutionSession((current) =>
        current === null
          ? null
          : {
              ...current,
              allowanceUsdMicros: BigInt(delegation.allowanceUsdMicros),
              ...(delegation.budgetPeriodSec === undefined
                ? {}
                : { budgetPeriodSec: delegation.budgetPeriodSec }),
              remainingUsdMicros: BigInt(delegation.remainingUsdMicros)
            }
      )
    } catch {
      // Allowance refresh is best-effort; the active session remains usable.
    }
  }, [
    checkoutExecution,
    executionSession,
    fetchCheckoutDelegation,
    getFrameClient,
    walletChain.id
  ])

  const clearExecutionSessions = useCallback(async () => {
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (activeAccount) {
      const pendingReplacements = await Promise.all([
        readStoredPendingReplacement(activeAccount, "checkout"),
        readStoredPendingReplacement(activeAccount, "store_management")
      ])
      const hadExecutionPermission =
        executionSession !== null ||
        managementExecutionSession !== null ||
        pendingReplacements.some((replacement) => replacement !== null)
      await Promise.all([
        clearStoredExecutionSession(activeAccount, "checkout"),
        clearStoredExecutionSession(activeAccount, "store_management")
      ])
      try {
        const frameClient = await getFrameClient()
        await Promise.all([
          frameClient.request({
            method: "clearSession",
            params: {
              account: activeAccount,
              chainId: walletChain.id,
              grantKind: "checkout"
            }
          }),
          frameClient.request({
            method: "clearSession",
            params: {
              account: activeAccount,
              chainId: walletChain.id,
              grantKind: "management"
            }
          })
        ])
      } catch {
        // Sign-out must still complete when the isolated signer is unavailable.
      }
      if (hadExecutionPermission) {
        notifications?.error?.(
          "Your onchain wallet permission remains active until you revoke it from Slice ID."
        )
      }
    }
    setExecutionSession(null)
    setManagementExecutionSession(null)
  }, [
    executionSession,
    getFrameClient,
    managementExecutionSession,
    notifications,
    walletChain.id
  ])

  const clearManagementExecutionSession = useCallback(async () => {
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (activeAccount) {
      await clearStoredExecutionSession(activeAccount, "store_management")
      try {
        const frameClient = await getFrameClient()
        await frameClient.request({
          method: "clearSession",
          params: {
            account: activeAccount,
            chainId: walletChain.id,
            grantKind: "management"
          }
        })
      } catch {
        // Parent metadata is still cleared; iframe storage can be cleared later.
      }
    }
    setManagementExecutionSession(null)
  }, [getFrameClient, walletChain.id])

  const disableManagementExecutionSession = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet || !sliceAccountClient) {
      throw new Error("Unlock your Slice wallet first.")
    }
    if (!storeManagement) {
      throw new Error("1-tap management is not available in this app.")
    }

    const frameClient = await getFrameClient()
    const [{ delegation }, frameResult] = await Promise.all([
      storeManagement.fetchDelegation(),
      frameClient.request({
        method: "getSession",
        params: {
          account: activeWallet.kernelAccount.address,
          chainId: walletChain.id,
          grantKind: "management"
        }
      })
    ])
    if (delegation === null) {
      throw new Error(
        "The management delegation is unavailable; revoke it from Slice ID."
      )
    }
    let session: SliceWalletFrameSession | null = null
    if (frameResult !== null && typeof frameResult === "object") {
      session = parseSliceWalletFrameSession(
        frameResult as SliceWalletProtocolValue
      )
    } else if (
      delegation !== null &&
      delegation.permissionId !== null &&
      delegation.signerPublicKey !== null &&
      delegation.walletPolicy !== null
    ) {
      const policy = parseSerializedWalletPolicyDescriptor(
        delegation.walletPolicy
      )
      const reconstructed = {
        account: activeWallet.kernelAccount.address,
        chainId: walletChain.id,
        expiresAt: Math.floor(new Date(delegation.expiresAt).getTime() / 1_000),
        grantKind: "management",
        permissionId: delegation.permissionId,
        policy,
        publicKey: delegation.signerPublicKey,
        signerId: delegation.signerAddress
      } satisfies SliceWalletFrameSession
      session = parseSliceWalletFrameSession(
        reconstructed as SliceWalletProtocolValue
      )
    }
    if (session !== null) {
      const { calls } = await buildSliceWalletPermissionRevocationCalls({
        account: activeWallet.kernelAccount.address,
        client: publicClient,
        session
      })
      const execution = await sliceAccountClient.sendCalls({ calls })
      const operation = {
        expectedDisableCallHash: getSliceWalletCallsHash(calls),
        userOperationHash: execution.executionId
      }
      await retrySliceWalletFinalityAction({
        createProof: () =>
          createReplacementFinalizationProof({
            action: "revoke",
            client: storeManagement.client,
            delegationId: delegation.delegationId,
            frameClient,
            session
          }),
        operation,
        request: async (proof) => {
          await storeManagement.client.revokeDelegation(proof)
        }
      })
    } else {
      throw new Error(
        "The management permission descriptor is unavailable; revoke it from Slice ID."
      )
    }

    await clearManagementExecutionSession()
    notifications?.success?.("1-tap management disabled")
  }, [
    clearManagementExecutionSession,
    createReplacementFinalizationProof,
    getFrameClient,
    notifications,
    publicClient,
    sliceAccountClient,
    storeManagement,
    walletChain.id
  ])

  const runRecoveryAction = useCallback(
    async (
      action: Exclude<SliceWalletRecoveryPendingAction, null>,
      task: () => Promise<void>
    ) => {
      setRecoveryPendingAction(action)

      try {
        await task()
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to update wallet recovery."
        notifications?.error?.(message)
        throw caughtError
      } finally {
        setRecoveryPendingAction(null)
      }
    },
    [notifications]
  )

  const cancelRecoveryProposal = useCallback(
    () =>
      runRecoveryAction("cancel", async () => {
        const activeWallet = activeWalletRef.current
        const proposal = recovery?.pendingProposals[0]
        if (!activeWallet || !sliceAccountClient) {
          throw new Error("Unlock your Slice wallet first.")
        }
        if (!proposal?.callData || proposal.nonce === null) {
          throw new Error("No cancellable recovery proposal.")
        }

        await sliceAccountClient.sendCalls({
          calls: [
            buildRecoveryCancelCall({
              account: activeWallet.kernelAccount.address,
              callData: proposal.callData,
              nonce: BigInt(proposal.nonce),
              permissionId: proposal.permissionId
            })
          ]
        })
        await refreshRecovery()
        notifications?.success?.("Recovery proposal cancelled")
      }),
    [
      recovery?.pendingProposals,
      notifications,
      refreshRecovery,
      runRecoveryAction,
      sliceAccountClient
    ]
  )

  const value = useMemo(
    () => ({
      accountAddress,
      cancelRecoveryProposal,
      clearExecutionSessions,
      continueInPopup: ceremonyBroker.continueInPopup,
      createWallet,
      cancelPendingCeremony: ceremonyBroker.cancel,
      disableManagementExecutionSession,
      enableExecutionSession,
      enableManagementExecutionSession,
      error,
      executionSession,
      hasStoredCredential,
      loginWallet,
      managementExecutionSession,
      pendingAction,
      pendingCeremony,
      recovery,
      recoveryPendingAction,
      refreshRecovery,
      refreshExecutionAllowance,
      signInWallet,
      switchAccount,
      retrySession: signInWallet,
      session: sessionIntegration.session,
      sessionError: sessionIntegration.sessionError,
      signOutSession: sessionIntegration.revoke,
      sliceAccountClient,
      status
    }),
    [
      accountAddress,
      cancelRecoveryProposal,
      clearExecutionSessions,
      ceremonyBroker,
      createWallet,
      disableManagementExecutionSession,
      enableExecutionSession,
      enableManagementExecutionSession,
      error,
      executionSession,
      hasStoredCredential,
      loginWallet,
      managementExecutionSession,
      pendingAction,
      pendingCeremony,
      recovery,
      recoveryPendingAction,
      refreshRecovery,
      refreshExecutionAllowance,
      signInWallet,
      switchAccount,
      sessionIntegration,
      sliceAccountClient,
      status
    ]
  )

  return (
    <SliceWalletContext.Provider value={value}>
      {children}
    </SliceWalletContext.Provider>
  )
}

export const useSliceWallet = () => {
  const context = useContext(SliceWalletContext)
  if (!context) {
    throw new Error("useSliceWallet must be used inside SliceWalletProvider.")
  }
  return context
}
