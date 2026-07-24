import type { SerializedWalletPolicyDescriptor } from "./policy"

export type WalletDelegationScope =
  | "api"
  | "automation"
  | "store_management"
  | "wallet_execution"

export type WalletDelegationStatus =
  | "active"
  | "pending"
  | "revoked"
  | "expired"

export type WalletDelegationSignerType = "external" | "generated"

export type WalletDelegationOperation =
  | "_addCurrencies"
  | "addProduct"
  | "checkout-sessions:create"
  | "configureProduct"
  | "editProduct"
  | "editProductMetadata"
  | "multicall"
  | "orders:read"
  | "orders:update"
  | "removeProduct"
  | "setProductType"
  | "setStoreConfig"

export type WalletDelegationRateLimit = { max: number; windowSec: number }

export type WalletDelegationPolicy = {
  allowedOperations: WalletDelegationOperation[]
  allowanceUsdMicros?: string
  budgetPeriodSec?: number
  coSignerAddress?: string
  signerType?: WalletDelegationSignerType
  rateLimit?: WalletDelegationRateLimit
  walletPolicy?: SerializedWalletPolicyDescriptor
}
