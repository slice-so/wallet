import type { Address, Hex } from "viem"
import type { SerializedWalletPolicyDescriptor } from "./policy"

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
