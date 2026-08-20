import {
  type Address,
  encodeAbiParameters,
  type Hex,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  stringToHex
} from "viem"
import { assertSliceWalletAccountIndex } from "./accountIndex"
import { maximumBrowserGenericGrantTtlSec } from "./constants"
import {
  hashSliceWalletAppPermissionRegistrationFields,
  hashSliceWalletAppPermissionRequestFields,
  hashSliceWalletAppPermissionRootAuthorizationFields
} from "./frame/messages"
import { getSliceWalletP256SignerId } from "./p256Server"
import {
  getWalletPermissionId,
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor,
  serializeWalletPolicyDescriptor
} from "./policy"
import type {
  SliceWalletAppPermissionFinalizeRevocationPayload,
  SliceWalletAppPermissionIdentity,
  SliceWalletAppPermissionJsonValue,
  SliceWalletAppPermissionLifecycleAuthorizationInput,
  SliceWalletAppPermissionLifecycleRequestInput,
  SliceWalletAppPermissionPolicyDescriptor,
  SliceWalletAppPermissionRecord,
  SliceWalletAppPermissionRegistrationAuthorizationInput
} from "./types/appPermission"
import type { WalletPolicyJsonValue } from "./types/policy"

export const sliceWalletAppPermissionStatuses = [
  "authorized",
  "active",
  "revoked",
  "expired",
  "invalid"
] as const

type AppPermissionRecord = {
  readonly [key: string]: SliceWalletAppPermissionJsonValue | undefined
}

const record = (
  value: SliceWalletAppPermissionJsonValue,
  label: string
): AppPermissionRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

const assertOnlyKeys = (
  value: AppPermissionRecord,
  keys: readonly string[],
  label: string
) => {
  const allowed = new Set(keys)
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} contains an unknown or missing field.`)
  }
}

const address = (
  value: SliceWalletAppPermissionJsonValue | undefined,
  label: string
) => {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${label} must be an address.`)
  }
  return value.toLowerCase() as Address
}

const fixedHex = (
  value: SliceWalletAppPermissionJsonValue | undefined,
  size: number,
  label: string
) => {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value !== value.toLowerCase() ||
    value.length !== 2 + size * 2
  ) {
    throw new Error(`${label} must be canonical ${size}-byte hex.`)
  }
  return value as Hex
}

