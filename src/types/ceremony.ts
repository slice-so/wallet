import type { Address, Hex } from "viem"
import type {
  CreateSliceWalletRegisteredKernelAccountParameters,
  SliceWalletRootSignatureRequest
} from "./account"
import type {
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization,
  SliceWalletSignerFrameClient
} from "./frame"
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

export type SliceWalletCeremonyResponse =
  | SliceWalletCeremonyAuthorizationMessage
  | SliceWalletCeremonyAuthorizationsMessage
  | SliceWalletCeremonyErrorMessage

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

export type AuthorizeSliceWalletSessionParameters = {
  ceremonyMode?: SliceWalletCeremonyMode
  document?: Document
  frameClient: SliceWalletSignerFrameClient
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
  chainId: number
  fetch?: typeof fetch
  idOrigin: string
  timeoutMs?: number
  window: Window
}

export type CreateSliceWalletCeremonyRootSignerParameters = {
  account: Address
  ceremonyMode?: SliceWalletCeremonyMode
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
  ceremonyMode?: SliceWalletCeremonyMode
  document?: Document
  idOrigin: string
  window: Window
}

export type ManageSliceWalletDeviceParameters = {
  account: Address
  ceremonyMode?: SliceWalletCeremonyMode
  chainId: number
  credentialIdHash?: Hex
  document?: Document
  idOrigin: string
  timeoutMs?: number
  window: Window
}
