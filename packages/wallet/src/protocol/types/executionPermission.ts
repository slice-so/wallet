import type {
  walletExecutionPermissionKindValues,
  walletExecutionPermissionScopeValues,
  walletExecutionPermissionStatusValues
} from "../executionPermission"
import type { SerializedWalletPolicyDescriptor } from "./policy"

export type WalletExecutionPermissionKind =
  (typeof walletExecutionPermissionKindValues)[number]

export type WalletExecutionPermissionScope =
  (typeof walletExecutionPermissionScopeValues)[number]

export type WalletExecutionPermissionStatus =
  (typeof walletExecutionPermissionStatusValues)[number]

export type WalletExecutionPermissionPolicy = {
  allowanceUsdMicros?: string
  budgetPeriodSec?: number
  coSignerAddress?: string
  enableNonce: string
  walletPolicy?: SerializedWalletPolicyDescriptor
}
