import type { WalletDelegationOperation } from "@slicekit/delegation-contract/types"
import type { SerializedWalletPolicyDescriptor } from "./policy"

export type WalletDelegationStatus =
  | "active"
  | "pending"
  | "revoked"
  | "expired"

export type WalletDelegationSignerType = "external" | "generated"

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
