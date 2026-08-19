"use client"

import { getSliceWalletChainManifest } from "@slicekit/wallet-primitives/server"
import {
  createContext,
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
import { useConfig, useConnection } from "wagmi"
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
import { sliceWalletConnectorId } from "../wagmi"
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

export function SliceWalletProvider({
  adapters = {},
  ceremonyMode = "auto",
  children,
  notifications
}: SliceWalletProviderProps) {
  const defaultCheckoutExecution = useMemo(
    () => ({ client: createSliceWalletCheckoutExecutionClient() }),
    []
  )
  const checkoutExecution =
    adapters.checkoutExecution ?? defaultCheckoutExecution
  const fetchWalletRecovery = adapters.fetchWalletRecovery
  const storeManagement = adapters.storeManagement
  const wagmiConfig = useConfig()
  const usesLocalSliceChain =
    !wagmiConfig.chains.some((chain) => chain.id === base.id) &&
    wagmiConfig.chains.some((chain) => chain.id === anvil.id)
  const walletChain = useMemo(
    () =>
      usesLocalSliceChain ? anvil : getSliceWalletChainManifest(base.id).chain,
    [usesLocalSliceChain]
  )
  const normalizedIdOrigin =
    walletChain.id === anvil.id
      ? "http://localhost:3003"
      : "https://id.slice.so"
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: walletChain,
        transport: http(
          getSliceWalletChainManifest(walletChain.id).defaultTransports.rpcUrl
        )
      }),
    [walletChain]
  )
  const [status, setStatus] = useState<SliceWalletStatus>("loading")
  const connection = useConnection({ config: wagmiConfig })
  const connectedSliceAccount =
    connection.status === "connected" &&
    connection.connector.id === sliceWalletConnectorId
      ? connection.address
      : null
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
      wagmiConfig,
      walletChain
    })

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    const connector = wagmiConfig.connectors.find(
      (candidate) => candidate.id === sliceWalletConnectorId
    )
    if (connector === undefined) return
    void connector.getProvider().then((provider) => {
      if (!active || provider === undefined) return
      const sliceProvider = provider as SliceWalletEip1193Provider
      setConnectorPendingCeremony(sliceProvider.pendingCeremony)
      unsubscribe = sliceProvider.subscribePendingCeremony(
        setConnectorPendingCeremony
      )
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [wagmiConfig.connectors])

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

  const getConnectorProvider = useCallback(async () => {
    const connector = wagmiConfig.connectors.find(
      (candidate) => candidate.id === sliceWalletConnectorId
    )
    const provider = await connector?.getProvider()
    if (provider === undefined) {
      throw new Error("Slice Wallet provider is unavailable.")
    }
    return provider as SliceWalletEip1193Provider
  }, [wagmiConfig.connectors])

  const continueInPopup = useCallback(
    () =>
      featurePendingCeremony !== null
        ? ceremonyBroker.continueInPopup()
        : getConnectorProvider().then((provider) => provider.continueInPopup()),
    [ceremonyBroker, featurePendingCeremony, getConnectorProvider]
  )

  const cancelPendingCeremony = useCallback(() => {
    if (featurePendingCeremony !== null) {
      ceremonyBroker.cancel()
      return
    }
    void getConnectorProvider().then((provider) =>
      provider.cancelPendingCeremony()
    )
  }, [ceremonyBroker, featurePendingCeremony, getConnectorProvider])

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

export const useSliceWallet = () => {
  const context = useContext(SliceWalletContext)
  if (!context) {
    throw new Error("useSliceWallet must be used inside SliceWalletProvider.")
  }
  return context
}
