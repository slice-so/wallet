import {
  type Address,
  type Hex,
  hexToBytes,
  isAddress,
  isHex,
  keccak256,
  stringToHex
} from "viem"
import { assertSliceWalletAccountIndex } from "../accountIndex"
import { maximumBrowserGenericGrantTtlSec } from "../constants"
import { getSliceWalletP256SignerId } from "../p256Server"
import {
  getWalletPermissionId,
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor,
  serializeWalletPolicyDescriptor
} from "../policy"
import type {
  SliceWalletGenericPermission,
  SliceWalletProviderValue,
  SliceWalletRegistryCredential,
  WalletPolicyJsonValue
} from "../types"
import type {
  StoredGenericGrant,
  StoredGenericGrantRotation,
  StoredGenericGrantRotationPhase,
  StoredWalletCall
} from "../types/providerInternal"
import { parseSliceWalletGrantPermissions } from "./protocol"

const accountStorageKey = "slice.wallet.provider.account"
const grantStorageKey = (chainId: number, account: Address) =>
  `slice.wallet.provider.generic-grant:${chainId}:${account.toLowerCase()}`
const grantRotationStorageKey = (chainId: number, account: Address) =>
  `slice.wallet.provider.generic-rotation:${chainId}:${account.toLowerCase()}`
const callStoragePrefix = "slice.wallet.provider.call:"
const callRetentionMs = 24 * 60 * 60 * 1000

type StoredAccount = Pick<
  SliceWalletRegistryCredential,
  | "accountAddress"
  | "accountIndex"
  | "createdAt"
  | "credentialIdHash"
  | "factoryVersion"
  | "publicKey"
  | "recoveryPermissionId"
  | "recoverySignerAddress"
  | "registrationKind"
>

type StoredRecord = {
  readonly [key: string]: SliceWalletProviderValue | undefined
}

const parseJson = (value: string): SliceWalletProviderValue =>
  JSON.parse(value) as SliceWalletProviderValue

const record = (value: SliceWalletProviderValue): StoredRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as StoredRecord)
    : null

