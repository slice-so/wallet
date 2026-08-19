import type { Hex } from "viem"
import type {
  WalletExecutionPermissionPolicy,
  WalletExecutionPermissionStatus
} from "./executionPermission"

export type SliceWalletOwnerListRequest = {
  action: "list_permissions"
  cursor: { createdAt: string; id: string } | null
  limit: number
  signerScheme: "p256" | null
  statuses: readonly WalletExecutionPermissionStatus[]
}

export type SliceWalletOwnerGetRequest = {
  action: "get_permission"
  delegationId: string
}

export type SliceWalletOwnerFinalizeP256Request = {
  action: "finalize_p256_revocation"
  delegationId: string
  expectedDisableCallHash: Hex
  userOperationHash: Hex
}

export type SliceWalletOwnerRequest =
  | SliceWalletOwnerFinalizeP256Request
  | SliceWalletOwnerGetRequest
  | SliceWalletOwnerListRequest

type SliceWalletOwnerPermissionBase = {
  appOrigin: string
  chainId: number
  createdAt: string
  expiresAt: string
  id: string
  permissionId: Hex
  policy: WalletExecutionPermissionPolicy
  status: WalletExecutionPermissionStatus | "expired"
}

export type SliceWalletOwnerPermission = SliceWalletOwnerPermissionBase & {
  grantKind: "checkout" | "management"
  signerScheme: "p256"
}
