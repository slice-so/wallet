import type { Address, Hex } from "viem"
import type { SliceWalletPermissionAuthorization } from "./frame"
import type { SliceWalletRegistryCredential } from "./registry"

export type SliceWalletPopupRequiredReason =
  | "capability_unsupported"
  | "io_v2_unsupported"
  | "popup_blocked"
  | "user_activation_expired"
  | "viewport_too_small"
  | "visibility_unstable"
  | "webauthn_unavailable"

export type SliceWalletPendingCeremonyKind =
  | "connect"
  | "device_enroll"
  | "device_handoff"
  | "device_promote"
  | "grant"
  | "recovery"
  | "root_sign"

export type SliceWalletPendingCeremony = {
  createdAt: number
  expiresAt: number
  kind: SliceWalletPendingCeremonyKind
  reason: SliceWalletPopupRequiredReason
}

export type SliceWalletCeremonyContinuationResult =
  | Hex
  | SliceWalletPermissionAuthorization
  | readonly SliceWalletPermissionAuthorization[]
  | {
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
  | {
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
  | {
      credentialId: string
      registry: SliceWalletRegistryCredential
    }

export type SliceWalletCeremonyBroker = {
  cancel: () => void
  continueInPopup: () => Promise<SliceWalletCeremonyContinuationResult>
  defer: <Result extends SliceWalletCeremonyContinuationResult>(input: {
    kind: SliceWalletPendingCeremonyKind
    reason: SliceWalletPopupRequiredReason
    resume: () => Promise<Result>
  }) => Promise<Result>
  getPending: () => SliceWalletPendingCeremony | null
  subscribe: (
    listener: (pending: SliceWalletPendingCeremony | null) => void
  ) => () => void
}
