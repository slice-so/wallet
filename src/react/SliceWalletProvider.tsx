"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from "react"
import { type Address, createPublicClient, http } from "viem"
import { anvil } from "viem/chains"
import {
  type createSliceWalletCeremonyKernelAccount,
  getSliceWalletChainManifest
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
  SliceWalletStatus
} from "../types/react"
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

const defaultWalletMetadataStorageKey = "slice.passkey-wallet"

export { defaultExecutionAllowanceUsdMicros } from "./executionCheckout"

const SliceWalletContext = createContext<SliceWalletContextValue | null>(null)

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
  const { ceremonyBroker, getFrameClient, pendingCeremony } =
    useSliceWalletCeremonyConnection(normalizedIdOrigin)
  const activeWalletRef = useRef<{
    credential: SliceWalletCredentialRecord
    kernelAccount: Awaited<
      ReturnType<typeof createSliceWalletCeremonyKernelAccount>
    >
  } | null>(null)

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

  const { activateCredential, refreshRecovery } =
    useSliceWalletAccountHydration({
      activeWalletRef,
      ceremonyBroker,
      ceremonyMode,
      checkoutEnabled: checkoutExecution !== undefined,
      credentialStorageKey,
      fetchWalletRecovery,
      hydrateExecutionSession,
      hydrateManagementExecutionSession,
      managementEnabled: storeManagement !== undefined,
      normalizedIdOrigin,
      publicClient,
      setAccountAddress,
      setHasStoredCredential,
      setRecovery,
      setSliceAccountClient,
      setStatus,
      walletChain
    })

  const { createWallet, loginWallet, signInWallet, switchAccount } =
    useSliceWalletCeremonyActions({
      activeWalletRef,
      activateCredential,
      adapters,
      ceremonyBroker,
      ceremonyMode,
      credentialStorageKey,
      hydrateManagementExecutionSession,
      managementEnabled: storeManagement !== undefined,
      normalizedIdOrigin,
      notifications,
      sessionConfig,
      sessionIntegration,
      setAccountAddress,
      setError,
      setExecutionSession,
      setHasStoredCredential,
      setManagementExecutionSession,
      setPendingAction,
      setSliceAccountClient,
      setStatus,
      walletChain
    })

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

  const {
    clearExecutionSessions,
    disableManagementExecutionSession,
    refreshExecutionAllowance
  } = useSliceWalletExecutionLifecycle({
    activeWalletRef,
    checkoutExecution,
    createReplacementFinalizationProof,
    executionSession,
    fetchCheckoutDelegation,
    getFrameClient,
    managementExecutionSession,
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
