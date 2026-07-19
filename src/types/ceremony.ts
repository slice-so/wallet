import type { Address, Hex } from "viem"
import type {
  CreateSliceWalletRegisteredKernelAccountParameters,
  SliceWalletRootSignatureRequest
} from "./account"
import type {
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization
} from "./frame"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletPopupRequiredReason
} from "./pendingCeremony"
import type { SliceWalletRegistryCredential } from "./registry"

export type SliceWalletCeremonyMode = "auto" | "iframe" | "popup"

export type SliceWalletCeremonyReadyMessage = {
  type: "slice-wallet:ceremony-ready"
  version: 1
}

export type SliceWalletCeremonyConnectMessage = {
  nonce: Hex
  type: "slice-wallet:ceremony-connect"
  version: 1
}

export type SliceWalletCeremonyAuthorizationMessage = {
  authorization: SliceWalletPermissionAuthorization
  nonce: Hex
  type: "slice-wallet:ceremony-authorization"
  version: 1
}

export type SliceWalletCeremonyAuthorizationsMessage = {
  authorizations: readonly SliceWalletPermissionAuthorization[]
  nonce: Hex
  type: "slice-wallet:ceremony-authorizations"
  version: 1
}

export type SliceWalletCeremonyErrorMessage = {
  code: "authorization_failed" | "bridge_unavailable" | "invalid_request"
  message: string
  nonce: Hex
  type: "slice-wallet:ceremony-error"
  version: 1
}

export type SliceWalletCeremonyPopupRequiredMessage = {
  nonce: Hex
  reason: SliceWalletPopupRequiredReason
  type: "slice-wallet:popup-required"
  version: 1
}

export type SliceWalletCeremonyResponse =
  | SliceWalletCeremonyAuthorizationMessage
  | SliceWalletCeremonyAuthorizationsMessage
  | SliceWalletCeremonyErrorMessage
  | SliceWalletCeremonyPopupRequiredMessage

export type SliceWalletCeremonyAccountMessage = {
  account: Address
  credentialIdHash: Hex
  nonce: Hex
  recovery?: {
    permissionId: Hex
    signerAddress: Address
  }
  type: "slice-wallet:ceremony-account"
  version: 1
}

export type SliceWalletCeremonyAccountResponse =
  | SliceWalletCeremonyAccountMessage
  | SliceWalletCeremonyErrorMessage
  | SliceWalletCeremonyPopupRequiredMessage

export type SliceWalletConnectedAccount = SliceWalletRegistryCredential & {
  recovery?: {
    permissionId: Hex
    signerAddress: Address
  }
}

export type SliceWalletCeremonyRootSignRequest = {
  account: Address
  chainId: number
  nonce: Hex
  request: SliceWalletRootSignatureRequest
  type: "slice-wallet:root-sign-request"
  version: 1
}

export type SliceWalletCeremonyRootSignatureMessage = {
  hash: Hex
  nonce: Hex
  signature: Hex
  type: "slice-wallet:root-signature"
  version: 1
}

export type SliceWalletCeremonyRootResponse =
  | SliceWalletCeremonyRootSignatureMessage
  | SliceWalletCeremonyErrorMessage
  | SliceWalletCeremonyPopupRequiredMessage

export type SliceWalletCeremonyDeviceMessage = {
  account: Address
  action: "add" | "promote" | "remove"
  chainId: number
  credentialIdHash: Hex
  nonce: Hex
  permissionId: Hex
  type: "slice-wallet:ceremony-device"
  userOperationHash: Hex | null
  version: 1
}

export type SliceWalletCeremonyDeviceResponse =
  | SliceWalletCeremonyDeviceMessage
  | SliceWalletCeremonyErrorMessage
  | SliceWalletCeremonyPopupRequiredMessage

export type AuthorizeSliceWalletSessionParameters = {
  ceremonyBroker?: SliceWalletCeremonyBroker
  ceremonyMode?: SliceWalletCeremonyMode
  document?: Document
  idOrigin: string
  popupReadyTimeoutMs?: number
  session: SliceWalletFrameSession
  timeoutMs?: number
  window: Window
}

export type AuthorizeSliceWalletSessionsParameters = Omit<
  AuthorizeSliceWalletSessionParameters,
  "session"
> & {
  sessions: readonly SliceWalletFrameSession[]
}

export type ConnectSliceWalletAccountParameters = {
  ceremonyBroker?: SliceWalletCeremonyBroker
  chainId: number
  fetch?: typeof fetch
  idOrigin: string
  timeoutMs?: number
  window: Window
}

export type CreateSliceWalletCeremonyRootSignerParameters = {
  account: Address
  ceremonyMode?: SliceWalletCeremonyMode
  ceremonyBroker?: SliceWalletCeremonyBroker
  chainId: number
  document?: Document
  idOrigin: string
  timeoutMs?: number
  window: Window
}

export type CreateSliceWalletCeremonyKernelAccountParameters = Omit<
  CreateSliceWalletRegisteredKernelAccountParameters,
  "rootSigner"
> & {
  ceremonyBroker?: SliceWalletCeremonyBroker
  ceremonyMode?: SliceWalletCeremonyMode
  document?: Document
  idOrigin: string
  window: Window
}

export type ManageSliceWalletDeviceParameters = {
  account: Address
  ceremonyMode?: SliceWalletCeremonyMode
  ceremonyBroker?: SliceWalletCeremonyBroker
  chainId: number
  credentialIdHash?: Hex
  document?: Document
  idOrigin: string
  timeoutMs?: number
  window: Window
}
