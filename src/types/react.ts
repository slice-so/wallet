import type { Config } from "@wagmi/core"
import type { ReactNode } from "react"
import type { Address, Hex } from "viem"
import type { SliceAccountClient } from "./accountClient"
import type { SliceWalletCeremonyMode } from "./ceremony"
import type {
  SliceWalletCheckoutExecutionClient,
  SliceWalletExecutionSessionDescriptor,
  SliceWalletManagementExecutionClient
} from "./commerce"
import type { SliceWalletPendingCeremony } from "./pendingCeremony"
import type { SerializedWalletPolicyDescriptor } from "./policy"
import type {
  SliceWalletSessionAdapter,
  SliceWalletSessionSnapshot
} from "./session"

export type SliceWalletStatus = "error" | "idle" | "loading" | "ready"
export type SliceWalletPendingAction = "create" | "login" | null
export type SliceWalletRecoveryPendingAction = "cancel" | null

export type SliceWalletManagementHydrationError =
  | "session-invalid"
  | "storage-unavailable"
  | "transport-unavailable"

export type SliceWalletManagementHydrationSnapshot = {
  status: "idle" | "pending" | "settled"
  error: SliceWalletManagementHydrationError | null
}

export type SliceWalletManagementRecoveryMode = "hydrate" | "preserve-pending"

export type SliceWalletManagementLifecycleControl = {
  assertCurrent: () => void
  markError: (error: SliceWalletManagementHydrationError) => void
  markStorageUnavailable: () => void
}

export type SliceWalletManagementMutationBroadcast = {
  account: Address
  chainId: number
  outcome: "error" | "success"
  slicerId: number
  sourceId: string
}

export type SliceWalletManagementLifecycle = {
  getAccount: () => Address | null
  getSnapshot: () => SliceWalletManagementHydrationSnapshot
  handleExternalMutation: (account: Address, slicerId: number) => void
  markHydrationError: (
    account: Address,
    error: SliceWalletManagementHydrationError
  ) => void
  markNothingToHydrate: (account: Address) => void
  retryHydration: (account: Address) => Promise<void>
  runHydration: (
    account: Address,
    task?: (control: SliceWalletManagementLifecycleControl) => Promise<void>
  ) => Promise<void>
  runMutation: <Result>(input: {
    account: Address
    slicerId: number
    task: (control: SliceWalletManagementLifecycleControl) => Promise<Result>
  }) => Promise<Result>
  setAccount: (account: Address | null) => void
  sourceId: string
  subscribe: (listener: () => void) => () => void
}

export type SliceWalletCredentialRecord = {
  accountAddress: Address
  accountIndex: number
  credentialIdHash: Hex
  publicKey: Hex
  recoveryPermissionId: Hex | null
  recoverySignerAddress: Address | null
}

export type SliceWalletExecutionRegistration = {
  allowanceUsdMicros: string
  budgetPeriodSec?: number
  coSignerAddress: Address
  delegationId: string
  expiresAt: string
  signerAddress: Address
}

export type SliceWalletExecutionSession = {
  allowanceUsdMicros: bigint
  budgetPeriodSec?: number
  expiresAt: Date
  remainingUsdMicros: bigint
  sliceAccountClient: SliceAccountClient
}

export type SliceWalletManagementDelegationSnapshot = {
  appOrigin: string | null
  delegationId: string
  expiresAt: string
  permissionId: Hex | null
  signerAddress: Address
  signerPublicKey: Hex | null
  signerScheme: "eoa" | "p256"
  slicerId: number | null
  walletPolicy: SerializedWalletPolicyDescriptor | null
}

export type SliceWalletManagementDelegationState = {
  delegation: SliceWalletManagementDelegationSnapshot | null
}

export type SliceWalletManagementExecutionSession = {
  expiresAt: Date
  slicerAddress: Address
  slicerId: number
  sliceAccountClient: SliceAccountClient
}

export type StoredSliceWalletExecutionSession = {
  accountAddress: Address
  delegationId: string
  enableSignature: Hex
  expiresAt: string
  permissionId: Hex
  signerAddress: Address
} & (
  | {
      budgetPeriodSec?: number
      coSignerAddress: Address
      kind: "checkout"
    }
  | {
      kind: "store_management"
      slicerAddress: Address
      slicerId: number
    }
)

export type StoredSliceWalletRegisteringSession =
  | Omit<
      Extract<StoredSliceWalletExecutionSession, { kind: "checkout" }>,
      "delegationId"
    >
  | Omit<
      Extract<StoredSliceWalletExecutionSession, { kind: "store_management" }>,
      "delegationId"
    >

