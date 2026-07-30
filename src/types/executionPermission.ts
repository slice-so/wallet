import type { SerializedWalletPolicyDescriptor } from "./policy"

export type WalletExecutionPermissionStatus =
  | "active"
  | "pending"
  | "revoked"
  | "expired"

export type WalletExecutionPermissionPolicy = {
  allowedOperations: string[]
  allowanceUsdMicros?: string
  budgetPeriodSec?: number
  coSignerAddress?: string
  walletPolicy?: SerializedWalletPolicyDescriptor
}
