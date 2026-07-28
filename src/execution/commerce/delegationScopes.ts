import type {
  WalletDelegationOperation,
  WalletDelegationScope
} from "../../types/delegation"

export const walletDelegationApiScope = "api" satisfies WalletDelegationScope
export const walletDelegationAutomationScope =
  "automation" satisfies WalletDelegationScope
export const walletDelegationExecutionScope =
  "wallet_execution" satisfies WalletDelegationScope
export const walletDelegationStoreManagementScope =
  "store_management" satisfies WalletDelegationScope
export const walletDelegationSessionDurationMs = 30 * 24 * 60 * 60 * 1000
export const walletDelegationAutomationOperationValues = [
  "addProduct",
  "editProduct",
  "editProductMetadata",
  "multicall",
  "removeProduct",
  "setProductType",
  "setStoreConfig",
  "configureProduct",
  "_addCurrencies",
  "orders:read",
  "orders:update",
  "checkout-sessions:create"
] as const satisfies readonly WalletDelegationOperation[]
export const walletDelegationOperationValues = [
  ...walletDelegationAutomationOperationValues,
  "batchWithdraw",
  "release",
  "setRoles",
  "slice"
] as const satisfies readonly WalletDelegationOperation[]
