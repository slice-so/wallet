export const walletExecutionPermissionScopeValues = [
  "store_management",
  "wallet_execution"
] as const

export const walletExecutionPermissionStatusValues = [
  "active",
  "pending",
  "revoked",
  "expired"
] as const

export const walletExecutionPermissionExecutionScope = "wallet_execution"
export const walletExecutionPermissionStoreManagementScope = "store_management"
export const walletExecutionPermissionMaxDurationMs = 30 * 24 * 60 * 60 * 1_000
