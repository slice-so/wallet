import type { Address, Chain, Hex } from "viem"
import type { SerializedWalletPolicyDescriptor } from "./policy"

export type SliceWalletProviderValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | readonly SliceWalletProviderValue[]
  | { readonly [key: string]: SliceWalletProviderValue | undefined }

export type SliceWalletProviderRequestArguments = {
  method: string
  params?:
    | readonly SliceWalletProviderValue[]
    | { readonly [key: string]: SliceWalletProviderValue | undefined }
}

export type SliceWalletProviderRpcErrorData = {
  code: number
  message: string
}

export type SliceWalletProviderEventMap = {
  accountsChanged: readonly Address[]
  chainChanged: Hex
  connect: { chainId: Hex }
  disconnect: SliceWalletProviderRpcErrorData
  message: { data?: SliceWalletProviderValue; type: string }
}

export type SliceWalletProvider = {
  destroy: () => void
  on: <Event extends keyof SliceWalletProviderEventMap>(
    event: Event,
    listener: (payload: SliceWalletProviderEventMap[Event]) => void
  ) => void
  removeListener: <Event extends keyof SliceWalletProviderEventMap>(
    event: Event,
    listener: (payload: SliceWalletProviderEventMap[Event]) => void
  ) => void
  request: (
    request: SliceWalletProviderRequestArguments
  ) => Promise<SliceWalletProviderValue | undefined>
}

export type SliceWalletProviderConfig = {
  bundlerUrl: string
  chain: Chain
  document?: Document
  fetch?: typeof fetch
  idOrigin: string
  paymasterUrl?: string
  rpcUrl: string
  storage?: Storage
  window?: Window
}

export type SliceWalletGenericPermissionData =
  | {
      maximumValue: Hex
      recipient: Address
      template: "native-transfer"
    }
  | {
      maximumAmount: Hex
      recipient: Address
      template: "erc20-transfer"
      token: Address
    }
  | {
      maximumAmount: Hex
      spender: Address
      template: "erc20-approve"
      token: Address
    }
  | {
      account: Address
      maximumAmount: Hex
      recipient: Address
      template: "erc20-transfer-from"
      token: Address
    }

export type SliceWalletGenericRateLimitPolicy = {
  data: {
    count: number
    intervalSec: number
  }
  type: "rate-limit"
}

export type SliceWalletGenericPermission = {
  data: SliceWalletGenericPermissionData
  policies: readonly SliceWalletGenericRateLimitPolicy[]
  required?: boolean
  type: "slice-call"
}

export type SliceWalletGenericGrant = {
  account: Address
  chainId: number
  createdAt: number
  expiresAt: number
  permissionId: Hex
  policy: SerializedWalletPolicyDescriptor
  publicKey: Hex
  signerId: Address
}

export type SliceWalletEip6963ProviderInfo = {
  icon: string
  name: "Slice Wallet"
  rdns: "so.slice.wallet"
  uuid: string
}

export type SliceWalletEip6963ProviderDetail = {
  info: SliceWalletEip6963ProviderInfo
  provider: SliceWalletProvider
}