const positiveInteger = (
  value: SliceWalletAppPermissionJsonValue | undefined,
  label: string
) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`)
  }
  return value
}

export const normalizeSliceWalletAppOrigin = (value: string) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Application origin is invalid.")
  }
  const isLoopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  if (
    (url.protocol !== "https:" && !isLoopback) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Application origin must be HTTPS, or HTTP on a loopback host."
    )
  }
  return url.origin
}

export const normalizeSliceWalletAppPermissionIdentity = (
  identity: SliceWalletAppPermissionIdentity
): SliceWalletAppPermissionIdentity => {
  const policy = parseSerializedWalletPolicyDescriptor(
    identity.policy as WalletPolicyJsonValue
  )
  const accountAddress = address(identity.accountAddress, "Permission account")
  const signerAddress = address(identity.signerAddress, "Permission signer")
  const signerPublicKey = fixedHex(
    identity.signerPublicKey,
    65,
    "Permission signer public key"
  )
  if (
    !signerPublicKey.startsWith("0x04") ||
    policy.grantKind !== "generic" ||
    !isAddressEqual(policy.account, accountAddress) ||
    policy.chainId !== identity.chainId ||
    policy.validUntil - policy.validAfter >
      maximumBrowserGenericGrantTtlSec + 300
  ) {
    throw new Error("Generic permission policy identity is inconsistent.")
  }
  const policyHash = getWalletPolicyHash(policy)
  const expectedSigner = getSliceWalletP256SignerId(signerPublicKey)
  const permissionId = getWalletPermissionId(policy, expectedSigner)
  if (
    !isAddressEqual(signerAddress, expectedSigner) ||
    identity.policyHash.toLowerCase() !== policyHash.toLowerCase() ||
    identity.permissionId.toLowerCase() !== permissionId.toLowerCase()
  ) {
    throw new Error("Generic permission derived identity does not match.")
  }
  return {
    accountAddress,
    accountIndex: assertSliceWalletAccountIndex(identity.accountIndex),
    appOrigin: normalizeSliceWalletAppOrigin(identity.appOrigin),
    chainId: positiveInteger(identity.chainId, "Permission chain id"),
    permissionId,
    policy: {
      ...serializeWalletPolicyDescriptor(policy),
      grantKind: "generic"
    } satisfies SliceWalletAppPermissionPolicyDescriptor,
    policyHash,
    signerAddress: expectedSigner,
    signerPublicKey
  }
}

export const parseSliceWalletAppPermissionIdentity = (
  value: SliceWalletAppPermissionJsonValue
) => {
  const input = record(value, "Application permission identity")
  assertOnlyKeys(
    input,
    [
      "accountAddress",
      "accountIndex",
      "appOrigin",
      "chainId",
      "permissionId",
      "policy",
      "policyHash",
      "signerAddress",
      "signerPublicKey"
    ],
    "Application permission identity"
  )
  if (
    typeof input.accountIndex !== "number" ||
    !Number.isSafeInteger(input.accountIndex) ||
    typeof input.appOrigin !== "string" ||
    typeof input.policy !== "object" ||
    input.policy === null ||
    Array.isArray(input.policy)
  ) {
    throw new Error("Application permission identity is invalid.")
  }
  return normalizeSliceWalletAppPermissionIdentity({
    accountAddress: address(input.accountAddress, "Permission account"),
    accountIndex: assertSliceWalletAccountIndex(input.accountIndex),
    appOrigin: input.appOrigin,
    chainId: positiveInteger(input.chainId, "Permission chain id"),
    permissionId: fixedHex(input.permissionId, 4, "Permission id"),
    policy: input.policy as SliceWalletAppPermissionPolicyDescriptor,
    policyHash: fixedHex(input.policyHash, 32, "Permission policy hash"),
    signerAddress: address(input.signerAddress, "Permission signer"),
    signerPublicKey: fixedHex(
      input.signerPublicKey,
      65,
      "Permission signer public key"
    )
  })
}

const isoTimestamp = (
  value: SliceWalletAppPermissionJsonValue | undefined,
  label: string,
  nullable = false
) => {
  if (nullable && value === null) return null
  if (typeof value !== "string") {
    throw new Error(`${label} must be an ISO timestamp.`)
  }
  const timestamp = Date.parse(value)
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp.`)
  }
  return value
}

