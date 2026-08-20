import type { Address, Hex } from "viem"

export type WalletGrantKind = "checkout" | "generic" | "management"

export type WalletPolicyParameterCondition =
  | "equal"
  | "greater_than"
  | "less_than_or_equal"
  | "not_equal"

export type WalletPolicyParameterRule = {
  condition: WalletPolicyParameterCondition
  offset: number
  params: readonly Hex[]
}

export type WalletPolicyCallRule = {
  parameterRules: readonly WalletPolicyParameterRule[]
  selector: Hex
  target: Address
  valueLimit: bigint
}

export type WalletPolicyDescriptor = {
  account: Address
  rateLimit?: {
    count: number
    intervalSec: number
  }
  calls: readonly WalletPolicyCallRule[]
  chainId: number
  grantKind: WalletGrantKind
  validAfter: number
  validUntil: number
  version: 1
}

export type WalletCall = {
  data?: Hex
  to: Address
  value?: bigint
}

export type SerializedWalletPolicyDescriptor = Omit<
  WalletPolicyDescriptor,
  "calls"
> & {
  calls: {
    parameterRules: {
      condition: WalletPolicyParameterCondition
      offset: number
      params: Hex[]
    }[]
    selector: Hex
    target: Address
    valueLimit: string
  }[]
}

export type WalletPolicyJsonValue =
  | boolean
  | null
  | number
  | string
  | WalletPolicyJsonValue[]
  | { readonly [key: string]: WalletPolicyJsonValue | undefined }
