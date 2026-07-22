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
import { createPublicClient, http, isAddressEqual } from "viem"
import { anvil } from "viem/chains"
import { useConnection } from "wagmi"
import {
  type createSliceWalletCeremonyKernelAccount,
  getSliceWalletChainManifest
} from "../index"
import { buildRecoveryCancelCall } from "../recovery"
import type { SliceAccountClient } from "../types/accountClient"
import type { SliceWalletProvider as SliceWalletEip1193Provider } from "../types/provider"
import type {
  SliceWalletContextValue,
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletPendingAction,
  SliceWalletProviderProps,
  SliceWalletRecoveryPendingAction,
  SliceWalletRecoverySnapshot,
  SliceWalletStatus
} from "../types/react"
import { sliceWalletConnectorId } from "../wagmi"
import { useSliceWalletAccountHydration } from "./accountHydration"
import {
  useSliceWalletCeremonyActions,
  useSliceWalletCeremonyConnection
} from "./ceremonyConnection"
import { useSliceWalletExecutionAuthority } from "./executionAuthority"
import { useSliceWalletCheckoutEnablement } from "./executionCheckout"
import { useSliceWalletExecutionHydration } from "./executionHydration"
import { useSliceWalletExecutionLifecycle } from "./executionLifecycle"
import { useSliceWalletManagementEnablement } from "./executionManagement"
import { useSliceWalletSessionIntegration } from "./sessionIntegration"

export { defaultExecutionAllowanceUsdMicros } from "./executionCheckout"

const SliceWalletContext = createContext<SliceWalletContextValue | null>(null)

export function SliceWalletProvider({
  adapters,
  alchemyId,
  capabilities,
  ceremonyMode = "popup",
  children,
  idOrigin,
  notifications,
  preferredChainId,
  session: sessionConfig,
  wagmiConfig
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
    () =>
      preferredChainId === anvil.id
        ? anvil
        : getSliceWalletChainManifest(preferredChainId).chain,
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
  const warnSession = useCallback(
    (message: string) => {
      console.warn("[slice-wallet]", message)
      notifications?.error?.(message)
    },
    [notifications]
  )
  const sessionIntegration = useSliceWalletSessionIntegration({
    account: connectedSliceAccount,
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

  const { refreshRecovery } = useSliceWalletAccountHydration({
    activeWalletRef,
    ceremonyBroker,
    ceremonyMode,
    checkoutEnabled: checkoutExecution !== undefined,
    connectedAccount: connectedSliceAccount,
    fetchWalletRecovery,
    hydrateExecutionSession,
    hydrateManagementExecutionSession,
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
      hydrateManagementExecutionSession,
      managementEnabled: storeManagement !== undefined,
      notifications,
      sessionIntegration,
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
    if (
      previousAccount !== null &&
      (connectedSliceAccount === null ||
        !isAddressEqual(previousAccount, connectedSliceAccount))
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
    if (connectedSliceAccount === null) {
      setExecutionSession(null)
      setManagementExecutionSession(null)
    }
  }, [connectedSliceAccount, getFrameClient])

  const pendingCeremony = featurePendingCeremony ?? connectorPendingCeremony

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
      notifications,
      publicClient,
      setExecutionSession,
      setManagementExecutionSession,
      sliceAccountClient,
      storeManagement,
      walletChainId: walletChain.id
    })

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