export const parseSliceWalletAppPermissionRecord = (
  value: SliceWalletAppPermissionJsonValue
): SliceWalletAppPermissionRecord => {
  const input = record(value, "Application permission record")
  assertOnlyKeys(
    input,
    [
      "accountAddress",
      "accountIndex",
      "activatedAt",
      "appOrigin",
      "chainId",
      "createdAt",
      "enableNonce",
      "expiresAt",
      "id",
      "permissionId",
      "policy",
      "policyHash",
      "revocationUserOperationHash",
      "revokedAt",
      "signerAddress",
      "signerPublicKey",
      "status"
    ],
    "Application permission record"
  )
  const identity = parseSliceWalletAppPermissionIdentity({
    accountAddress: input.accountAddress,
    accountIndex: input.accountIndex,
    appOrigin: input.appOrigin,
    chainId: input.chainId,
    permissionId: input.permissionId,
    policy: input.policy,
    policyHash: input.policyHash,
    signerAddress: input.signerAddress,
    signerPublicKey: input.signerPublicKey
  })
  const activatedAt = isoTimestamp(input.activatedAt, "Activation time", true)
  const createdAt = isoTimestamp(input.createdAt, "Creation time")
  const expiresAt = isoTimestamp(input.expiresAt, "Expiry time")
  const enableNonce =
    typeof input.enableNonce === "string" && /^\d+$/.test(input.enableNonce)
      ? BigInt(input.enableNonce).toString()
      : null
  const revokedAt = isoTimestamp(input.revokedAt, "Revocation time", true)
  const status = sliceWalletAppPermissionStatuses.find(
    (candidate) => candidate === input.status
  )
  const revocationUserOperationHash =
    input.revocationUserOperationHash === null
      ? null
      : fixedHex(
          input.revocationUserOperationHash,
          32,
          "Revocation UserOperation hash"
        )
  if (
    typeof input.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      input.id
    ) ||
    status === undefined ||
    enableNonce === null ||
    new Date(expiresAt as string).getTime() !==
      identity.policy.validUntil * 1_000
  ) {
    throw new Error("Application permission record is invalid.")
  }
  const lifecycleIsConsistent =
    status === "invalid" ||
    (status === "authorized" &&
      activatedAt === null &&
      revokedAt === null &&
      revocationUserOperationHash === null) ||
    (status === "active" &&
      activatedAt !== null &&
      revokedAt === null &&
      revocationUserOperationHash === null) ||
    (status === "expired" &&
      revokedAt === null &&
      revocationUserOperationHash === null) ||
    (status === "revoked" && revokedAt !== null)
  if (!lifecycleIsConsistent) {
    throw new Error("Application permission lifecycle is inconsistent.")
  }
  return {
    ...identity,
    activatedAt,
    createdAt: createdAt as string,
    enableNonce,
    expiresAt: expiresAt as string,
    id: input.id,
    revocationUserOperationHash,
    revokedAt,
    status
  }
}

const toAppPermissionIdentityFields = (
  identity: SliceWalletAppPermissionIdentity
) => {
  const normalized = normalizeSliceWalletAppPermissionIdentity(identity)
  return {
    accountAddress: normalized.accountAddress,
    accountIndex: normalized.accountIndex,
    appOrigin: normalized.appOrigin,
    chainId: normalized.chainId,
    permissionId: normalized.permissionId,
    policyHash: normalized.policyHash,
    signerAddress: normalized.signerAddress,
    signerPublicKey: normalized.signerPublicKey
  }
}

export const hashSliceWalletAppPermissionRequest = (
  identity: SliceWalletAppPermissionIdentity
) =>
  hashSliceWalletAppPermissionRequestFields(
    toAppPermissionIdentityFields(identity)
  )

const toAppPermissionAuthorizationFields = (
  input: SliceWalletAppPermissionRegistrationAuthorizationInput
) => {
  if (input.action !== "register") {
    throw new Error("Unsupported application permission action.")
  }
  if (
    !Number.isSafeInteger(input.challengeExpiresAt) ||
    input.challengeExpiresAt <= 0
  ) {
    throw new Error("Application permission challenge expiry is invalid.")
  }
  const requestHash = fixedHex(input.requestHash, 32, "Permission request hash")
  const expectedRequestHash = hashSliceWalletAppPermissionRequest(input)
  if (requestHash !== expectedRequestHash) {
    throw new Error("Application permission request hash does not match.")
  }
  return {
    ...toAppPermissionIdentityFields(input),
    action: input.action,
    challenge: fixedHex(input.challenge, 32, "Permission challenge"),
    challengeExpiresAt: input.challengeExpiresAt,
    requestHash
  }
}

export const hashSliceWalletAppPermissionRootAuthorization = (
  input: SliceWalletAppPermissionRegistrationAuthorizationInput
) =>
  hashSliceWalletAppPermissionRootAuthorizationFields(
    toAppPermissionAuthorizationFields(input)
  )

export const hashSliceWalletAppPermissionRegistration = (
  input: SliceWalletAppPermissionRegistrationAuthorizationInput
) =>
  hashSliceWalletAppPermissionRegistrationFields(
    toAppPermissionAuthorizationFields(input)
  )

