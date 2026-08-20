import type { Address, Hex } from "viem"
import type { sliceWalletAppPermissionStatuses } from "../appPermission"

export type SliceWalletAppPermissionStatus =
  (typeof sliceWalletAppPermissionStatuses)[number]

export type SliceWalletAppPermissionPolicyDescriptor = {
  account: Address
  calls: {
    parameterRules: {
      condition: "equal" | "greater_than" | "less_than_or_equal" | "not_equal"
      offset: number
      params: Hex[]
    }[]
    selector: Hex
    target: Address
    valueLimit: string
  }[]
  chainId: number
  grantKind: "generic"
  rateLimit?: {
    count: number
    intervalSec: number
  }
  validAfter: number
  validUntil: number
  version: 1
}

export type SliceWalletAppPermissionIdentity = {
  accountAddress: Address
  accountIndex: number
  appOrigin: string
  chainId: number
  permissionId: Hex
  policy: SliceWalletAppPermissionPolicyDescriptor
  policyHash: Hex
  signerAddress: Address
  signerPublicKey: Hex
}

export type SliceWalletAppPermissionRecord =
  SliceWalletAppPermissionIdentity & {
    activatedAt: string | null
    createdAt: string
    enableNonce: string
    expiresAt: string
    id: string
    revocationUserOperationHash: Hex | null
    revokedAt: string | null
    status: SliceWalletAppPermissionStatus
  }

export type SliceWalletAppPermissionRegistrationAuthorizationInput =
  SliceWalletAppPermissionIdentity & {
    action: "register"
    challenge: Hex
    challengeExpiresAt: number
    requestHash: Hex
  }

export type SliceWalletAppPermissionLifecycleAction = "finalize_revocation"

export type SliceWalletAppPermissionLifecycleAuthorizationInput = {
  accountAddress: Address
  action: SliceWalletAppPermissionLifecycleAction
  chainId: number
  challenge: Hex
  challengeExpiresAt: number
  requestHash: Hex
}

export type SliceWalletAppPermissionLifecycleRequestInput = {
  accountAddress: Address
  action: SliceWalletAppPermissionLifecycleAction
  chainId: number
  payloadHash: Hex
}

export type SliceWalletAppPermissionFinalizeRevocationPayload = {
  expectedDisableCallHash: Hex
  permissionRowId: string
  userOperationHash: Hex
}

export type SliceWalletAppPermissionJsonValue =
  | boolean
  | null
  | number
  | string
  | SliceWalletAppPermissionJsonValue[]
  | {
      readonly [key: string]: SliceWalletAppPermissionJsonValue | undefined
    }
