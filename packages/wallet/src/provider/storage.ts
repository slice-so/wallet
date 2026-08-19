import {
  getWalletPermissionId,
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor,
  serializeWalletPolicyDescriptor
} from "@slicekit/wallet-primitives/policy"
import type { WalletPolicyJsonValue } from "@slicekit/wallet-primitives/server"
import {
  assertSliceWalletAccountIndex,
  getSliceWalletP256SignerId,
  maximumBrowserGenericGrantTtlSec
} from "@slicekit/wallet-primitives/server"
import {
  type Address,
  type Hex,
  hexToBigInt,
  hexToBytes,
  isAddress,
  isHex,
  keccak256,
  stringToHex,
  toHex,
  zeroAddress
} from "viem"
import {
  entryPoint07Address,
  getUserOperationHash,
  type UserOperation
} from "viem/account-abstraction"
import type {
  SliceWalletGenericPermission,
  SliceWalletProviderValue,
  SliceWalletRegistryCredential
} from "../types"
import type {
  StoredGenericGrant,
  StoredGenericGrantInstallation,
  StoredGenericGrantInstallationUserOperation,
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
  "transport-pending",
  "submitted",
  "installed",
  "predecessor-disabled",
  "frame-committed",
  "active-grant-committed"
])

const parseCanonicalAddress = (
  value: SliceWalletProviderValue | undefined
): Address | null =>
  typeof value === "string" &&
  value === value.toLowerCase() &&
  isAddress(value) &&
  value !== zeroAddress
    ? value
    : null

const parseCanonicalData = (
  value: SliceWalletProviderValue | undefined
): Hex | null =>
  typeof value === "string" &&
  value === value.toLowerCase() &&
  value.length % 2 === 0 &&
  isHex(value, { strict: true })
    ? value
    : null

const parseCanonicalQuantity = (
  value: SliceWalletProviderValue | undefined
): Hex | null => {
  if (
    typeof value !== "string" ||
    value !== value.toLowerCase() ||
    !isHex(value, { strict: true })
  ) {
    return null
  }
  try {
    return toHex(hexToBigInt(value)) === value ? value : null
  } catch {
    return null
  }
}

const parseStoredGrantInstallationUserOperation = (
  input: SliceWalletProviderValue | undefined
): StoredGenericGrantInstallationUserOperation | null => {
  const value = input === undefined ? null : record(input)
  if (
    value === null ||
    !hasOnlyKeys(value, [
      "callData",
      "callGasLimit",
      "factory",
      "factoryData",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "nonce",
      "paymaster",
      "paymasterData",
      "paymasterPostOpGasLimit",
      "paymasterVerificationGasLimit",
      "preVerificationGas",
      "sender",
      "signature",
      "verificationGasLimit"
    ])
  ) {
    return null
  }
  const callData = parseCanonicalData(value.callData)
  const callGasLimit = parseCanonicalQuantity(value.callGasLimit)
  const factory =
    value.factory === undefined
      ? undefined
      : parseCanonicalAddress(value.factory)
  const factoryData =
    value.factoryData === undefined
      ? undefined
      : parseCanonicalData(value.factoryData)
  const maxFeePerGas = parseCanonicalQuantity(value.maxFeePerGas)
  const maxPriorityFeePerGas = parseCanonicalQuantity(
    value.maxPriorityFeePerGas
  )
  const nonce = parseCanonicalQuantity(value.nonce)
  const paymaster =
    value.paymaster === undefined
      ? undefined
      : parseCanonicalAddress(value.paymaster)
  const paymasterData =
    value.paymasterData === undefined
      ? undefined
      : parseCanonicalData(value.paymasterData)
  const paymasterPostOpGasLimit =
    value.paymasterPostOpGasLimit === undefined
      ? undefined
      : parseCanonicalQuantity(value.paymasterPostOpGasLimit)
  const paymasterVerificationGasLimit =
    value.paymasterVerificationGasLimit === undefined
      ? undefined
      : parseCanonicalQuantity(value.paymasterVerificationGasLimit)
  const preVerificationGas = parseCanonicalQuantity(value.preVerificationGas)
  const sender = parseCanonicalAddress(value.sender)
  const signature = parseCanonicalData(value.signature)
  const verificationGasLimit = parseCanonicalQuantity(
    value.verificationGasLimit
  )
  const hasFactory = factory !== undefined
  const hasPaymaster = paymaster !== undefined
  if (
    callData === null ||
    callData === "0x" ||
    callGasLimit === null ||
    maxFeePerGas === null ||
    maxPriorityFeePerGas === null ||
    nonce === null ||
    preVerificationGas === null ||
    sender === null ||
    signature === null ||
    signature === "0x" ||
    verificationGasLimit === null ||
    (value.factory !== undefined && factory === null) ||
    (value.factoryData !== undefined && factoryData === null) ||
    hasFactory !== (factoryData !== undefined) ||
    (value.paymaster !== undefined && paymaster === null) ||
    (value.paymasterData !== undefined && paymasterData === null) ||
    (value.paymasterPostOpGasLimit !== undefined &&
      paymasterPostOpGasLimit === null) ||
    (value.paymasterVerificationGasLimit !== undefined &&
      paymasterVerificationGasLimit === null) ||
    hasPaymaster !== (paymasterData !== undefined) ||
    hasPaymaster !== (paymasterPostOpGasLimit !== undefined) ||
    hasPaymaster !== (paymasterVerificationGasLimit !== undefined)
  ) {
    return null
  }
  const factoryFields =
    factory === undefined ? {} : { factory, factoryData: factoryData as Hex }
  const paymasterFields =
    paymaster === undefined
      ? {}
      : {
          paymaster,
          paymasterData: paymasterData as Hex,
          paymasterPostOpGasLimit: paymasterPostOpGasLimit as Hex,
          paymasterVerificationGasLimit: paymasterVerificationGasLimit as Hex
        }
  return {
    callData,
    callGasLimit,
    ...factoryFields,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
    ...paymasterFields,
    preVerificationGas,
    sender,
    signature,
    verificationGasLimit
  } as StoredGenericGrantInstallationUserOperation
}