const lifecycleRequestDomain = keccak256(
  stringToHex("Slice Wallet App Permission Lifecycle Request v1")
)
const finalizeRevocationPayloadDomain = keccak256(
  stringToHex("Slice Wallet App Permission Finalize Revocation Payload v1")
)

export const hashSliceWalletAppPermissionFinalizeRevocationPayload = ({
  expectedDisableCallHash,
  permissionRowId,
  userOperationHash
}: SliceWalletAppPermissionFinalizeRevocationPayload) => {
  if (permissionRowId.length < 1 || permissionRowId.length > 256) {
    throw new Error("Application permission revocation row id is invalid.")
  }
  return keccak256(
    encodeAbiParameters(
      [
        { name: "domain", type: "bytes32" },
        { name: "permissionRowIdHash", type: "bytes32" },
        { name: "expectedDisableCallHash", type: "bytes32" },
        { name: "userOperationHash", type: "bytes32" }
      ],
      [
        finalizeRevocationPayloadDomain,
        keccak256(stringToHex(permissionRowId)),
        fixedHex(expectedDisableCallHash, 32, "Expected disable call hash"),
        fixedHex(userOperationHash, 32, "Revocation user operation hash")
      ]
    )
  )
}
const lifecycleRootAuthorizationDomain = keccak256(
  stringToHex("Slice Wallet App Permission Lifecycle Root Authorization v1")
)

const assertLifecycleAction = (
  action: SliceWalletAppPermissionLifecycleRequestInput["action"]
) => {
  if (action !== "finalize_revocation") {
    throw new Error("Unsupported application permission lifecycle action.")
  }
  return action
}

export const hashSliceWalletAppPermissionLifecycleRequest = ({
  accountAddress,
  action,
  chainId,
  payloadHash
}: SliceWalletAppPermissionLifecycleRequestInput) =>
  keccak256(
    encodeAbiParameters(
      [
        { name: "domain", type: "bytes32" },
        { name: "actionHash", type: "bytes32" },
        { name: "account", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "payloadHash", type: "bytes32" }
      ],
      [
        lifecycleRequestDomain,
        keccak256(stringToHex(assertLifecycleAction(action))),
        address(accountAddress, "Permission account"),
        BigInt(positiveInteger(chainId, "Permission chain id")),
        fixedHex(payloadHash, 32, "Permission lifecycle payload hash")
      ]
    )
  )

export const hashSliceWalletAppPermissionLifecycleRootAuthorization = (
  input: SliceWalletAppPermissionLifecycleAuthorizationInput & {
    payloadHash: Hex
  }
) => {
  const requestHash = fixedHex(
    input.requestHash,
    32,
    "Permission lifecycle request hash"
  )
  const expectedRequestHash = hashSliceWalletAppPermissionLifecycleRequest({
    accountAddress: input.accountAddress,
    action: input.action,
    chainId: input.chainId,
    payloadHash: input.payloadHash
  })
  if (requestHash !== expectedRequestHash) {
    throw new Error("Permission lifecycle request hash does not match.")
  }
  if (
    !Number.isSafeInteger(input.challengeExpiresAt) ||
    input.challengeExpiresAt <= 0
  ) {
    throw new Error("Permission lifecycle challenge expiry is invalid.")
  }
  return keccak256(
    encodeAbiParameters(
      [
        { name: "domain", type: "bytes32" },
        { name: "actionHash", type: "bytes32" },
        { name: "account", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "requestHash", type: "bytes32" },
        { name: "challenge", type: "bytes32" },
        { name: "challengeExpiresAt", type: "uint48" }
      ],
      [
        lifecycleRootAuthorizationDomain,
        keccak256(stringToHex(assertLifecycleAction(input.action))),
        address(input.accountAddress, "Permission account"),
        BigInt(positiveInteger(input.chainId, "Permission chain id")),
        requestHash,
        fixedHex(input.challenge, 32, "Permission lifecycle challenge"),
        input.challengeExpiresAt
      ]
    )
  )
}
