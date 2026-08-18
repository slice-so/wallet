import type {
  SerializedWalletPolicyDescriptor,
  SliceWalletPermissionAuthorization
} from "@slicekit/wallet-primitives"
import type {
  SliceUserOperationPolicyFetch,
  SliceWalletExecutionSessionDescriptor
} from "@slicekit/wallet-primitives/execution"
import type { Address, Hex } from "viem"
import type { SliceWalletCheckoutCoSignerClient } from "./permission"

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
  fetch?: SliceUserOperationPolicyFetch
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
