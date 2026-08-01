import type {
  walletExecutionPermissionScopeValues,
  walletExecutionPermissionStatusValues
} from "../executionPermission"
import type { SerializedWalletPolicyDescriptor } from "./policy"

export type WalletExecutionPermissionScope =
  (typeof walletExecutionPermissionScopeValues)[number]

export type WalletExecutionPermissionStatus =
  (typeof walletExecutionPermissionStatusValues)[number]

export type WalletExecutionPermissionPolicy = {
  allowedOperations: string[]
  allowanceUsdMicros?: string
  budgetPeriodSec?: number
  coSignerAddress?: string
  walletPolicy?: SerializedWalletPolicyDescriptor
}