export const deserializeStoredGenericGrantInstallationUserOperation = (
  value: StoredGenericGrantInstallationUserOperation
): UserOperation<"0.7"> => ({
  callData: value.callData,
  callGasLimit: hexToBigInt(value.callGasLimit),
  ...(value.factory === undefined
    ? {}
    : { factory: value.factory, factoryData: value.factoryData }),
  maxFeePerGas: hexToBigInt(value.maxFeePerGas),
  maxPriorityFeePerGas: hexToBigInt(value.maxPriorityFeePerGas),
  nonce: hexToBigInt(value.nonce),
  ...(value.paymaster === undefined
    ? {}
    : {
        paymaster: value.paymaster,
        paymasterData: value.paymasterData,
        paymasterPostOpGasLimit: hexToBigInt(value.paymasterPostOpGasLimit),
        paymasterVerificationGasLimit: hexToBigInt(
          value.paymasterVerificationGasLimit
        )
      }),
  preVerificationGas: hexToBigInt(value.preVerificationGas),
  sender: value.sender,
  signature: value.signature,
  verificationGasLimit: hexToBigInt(value.verificationGasLimit)
})

export const serializeStoredGenericGrantInstallationUserOperation = (
  userOperation: UserOperation<"0.7">
): StoredGenericGrantInstallationUserOperation => {
  if (userOperation.authorization !== undefined) {
    throw new Error(
      "Generic permission installation cannot persist EIP-7702 authorization."
    )
  }
  if (
    userOperation.paymaster !== undefined &&
    (userOperation.paymasterPostOpGasLimit === undefined ||
      userOperation.paymasterVerificationGasLimit === undefined)
  ) {
    throw new Error(
      "Generic permission installation paymaster fields are incomplete."
    )
  }
  const factoryFields =
    userOperation.factory === undefined
      ? {}
      : {
          factory: userOperation.factory.toLowerCase() as Address,
          factoryData: (userOperation.factoryData ?? "0x").toLowerCase() as Hex
        }
  const paymasterFields =
    userOperation.paymaster === undefined
      ? {}
      : {
          paymaster: userOperation.paymaster.toLowerCase() as Address,
          paymasterData: (
            userOperation.paymasterData ?? "0x"
          ).toLowerCase() as Hex,
          paymasterPostOpGasLimit: toHex(
            userOperation.paymasterPostOpGasLimit as bigint
          ),
          paymasterVerificationGasLimit: toHex(
            userOperation.paymasterVerificationGasLimit as bigint
          )
        }
  const serialized = {
    callData: userOperation.callData.toLowerCase() as Hex,
    callGasLimit: toHex(userOperation.callGasLimit),
    ...factoryFields,
    maxFeePerGas: toHex(userOperation.maxFeePerGas),
    maxPriorityFeePerGas: toHex(userOperation.maxPriorityFeePerGas),
    nonce: toHex(userOperation.nonce),
    ...paymasterFields,
    preVerificationGas: toHex(userOperation.preVerificationGas),
    sender: userOperation.sender.toLowerCase() as Address,
    signature: userOperation.signature.toLowerCase() as Hex,
    verificationGasLimit: toHex(userOperation.verificationGasLimit)
  } as StoredGenericGrantInstallationUserOperation
  const parsed = parseStoredGrantInstallationUserOperation(serialized)
  if (parsed === null) {
    throw new Error(
      "Generic permission installation UserOperation is not canonical."
    )
  }
  return parsed
}

