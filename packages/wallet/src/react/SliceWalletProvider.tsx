"use client"

import { getSliceWalletChainPolicy } from "@slicekit/wallet-primitives"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import {
  type Address,
  createPublicClient,
  http,
  isAddress,
  isAddressEqual
} from "viem"
import { anvil, base } from "viem/chains"
import type { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
import { createSliceWalletCheckoutExecutionClient } from "../execution/commerce/execution"
import { buildRecoveryCancelCall } from "../recovery"
import type { SliceAccountClient } from "../types/accountClient"
import type { SliceWalletEip1193Provider } from "../types/provider"
import type {
  SliceWalletContextValue,
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletManagementLifecycleControl,
  SliceWalletManagementMutationBroadcast,
  SliceWalletPendingAction,
  SliceWalletProviderProps,
  SliceWalletRecoveryPendingAction,
  SliceWalletRecoverySnapshot,
  SliceWalletStatus
} from "../types/react"
import {
  shouldLockReplacedSliceAccount,
  useSliceWalletAccountHydration
} from "./accountHydration"
import {
  useSliceWalletCeremonyActions,
  useSliceWalletCeremonyConnection
} from "./ceremonyConnection"
import { useSliceWalletExecutionAuthority } from "./executionAuthority"
import { useSliceWalletCheckoutEnablement } from "./executionCheckout"
import { useSliceWalletExecutionHydration } from "./executionHydration"
import { useSliceWalletExecutionLifecycle } from "./executionLifecycle"
import { useSliceWalletManagementEnablement } from "./executionManagement"
import {
  createManagementLifecycle,
  IDLE_MANAGEMENT_HYDRATION_SNAPSHOT,
  shouldHandleManagementMutation
} from "./managementLifecycle"

export { defaultExecutionAllowanceUsdMicros } from "./executionCheckout"

const SliceWalletContext = createContext<SliceWalletContextValue | null>(null)

const unavailableManagementHydration = {
  error: null,
  status: "settled"
} as const

const unavailableSliceWalletValue = {
  cancelPendingCeremony: () => undefined,
  cancelRecoveryProposal: async () => undefined,
  continueInPopup: async () => null,
  createWallet: async () => false,
  disableManagementExecutionSession: async () => undefined,
  enableExecutionSession: async () => {
    throw new Error("Slice Wallet is unavailable on this chain.")
  },
  enableManagementExecutionSession: async () => {
    throw new Error("Slice Wallet is unavailable on this chain.")
  },
  error: null,
  executionSession: null,
  getManagementExecutionSession: () => null,
  getStoreCreationExecutionSession: () => null,
  hasStoredCredential: false,
  loginWallet: async () => false,
  managementHydration: unavailableManagementHydration,
  pendingAction: null,
  pendingCeremony: null,
  recovery: null,
  recoveryPendingAction: null,
  refreshExecutionAllowance: async () => undefined,
  refreshRecovery: async () => undefined,
  retryManagementHydration: async () => undefined,
  signInWallet: async () => undefined,
  status: "unavailable",
  switchAccount: async () => false
} satisfies SliceWalletContextValue

const UnavailableSliceWalletProvider = ({
  children
}: {
  children: ReactNode
}) => (
  <SliceWalletContext.Provider value={unavailableSliceWalletValue}>
    {children}
  </SliceWalletContext.Provider>
)

type AvailableSliceWalletProviderProps = SliceWalletProviderProps & {
  walletChain: ReturnType<typeof getSliceWalletChainPolicy>["chain"]
  walletRpcUrl: string
}

const AvailableSliceWalletProvider = ({
  adapters = {},
  ceremonyMode = "auto",
  children,
  connection,
  notifications,
  walletChain,
  walletRpcUrl
}: AvailableSliceWalletProviderProps) => {
  const defaultCheckoutExecution = useMemo(
    () => ({ client: createSliceWalletCheckoutExecutionClient() }),
    []
  )
  const checkoutExecution =
    adapters.checkoutExecution ?? defaultCheckoutExecution
  const fetchWalletRecovery = adapters.fetchWalletRecovery
  const storeManagement = adapters.storeManagement
  const normalizedIdOrigin =
    walletChain.id === anvil.id
      ? "http://localhost:3003"
      : "https://id.slice.so"
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: walletChain,
        transport: http(walletRpcUrl)
      }),
    [walletChain, walletRpcUrl]
  )
  const [status, setStatus] = useState<SliceWalletStatus>("loading")
  const connectedSliceAccount = connection.account
  const [pendingAction, setPendingAction] =
    useState<SliceWalletPendingAction>(null)
  const [error, setError] = useState<string | null>(null)
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
  const [recoveryPendingAction, setRecoveryPendingAction] =
    useState<SliceWalletRecoveryPendingAction>(null)
  const {
    ceremonyBroker,
    getFrameClient,
    pendingCeremony: featurePendingCeremony
  } = useSliceWalletCeremonyConnection(normalizedIdOrigin)
  const [connectorPendingCeremony, setConnectorPendingCeremony] =
    useState<SliceWalletEip1193Provider["pendingCeremony"]>(null)
  const activeWalletRef = useRef<{
    credential: SliceWalletCredentialRecord
    kernelAccount: Awaited<
      ReturnType<typeof createSliceWalletCeremonyKernelAccount>
    >
  } | null>(null)
  const managementHydrationTaskRef = useRef<
    (
      account: Address,
      control: SliceWalletManagementLifecycleControl
    ) => Promise<void>
  >(async () => undefined)
  const broadcastManagementMutationRef = useRef<
    ((message: SliceWalletManagementMutationBroadcast) => void) | null
  >(null)
  const managementLifecycle = useMemo(
    () =>
      createManagementLifecycle({
        chainId: walletChain.id,
        hydrate: (account, control) =>
          managementHydrationTaskRef.current(account, control),
        onIdentityChange: () => setManagementExecutionSession(null),
        onMutation: (message) =>
          broadcastManagementMutationRef.current?.(message)
      }),
    [walletChain.id]
  )
  const managementHydration = useSyncExternalStore(
    managementLifecycle.subscribe,
    managementLifecycle.getSnapshot,
    () => IDLE_MANAGEMENT_HYDRATION_SNAPSHOT
  )
  const previousSliceAccountRef = useRef(connectedSliceAccount)

  const {
    createReplacementFinalizationProof,
    fetchCheckoutDelegation,
    finalizeRegisteredReplacement
  } = useSliceWalletExecutionAuthority({
    checkoutExecution,
    publicClient,
    sliceAccountClient
  })

  const {
    activateExecutionSession,
    activateManagementExecutionSession,
    hydrateExecutionSession,
    hydrateManagementExecutionSession
  } = useSliceWalletExecutionHydration({
    checkoutExecution,
    fetchCheckoutDelegation,
    getFrameClient,
    publicClient,
    setExecutionSession,
    setManagementExecutionSession,
    storeManagement,
    walletChain
  })
  useEffect(() => {
    managementHydrationTaskRef.current = async (account, control) => {
      const activeWallet = activeWalletRef.current
      if (
        activeWallet === null ||
        !isAddressEqual(activeWallet.kernelAccount.address, account)
      ) {
        return
      }
      await hydrateManagementExecutionSession({ ...activeWallet, control })
    }
    return () => {
      managementHydrationTaskRef.current = async () => undefined
    }
  }, [hydrateManagementExecutionSession])

  const { refreshRecovery } = useSliceWalletAccountHydration({
    activeWalletRef,
    ceremonyBroker,
    ceremonyMode,
    checkoutEnabled: checkoutExecution !== undefined,
    connectedAccount: connectedSliceAccount,
    fetchWalletRecovery,
    hydrateExecutionSession,
    hydrateManagementExecutionSession,
    managementLifecycle,
    managementEnabled: storeManagement !== undefined,
    normalizedIdOrigin,
    publicClient,
    setHasStoredCredential,
    setRecovery,
    setSliceAccountClient,
    setStatus,
    walletChain
  })

  const { createWallet, loginWallet, signInWallet, switchAccount } =
    useSliceWalletCeremonyActions({
      activeWalletRef,
      managementLifecycle,
      managementEnabled: storeManagement !== undefined,
      notifications,
      setError,
      setPendingAction,
      connection,
      walletChain
    })

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void connection
      .getProvider()
      .then((provider) => {
        if (!active) return
        setConnectorPendingCeremony(provider.pendingCeremony)
        unsubscribe = provider.subscribePendingCeremony(
          setConnectorPendingCeremony
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [connection])

  useEffect(() => {
    const previousAccount = previousSliceAccountRef.current
    previousSliceAccountRef.current = connectedSliceAccount
    managementLifecycle.setAccount(connectedSliceAccount)
    // Explicit disconnect locking belongs to the connector runtime. This path
    // only locks a signer when a different Slice account replaces it.
    if (
      previousAccount !== null &&
      shouldLockReplacedSliceAccount({
        connectedAccount: connectedSliceAccount,
        previousAccount
      })
    ) {
      void getFrameClient()
        .then((frameClient) =>
          frameClient.request({
            method: "lockAccount",
            params: { account: previousAccount }
          })
        )
        .catch(() => undefined)
    }
    if (connectedSliceAccount !== null) return
    setExecutionSession(null)
    setManagementExecutionSession(null)
  }, [connectedSliceAccount, getFrameClient, managementLifecycle])

  useEffect(() => {
    if (
      storeManagement === undefined ||
      typeof BroadcastChannel === "undefined"
    ) {
      broadcastManagementMutationRef.current = null
      return
    }
    const channel = new BroadcastChannel("slice-wallet-management")
    broadcastManagementMutationRef.current = (message) =>
      channel.postMessage(message)
    const handleMessage = (
      event: MessageEvent<SliceWalletManagementMutationBroadcast>
    ) => {
      const message = event.data
      const activeAccount = managementLifecycle.getAccount()
      if (
        message === null ||
        typeof message !== "object" ||
        typeof message.sourceId !== "string" ||
        typeof message.chainId !== "number" ||
        (message.outcome !== "error" && message.outcome !== "success") ||
        typeof message.account !== "string" ||
        !isAddress(message.account) ||
        !shouldHandleManagementMutation({
          activeAccount,
          chainId: walletChain.id,
          message,
          sourceId: managementLifecycle.sourceId
        })
      ) {
        return
      }
      managementLifecycle.handleExternalMutation(message.account)
    }
    channel.addEventListener("message", handleMessage)
    return () => {
      broadcastManagementMutationRef.current = null
      channel.removeEventListener("message", handleMessage)
      channel.close()
    }
  }, [managementLifecycle, storeManagement, walletChain.id])

  const pendingCeremony = featurePendingCeremony ?? connectorPendingCeremony

  const getManagementExecutionSession = useCallback(
    () => managementExecutionSession,
    [managementExecutionSession]
  )
  const getStoreCreationExecutionSession = useCallback(
    () => managementExecutionSession,
    [managementExecutionSession]
  )

  const continueInPopup = useCallback(
    () =>
      featurePendingCeremony !== null
        ? ceremonyBroker.continueInPopup()
        : connection
            .getProvider()
            .then((provider) => provider.continueInPopup()),
    [ceremonyBroker, connection, featurePendingCeremony]
  )

  const cancelPendingCeremony = useCallback(() => {
    if (featurePendingCeremony !== null) {
      ceremonyBroker.cancel()
      return
    }
    void connection
      .getProvider()
      .then((provider) => provider.cancelPendingCeremony())
  }, [ceremonyBroker, connection, featurePendingCeremony])

  const enableExecutionSession = useSliceWalletCheckoutEnablement({
    activeWalletRef,
    activateExecutionSession,
    ceremonyBroker,
    ceremonyMode,
    checkoutExecution,
    finalizeRegisteredReplacement,
    getFrameClient,
    normalizedIdOrigin,
    notifications,
    sliceAccountClient,
    walletChainId: walletChain.id
  })

  const enableManagementExecutionSession = useSliceWalletManagementEnablement({
    activeWalletRef,
    activateManagementExecutionSession,
    ceremonyBroker,
    ceremonyMode,
    finalizeRegisteredReplacement,
    getFrameClient,
    managementLifecycle,
    normalizedIdOrigin,
    notifications,
    sliceAccountClient,
    storeManagement,
    walletChainId: walletChain.id
  })

  const { disableManagementExecutionSession, refreshExecutionAllowance } =
    useSliceWalletExecutionLifecycle({
      activeWalletRef,
      checkoutExecution,
      createReplacementFinalizationProof,
      executionSession,
      fetchCheckoutDelegation,
      getFrameClient,
      managementLifecycle,
      notifications,
      publicClient,
      setExecutionSession,
      setManagementExecutionSession,
      sliceAccountClient,
      storeManagement,
      walletChainId: walletChain.id
    })

  const retryManagementHydration = useCallback(async () => {
    const account = managementLifecycle.getAccount()
    if (account === null) return
    await managementLifecycle.retryHydration(account)
  }, [managementLifecycle])

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
      cancelPendingCeremony,
      cancelRecoveryProposal,
      continueInPopup,
      createWallet,
      disableManagementExecutionSession,
      enableExecutionSession,
      enableManagementExecutionSession,
      error,
      executionSession,
      hasStoredCredential,
      loginWallet,
      getManagementExecutionSession,
      getStoreCreationExecutionSession,
      managementHydration,
      pendingAction,
      pendingCeremony,
      recovery,
      recoveryPendingAction,
      refreshRecovery,
      refreshExecutionAllowance,
      retryManagementHydration,
      signInWallet,
      switchAccount,
      status
    }),
    [
      cancelPendingCeremony,
      cancelRecoveryProposal,
      continueInPopup,
      createWallet,
      disableManagementExecutionSession,
      enableExecutionSession,
      enableManagementExecutionSession,
      error,
      executionSession,
      hasStoredCredential,
      loginWallet,
      getManagementExecutionSession,
      getStoreCreationExecutionSession,
      managementHydration,
      pendingAction,
      pendingCeremony,
      recovery,
      recoveryPendingAction,
      refreshRecovery,
      refreshExecutionAllowance,
      retryManagementHydration,
      signInWallet,
      switchAccount,
      status
    ]
  )

  return (
    <SliceWalletContext.Provider value={value}>
      {children}
    </SliceWalletContext.Provider>
  )
}

export function SliceWalletProvider(props: SliceWalletProviderProps) {
  const usesLocalSliceChain =
    !props.connection.chainIds.includes(base.id) &&
    props.connection.chainIds.includes(anvil.id)
  const walletPolicy = getSliceWalletChainPolicy(
    usesLocalSliceChain ? anvil.id : base.id
  )

  if (!walletPolicy.admitted) {
    return (
      <UnavailableSliceWalletProvider>
        {props.children}
      </UnavailableSliceWalletProvider>
    )
  }

  return (
    <AvailableSliceWalletProvider
      {...props}
      walletChain={usesLocalSliceChain ? anvil : walletPolicy.chain}
      walletRpcUrl={walletPolicy.defaultTransports.rpcUrl}
    />
  )
}

export const useSliceWallet = () => {
  const context = useContext(SliceWalletContext)
  if (!context) {
    throw new Error("useSliceWallet must be used inside SliceWalletProvider.")
  }
  return context
}