const hasOnlyKeys = (value: StoredRecord, keys: readonly string[]) => {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

const read = (storage: Storage | null, key: string) => {
  if (storage === null) return null
  try {
    const value = storage.getItem(key)
    return value === null ? null : parseJson(value)
  } catch {
    return null
  }
}

const write = (storage: Storage | null, key: string, value: object) => {
  if (storage === null) return false
  try {
    const serialized = JSON.stringify(value)
    storage.setItem(key, serialized)
    return storage.getItem(key) === serialized
  } catch {
    return false
  }
}

const remove = (storage: Storage | null, key: string) => {
  if (storage === null) return false
  try {
    storage.removeItem(key)
    return storage.getItem(key) === null
  } catch {
    return false
  }
}

export const readStoredSliceWalletAccount = (
  storage: Storage | null
): StoredAccount | null => {
  const input = read(storage, accountStorageKey)
  const value = input === null ? null : record(input)
  if (
    value === null ||
    !hasOnlyKeys(value, [
      "accountAddress",
      "accountIndex",
      "createdAt",
      "credentialIdHash",
      "factoryVersion",
      "publicKey",
      "recoveryPermissionId",
      "recoverySignerAddress",
      "registrationKind"
    ]) ||
    typeof value.accountAddress !== "string" ||
    !isAddress(value.accountAddress) ||
    typeof value.accountIndex !== "number" ||
    !Number.isInteger(value.accountIndex) ||
    value.accountIndex < 0 ||
    value.accountIndex > 31 ||
    typeof value.credentialIdHash !== "string" ||
    !isHex(value.credentialIdHash, { strict: true }) ||
    hexToBytes(value.credentialIdHash).length !== 32 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.factoryVersion !== "string" ||
    value.factoryVersion.length === 0 ||
    typeof value.publicKey !== "string" ||
    !/^0x04[0-9a-fA-F]{128}$/.test(value.publicKey) ||
    (value.recoveryPermissionId !== null &&
      (typeof value.recoveryPermissionId !== "string" ||
        !/^0x[0-9a-fA-F]{8}$/.test(value.recoveryPermissionId))) ||
    (value.recoverySignerAddress !== null &&
      (typeof value.recoverySignerAddress !== "string" ||
        !isAddress(value.recoverySignerAddress))) ||
    (value.recoveryPermissionId === null) !==
      (value.recoverySignerAddress === null) ||
    (value.registrationKind !== "device" &&
      value.registrationKind !== "existing_account" &&
      value.registrationKind !== "initial" &&
      value.registrationKind !== "sub_account")
  ) {
    remove(storage, accountStorageKey)
    return null
  }
  return {
    accountAddress: value.accountAddress,
    accountIndex: assertSliceWalletAccountIndex(value.accountIndex),
    createdAt: value.createdAt,
    credentialIdHash: value.credentialIdHash,
    factoryVersion: value.factoryVersion,
    publicKey: value.publicKey as Hex,
    recoveryPermissionId: value.recoveryPermissionId as Hex | null,
    recoverySignerAddress: value.recoverySignerAddress as Address | null,
    registrationKind: value.registrationKind
  }
}

export const writeStoredSliceWalletAccount = (
  storage: Storage | null,
  account: StoredAccount
) => write(storage, accountStorageKey, account)

export const clearStoredSliceWalletAccount = (storage: Storage | null) =>
  remove(storage, accountStorageKey)

const parseStoredSliceWalletGrant = (
  input: SliceWalletProviderValue,
  now: number
): StoredGenericGrant | null => {
  const value = record(input)
  if (
    value === null ||
    !hasOnlyKeys(value, [
      "account",
      "chainId",
      "createdAt",
      "enableSignature",
      "expiresAt",
      "permissionId",
      "permissions",
      "policy",
      "publicKey",
      "signerId"
    ]) ||
    typeof value.account !== "string" ||
    !isAddress(value.account) ||
    typeof value.chainId !== "number" ||
    !Number.isSafeInteger(value.chainId) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt > now ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= now ||
    value.expiresAt - value.createdAt > maximumBrowserGenericGrantTtlSec ||
    typeof value.permissionId !== "string" ||
    !/^0x[0-9a-fA-F]{8}$/.test(value.permissionId) ||
    typeof value.publicKey !== "string" ||
    !/^0x04[0-9a-fA-F]{128}$/.test(value.publicKey) ||
    typeof value.signerId !== "string" ||
    !isAddress(value.signerId) ||
    typeof value.enableSignature !== "string" ||
    !isHex(value.enableSignature, { strict: true }) ||
    !Array.isArray(value.permissions) ||
    value.permissions.length < 1 ||
    value.permissions.length > 16 ||
    typeof value.policy !== "object" ||
    value.policy === null ||
    Array.isArray(value.policy)
  )
    return null
  try {
    const policy = parseSerializedWalletPolicyDescriptor(
      value.policy as WalletPolicyJsonValue
    )
    const parsedRequest = parseSliceWalletGrantPermissions({
      account: value.account,
      chainId: value.chainId,
      now: value.createdAt,
      params: [
        {
          expiry: value.expiresAt,
          permissions: value.permissions
        }
      ]
    })
    const expectedPolicy = {
      ...parsedRequest.policy,
      validAfter: policy.validAfter
    }
    if (
      policy.grantKind !== "generic" ||
      policy.account.toLowerCase() !== value.account.toLowerCase() ||
      policy.chainId !== value.chainId ||
      policy.validUntil !== value.expiresAt ||
      policy.validAfter > value.createdAt ||
      value.createdAt - policy.validAfter > 600 ||
      getWalletPolicyHash(expectedPolicy) !== getWalletPolicyHash(policy) ||
      getSliceWalletP256SignerId(value.publicKey as Hex).toLowerCase() !==
        value.signerId.toLowerCase() ||
      getWalletPermissionId(policy, value.signerId).toLowerCase() !==
        value.permissionId.toLowerCase()
    ) {
      throw new Error("Stored permission policy does not match its grant.")
    }
    return {
      account: value.account,
      chainId: value.chainId,
      createdAt: value.createdAt,
      enableSignature: value.enableSignature,
      expiresAt: value.expiresAt,
      permissionId: value.permissionId as Hex,
      permissions:
        parsedRequest.permissions as readonly SliceWalletGenericPermission[],
      policy: serializeWalletPolicyDescriptor(policy),
      publicKey: value.publicKey as Hex,
      signerId: value.signerId
    }
  } catch {
    return null
  }
}

export const readStoredSliceWalletGrant = (
  storage: Storage | null,
  chainId: number,
  account: Address,
  now = Math.floor(Date.now() / 1000)
): StoredGenericGrant | null => {
  const input = read(storage, grantStorageKey(chainId, account))
  if (input === null) return null
  const grant = parseStoredSliceWalletGrant(input, now)
  if (
    grant === null ||
    grant.chainId !== chainId ||
    grant.account.toLowerCase() !== account.toLowerCase()
  ) {
    clearStoredSliceWalletGrant(storage, chainId, account)
    return null
  }
  return grant
}

export const writeStoredSliceWalletGrant = (
  storage: Storage | null,
  grant: StoredGenericGrant
) => write(storage, grantStorageKey(grant.chainId, grant.account), grant)

export const clearStoredSliceWalletGrant = (
  storage: Storage | null,
  chainId: number,
  account: Address
) => remove(storage, grantStorageKey(chainId, account))

const grantRotationPhases = new Set<StoredGenericGrantRotationPhase>([
  "prepared",
  "submitting",
  "submitted",
  "installed",
  "predecessor-disabled",
  "frame-committed",
  "active-grant-committed"
])

const grantsMatch = (left: StoredGenericGrant, right: StoredGenericGrant) =>
  left.account.toLowerCase() === right.account.toLowerCase() &&
  left.chainId === right.chainId &&
  left.createdAt === right.createdAt &&
  left.enableSignature.toLowerCase() === right.enableSignature.toLowerCase() &&
  left.expiresAt === right.expiresAt &&
  left.permissionId.toLowerCase() === right.permissionId.toLowerCase() &&
  JSON.stringify(left.permissions) === JSON.stringify(right.permissions) &&
  JSON.stringify(left.policy) === JSON.stringify(right.policy) &&
  left.publicKey.toLowerCase() === right.publicKey.toLowerCase() &&
  left.signerId.toLowerCase() === right.signerId.toLowerCase()

export const readStoredSliceWalletGrantRotation = (
  storage: Storage | null,
  chainId: number,
  account: Address,
  now = Math.floor(Date.now() / 1000)
): StoredGenericGrantRotation | null => {
  const key = grantRotationStorageKey(chainId, account)
  const input = read(storage, key)
  if (input === null) return null
  const value = record(input)
  const invalid = () => {
    remove(storage, key)
    return null
  }
  if (
    value === null ||
    !hasOnlyKeys(value, [
      "installationUserOperationHash",
      "phase",
      "predecessor",
      "replacement",
      "version"
    ]) ||
    value.version !== 1 ||
    typeof value.phase !== "string" ||
    !grantRotationPhases.has(value.phase as StoredGenericGrantRotationPhase) ||
    typeof value.predecessor !== "object" ||
    value.predecessor === null ||
    Array.isArray(value.predecessor) ||
    typeof value.replacement !== "object" ||
    value.replacement === null ||
    Array.isArray(value.replacement) ||
    (value.installationUserOperationHash !== undefined &&
      (typeof value.installationUserOperationHash !== "string" ||
        !isHex(value.installationUserOperationHash, { strict: true }) ||
        hexToBytes(value.installationUserOperationHash).length !== 32))
  ) {
    return invalid()
  }
  const predecessor = parseStoredSliceWalletGrant(value.predecessor, now)
  const replacement = parseStoredSliceWalletGrant(value.replacement, now)
  if (
    predecessor === null ||
    replacement === null ||
    predecessor.account.toLowerCase() !== account.toLowerCase() ||
    replacement.account.toLowerCase() !== account.toLowerCase() ||
    predecessor.chainId !== chainId ||
    replacement.chainId !== chainId ||
    predecessor.permissionId.toLowerCase() ===
      replacement.permissionId.toLowerCase() ||
    JSON.stringify(predecessor.policy) !== JSON.stringify(replacement.policy) ||
    JSON.stringify(predecessor.permissions) !==
      JSON.stringify(replacement.permissions) ||
    (value.phase === "submitted" &&
      value.installationUserOperationHash === undefined) ||
    ((value.phase === "prepared" || value.phase === "submitting") &&
      value.installationUserOperationHash !== undefined)
  ) {
    return invalid()
  }
  return {
    ...(value.installationUserOperationHash === undefined
      ? {}
      : {
          installationUserOperationHash:
            value.installationUserOperationHash as Hex
        }),
    phase: value.phase as StoredGenericGrantRotationPhase,
    predecessor,
    replacement,
    version: 1
  }
}

export const writeStoredSliceWalletGrantRotation = (
  storage: Storage | null,
  rotation: StoredGenericGrantRotation
) =>
  write(
    storage,
    grantRotationStorageKey(
      rotation.replacement.chainId,
      rotation.replacement.account
    ),
    rotation
  )

export const clearStoredSliceWalletGrantRotation = (
  storage: Storage | null,
  chainId: number,
  account: Address
) => remove(storage, grantRotationStorageKey(chainId, account))

export const storedSliceWalletGrantsMatch = grantsMatch

const callStorageKey = (id: string) =>
  `${callStoragePrefix}${keccak256(stringToHex(id))}`

export const readStoredSliceWalletCall = (
  storage: Storage | null,
  id: string,
  now = Date.now()
): StoredWalletCall | null => {
  const input = read(storage, callStorageKey(id))
  const value = input === null ? null : record(input)
  if (
    value === null ||
    !hasOnlyKeys(value, ["chainId", "createdAt", "id", "userOperationHash"]) ||
    value.id !== id ||
    typeof value.chainId !== "number" ||
    !Number.isSafeInteger(value.chainId) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    now - value.createdAt > callRetentionMs ||
    typeof value.userOperationHash !== "string" ||
    !isHex(value.userOperationHash, { strict: true }) ||
    hexToBytes(value.userOperationHash).length !== 32
  ) {
    remove(storage, callStorageKey(id))
    return null
  }
  return {
    chainId: value.chainId,
    createdAt: value.createdAt,
    id,
    userOperationHash: value.userOperationHash
  }
}

export const writeStoredSliceWalletCall = (
  storage: Storage | null,
  call: StoredWalletCall
) => write(storage, callStorageKey(call.id), call)