const parseStoredGrantInstallation = (
  input: SliceWalletProviderValue | undefined,
  chainId: number
): StoredGenericGrantInstallation | null => {
  const value = input === undefined ? null : record(input)
  const callDataHash = parseCanonicalData(value?.callDataHash)
  const entryPoint = parseCanonicalAddress(value?.entryPoint)
  const nonce = parseCanonicalQuantity(value?.nonce)
  const sender = parseCanonicalAddress(value?.sender)
  const userOperation = parseStoredGrantInstallationUserOperation(
    value?.userOperation
  )
  const userOperationHash = parseCanonicalData(value?.userOperationHash)
  if (
    value === null ||
    !hasOnlyKeys(value, [
      "callDataHash",
      "entryPoint",
      "nonce",
      "sender",
      "userOperation",
      "userOperationHash"
    ]) ||
    callDataHash === null ||
    hexToBytes(callDataHash).length !== 32 ||
    entryPoint === null ||
    entryPoint !== entryPoint07Address.toLowerCase() ||
    nonce === null ||
    sender === null ||
    userOperation === null ||
    userOperationHash === null ||
    hexToBytes(userOperationHash).length !== 32 ||
    userOperation.sender !== sender ||
    userOperation.nonce !== nonce ||
    keccak256(userOperation.callData) !== callDataHash
  ) {
    return null
  }
  try {
    const recomputedHash = getUserOperationHash({
      chainId,
      entryPointAddress: entryPoint,
      entryPointVersion: "0.7",
      userOperation:
        deserializeStoredGenericGrantInstallationUserOperation(userOperation)
    })
    if (recomputedHash.toLowerCase() !== userOperationHash) {
      return null
    }
  } catch {
    return null
  }
  return {
    callDataHash,
    entryPoint,
    nonce,
    sender,
    userOperation,
    userOperationHash
  }
}

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
  const currentJournal =
    value !== null &&
    value.version === 1 &&
    hasOnlyKeys(value, [
      "installation",
      "phase",
      "predecessor",
      "rebroadcastAttempts",
      "replacement",
      "version"
    ])
  if (
    value === null ||
    !currentJournal ||
    typeof value.phase !== "string" ||
    !grantRotationPhases.has(value.phase as StoredGenericGrantRotationPhase) ||
    typeof value.rebroadcastAttempts !== "number" ||
    !Number.isSafeInteger(value.rebroadcastAttempts) ||
    value.rebroadcastAttempts < 0 ||
    typeof value.predecessor !== "object" ||
    value.predecessor === null ||
    Array.isArray(value.predecessor) ||
    typeof value.replacement !== "object" ||
    value.replacement === null ||
    Array.isArray(value.replacement) ||
    (value.installation !== undefined &&
      (typeof value.installation !== "object" ||
        value.installation === null ||
        Array.isArray(value.installation)))
  ) {
    return invalid()
  }
  const predecessor = parseStoredSliceWalletGrant(value.predecessor, now)
  const replacement = parseStoredSliceWalletGrant(value.replacement, now)
  const installation =
    value.installation === undefined
      ? null
      : parseStoredGrantInstallation(value.installation, chainId)
  if (
    predecessor === null ||
    replacement === null ||
    predecessor.account.toLowerCase() !== account.toLowerCase() ||
    replacement.account.toLowerCase() !== account.toLowerCase() ||
    predecessor.chainId !== chainId ||
    replacement.chainId !== chainId ||
    predecessor.permissionId.toLowerCase() ===
      replacement.permissionId.toLowerCase() ||
    (value.installation !== undefined && installation === null) ||
    (installation !== null &&
      installation.sender.toLowerCase() !==
        replacement.account.toLowerCase()) ||
    ((value.phase === "transport-pending" || value.phase === "submitted") &&
      installation === null) ||
    (value.phase === "prepared" && installation !== null)
  ) {
    return invalid()
  }
  const base = {
    predecessor,
    rebroadcastAttempts: value.rebroadcastAttempts,
    replacement,
    version: 1 as const
  }
  if (value.phase === "prepared") return { ...base, phase: value.phase }
  if (value.phase === "transport-pending" || value.phase === "submitted") {
    if (installation === null) return invalid()
    return { ...base, installation, phase: value.phase }
  }
  return {
    ...base,
    ...(installation === null ? {} : { installation }),
    phase: value.phase as Exclude<
      StoredGenericGrantRotationPhase,
      "prepared" | "submitted" | "transport-pending"
    >
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