export type StoredSliceWalletRegisteredReplacement = {
  allowanceUsdMicros?: string
  phase: "registered"
  previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
  session: StoredSliceWalletExecutionSession
}

export type StoredSliceWalletPendingReplacement =
  | StoredSliceWalletRegisteredReplacement
  | {
      phase: "registering"
      previousSessions: readonly []
      session: StoredSliceWalletRegisteringSession
    }

export type SliceWalletRecoveryConfigSnapshot = {
  delaySec: string
  expirationSec: string
  guardian: Address
  initialized: boolean
  permissionId: Hex
  signerAddress: Address | null
  updatedAtTimestamp: string
  walletAddress: Address
}

export type SliceWalletRecoveryPendingProposalSnapshot = {
  callData: Hex | null
  createdAtTimestamp: string
  nonce: string | null
  permissionId: Hex
  proposalHash: Hex
  status: string
  validAfter: string
  validUntil: string
  walletAddress: Address
}

export type SliceWalletRecoverySnapshot = {
  chainTimestamp: string
  config: SliceWalletRecoveryConfigSnapshot | null
  pendingProposals: SliceWalletRecoveryPendingProposalSnapshot[]
}

export type SliceWalletCheckoutExecutionAdapters = {
  client: SliceWalletCheckoutExecutionClient
}

export type SliceWalletManagementExecutionAdapters = {
  client: SliceWalletManagementExecutionClient
  fetchDelegation: (
    slicerId: number
  ) => Promise<SliceWalletManagementDelegationState>
  revokeDelegation: (slicerId: number) => Promise<{ revoked: number }>
}

export type SliceWalletProviderAdapters = {
  fetchWalletRecovery?: (input: {
    address: Address
  }) => Promise<SliceWalletRecoverySnapshot>
  checkoutExecution?: SliceWalletCheckoutExecutionAdapters
  storeManagement?: SliceWalletManagementExecutionAdapters
}

export type SliceWalletCapabilities = {
  checkoutExecution?: boolean
  recovery?: boolean
  storeManagement?: boolean
}

export type SliceWalletNotifications = {
  error?: (message: string) => void
  success?: (message: string) => void
}

export type SliceWalletProviderProps = {
  adapters: SliceWalletProviderAdapters
  alchemyId: string
  capabilities?: SliceWalletCapabilities
  ceremonyMode?: SliceWalletCeremonyMode
  children: ReactNode
  idOrigin: string
  notifications?: SliceWalletNotifications
  preferredChainId: number
  wagmiConfig: Config
  session?: {
    adapter: SliceWalletSessionAdapter
    audience: string
    scopes?: readonly string[]
    ttlSeconds?: number
  }
}

export type SliceWalletContextValue = {
  cancelPendingCeremony: () => void
  cancelRecoveryProposal: () => Promise<void>
  continueInPopup: () => Promise<object | string | null | undefined>
  createWallet: () => Promise<boolean>
  enableExecutionSession: (input?: {
    allowanceUsdMicros?: bigint
    budgetPeriodSec?: number
    tokenAddresses?: readonly Address[]
  }) => Promise<void>
  error: string | null
  executionSession: SliceWalletExecutionSession | null
  hasStoredCredential: boolean
  loginWallet: () => Promise<boolean>
  getManagementExecutionSession: (
    slicerId: number
  ) => SliceWalletManagementExecutionSession | null
  getStoreCreationExecutionSession: () => SliceWalletManagementExecutionSession | null
  managementHydration: SliceWalletManagementHydrationSnapshot
  pendingAction: SliceWalletPendingAction
  pendingCeremony: SliceWalletPendingCeremony | null
  recovery: SliceWalletRecoverySnapshot | null
  recoveryPendingAction: SliceWalletRecoveryPendingAction
  refreshExecutionAllowance: () => Promise<void>
  disableManagementExecutionSession: (input: {
    slicerAddress: Address
    slicerId: number
  }) => Promise<void>
  enableManagementExecutionSession: (input: {
    slicerAddress: Address
    slicerId: number
  }) => Promise<void>
  refreshRecovery: () => Promise<void>
  retryManagementHydration: () => Promise<void>
  signInWallet: () => Promise<void>
  switchAccount: () => Promise<boolean>
  retrySession: () => Promise<void>
  session: SliceWalletSessionSnapshot | null
  sessionError: string | null
  signOutSession: () => Promise<void>
  status: SliceWalletStatus
}
