import type { Address, Hex } from "viem"
import type { SliceWalletPermissionAuthorization } from "./frame"
import type { SliceWalletCheckoutCoSignerClient } from "./permission"
import type {
  SerializedWalletPolicyDescriptor,
  WalletPolicyDescriptor
} from "./policy"

export type SliceCheckoutApproval = { amount: bigint; currency: Address }
export type SliceCheckoutAllowanceTotal = {
  amount: bigint
  currency: Address
}
export type SliceCheckoutPayment = {
  amount: bigint
  currency: Address
  recipient: Address
  slicerId: bigint
}
export type SliceCheckoutProductLineItem = {
  productId: number
  quantity: number
  variantId: number
}
export type SliceCheckoutPurchase = {
  buyer: Address
  currency: Address
  platform: Address
  pricingData: Hex[]
  products: SliceCheckoutProductLineItem[]
  referrer: Address
  slicerId: bigint
}
export type SliceCheckoutSpendIntent = {
  approvals: SliceCheckoutApproval[]
  nativeValue: bigint
  payments: SliceCheckoutPayment[]
  purchases: SliceCheckoutPurchase[]
}
export type SliceSmartAccountCall = {
  target: Address
  value: bigint
  data: Hex
}
export type SliceCallsBatchClassification =
  | {
      status: "rejected"
      reason: "empty" | "too_many_calls" | "invalid_call"
    }
  | SliceCallsBatchClassified
export type SliceCallsBatchClassified = {
  status: "classified"
  includesAccountAdministration: boolean
  includesSliceIntent: boolean
  unknownTargets: readonly Address[]
}

export type CreateSliceCheckoutPolicyParameters = {
  account: Address
  chainId: number
  expiresAt: number
  startsAt?: number
  tokenAddresses?: readonly Address[]
}
export type CreateSliceStoreManagementPolicyParameters = {
  account: Address
  chainId: number
  expiresAt: number
  startsAt?: number
}

export type SliceWalletCheckoutExecutionGrantRegistration = {
  allowanceUsdMicros: string
  budgetPeriodSec?: number
  coSignerAddress: Address
  delegationId: string
  expiresAt: string
  permissionId: Hex
  previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
  requiresFinalization: boolean
  signerAddress: Address
}
export type SliceWalletExecutionSessionDescriptor = {
  account: Address
  chainId: number
  checkout?: {
    allowanceUsdMicros: string
    budgetPeriodSec?: number
    coSignerAddress: Address
  }
  expiresAt: number
  grantKind: "checkout" | "management"
  permissionId: Hex
  policy: SerializedWalletPolicyDescriptor
  publicKey: Hex
  signerId: Address
}
export type SliceWalletExecutionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
export type SliceWalletCheckoutExecutionDelegationSnapshot = {
  allowanceUsdMicros: string
  budgetPeriodSec?: number
  coSignerAddress: Address
  delegationId: string
  expiresAt: string
  remainingUsdMicros: string
  signerAddress: Address
  signerScheme: "p256"
  permissionId: Hex
  walletPolicy: SerializedWalletPolicyDescriptor
}
export type SliceWalletCheckoutExecutionDelegationState = {
  coSignerAddress: Address
  delegation: SliceWalletCheckoutExecutionDelegationSnapshot | null
}
export type SliceWalletExecutionSessionProof = {
  challenge: Hex
  delegationId: string
  expiresAt: number
  proofSignature: Hex
}
export type SliceWalletReplacementFinalization =
  SliceWalletExecutionSessionProof & {
    expectedDisableCallHash?: Hex
    userOperationHash?: Hex
  }
export type CreateSliceWalletCheckoutExecutionClientParameters = {
  fetch?: SliceWalletExecutionFetch
}
export type SliceWalletCheckoutExecutionClient =
  SliceWalletCheckoutCoSignerClient & {
    createSessionChallenge: (
      delegationId: string
    ) => Promise<{ challenge: Hex; expiresAt: number }>
    fetchDelegation: (
      proof: SliceWalletExecutionSessionProof
    ) => Promise<SliceWalletCheckoutExecutionDelegationState>
    fetchPredecessorDescriptors: (
      proof: SliceWalletExecutionSessionProof
    ) => Promise<{
      previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
    }>
    finalizeReplacement: (
      proof: SliceWalletReplacementFinalization
    ) => Promise<{ finalized: true }>
    getConfiguration: (chainId: number) => Promise<{ coSignerAddress: Address }>
    registerAuthorization: (
      authorization: SliceWalletPermissionAuthorization
    ) => Promise<SliceWalletCheckoutExecutionGrantRegistration>
    revokeDelegation: (
      proof: SliceWalletReplacementFinalization
    ) => Promise<{ revoked: true }>
  }
export type SliceWalletManagementExecutionGrantRegistration = {
  delegationId: string
  expiresAt: string
  permissionId: Hex
  previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
  requiresFinalization: boolean
  signerAddress: Address
}
export type SliceWalletManagementExecutionClient = {
  createSessionChallenge: (
    delegationId: string
  ) => Promise<{ challenge: Hex; expiresAt: number }>
  finalizeReplacement: (
    proof: SliceWalletReplacementFinalization
  ) => Promise<{ finalized: true }>
  fetchPredecessorDescriptors: (
    proof: SliceWalletExecutionSessionProof
  ) => Promise<{
    previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
  }>
  registerAuthorization: (
    authorization: SliceWalletPermissionAuthorization
  ) => Promise<SliceWalletManagementExecutionGrantRegistration>
  revokeDelegation: (
    proof: SliceWalletReplacementFinalization
  ) => Promise<{ revoked: true }>
}

export type SliceWalletOwnerPermissionDescriptor = {
  kind: "p256"
  session: SliceWalletExecutionSessionDescriptor
}

export type SliceCommercePolicyDescriptor = WalletPolicyDescriptor
