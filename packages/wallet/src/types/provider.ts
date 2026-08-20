import type { Address, Hex } from "viem"
import type { SliceWalletProtocolValue } from "../protocol/index"
import type { SliceWalletCeremonyMode } from "./ceremony"
import type {
  SliceWalletCeremonyExtensionInput,
  SliceWalletExtensionConnectResult
} from "./ceremonyExtension"
import type {
  SliceWalletCeremonyContinuationResult,
  SliceWalletPendingCeremony
} from "./pendingCeremony"

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

export type SliceWalletEip1193Provider = {
  cancelPendingCeremony: () => void
  continueInPopup: () => Promise<SliceWalletCeremonyContinuationResult>
  connectWithExtension: (
    extension: SliceWalletCeremonyExtensionInput
  ) => Promise<SliceWalletExtensionConnectResult>
  destroy: () => void
  readonly pendingCeremony: SliceWalletPendingCeremony | null
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
  requestExtension: (
    extension: SliceWalletCeremonyExtensionInput
  ) => Promise<SliceWalletProtocolValue>
  subscribePendingCeremony: (
    listener: (pending: SliceWalletPendingCeremony | null) => void
  ) => () => void
  switchAccount: () => Promise<Address>
}

export type SliceWalletTransportOverrides = {
  bundlerUrl?: string
  rpcUrl?: string
}

export type SliceWalletParameters = {
  ceremonyMode?: SliceWalletCeremonyMode
  chainIds?: readonly number[]
  defaultChainId?: number
  grantPermissions?: SliceWalletGrantPermissionsRequest & {
    optional?: boolean
  }
  idOrigin?: string
  transports?: Readonly<Record<number, SliceWalletTransportOverrides>>
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

export type SliceWalletGenericPermissionRule = Omit<
  SliceWalletGenericPermission,
  "policies"
>

export type SliceWalletGenericRateLimit = {
  count: number
  intervalSec: number
}

export type SliceWalletGrantPermissionsRequest = {
  expiry: number
  permissions: readonly SliceWalletGenericPermission[]
}

export type SliceWalletPermissionRequestInput = {
  expiry: number
  rateLimit: SliceWalletGenericRateLimit
  rules: readonly SliceWalletGenericPermissionRule[]
}

export type SliceWalletPermissionGrant = {
  account: Address
  chainId: number
  createdAt: number
  expiresAt: number
  permissionId: Hex
  permissions: readonly SliceWalletGenericPermission[]
  version: "1"
}

export type SliceWalletPermissionCapabilities = {
  supportedTemplates: readonly [
    "native-transfer",
    "erc20-transfer",
    "erc20-approve",
    "erc20-transfer-from"
  ]
  version: "1"
}
