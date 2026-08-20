import { type Address, type Hex, hexToBytes, isAddress, isHex } from "viem"
import type { SliceWalletProtocolValue } from "../protocol/index"
import { resolveSliceWalletDeploymentProfileId } from "../protocol/kernel"
import type {
  SliceWalletRecoveryHandoffAuthorizationRequest,
  SliceWalletRecoveryHandoffAuthorizationResponse,
  SliceWalletRecoveryHandoffCredentialResponse,
  SliceWalletRecoveryHandoffErrorResponse,
  SliceWalletRegistryCredential
} from "../types"

type ProtocolRecord = {
  readonly [key: string]: SliceWalletProtocolValue
}

const record = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as ProtocolRecord
}

const assertKeys = (value: ProtocolRecord, required: readonly string[]) => {
  if (
    Object.keys(value).length !== required.length ||
    required.some((key) => !(key in value))
  ) {
    throw new Error("Recovery handoff contains invalid fields.")
  }
}

const stringValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

const integerValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`)
  }
  return value
}

const hexValue = (
  value: SliceWalletProtocolValue,
  label: string,
  bytes?: number
) => {
  const parsed = stringValue(value, label)
  if (
    !isHex(parsed, { strict: true }) ||
    (bytes !== undefined && hexToBytes(parsed).length !== bytes)
  ) {
    throw new Error(`${label} is invalid.`)
  }
  return parsed as Hex
}

const addressValue = (value: SliceWalletProtocolValue, label: string) => {
  const parsed = stringValue(value, label)
  if (!isAddress(parsed)) throw new Error(`${label} is invalid.`)
  return parsed as Address
}

const parseRegistryCredential = (
  value: SliceWalletProtocolValue
): SliceWalletRegistryCredential => {
  const input = record(value, "Recovery registry credential")
  assertKeys(input, [
    "accountAddress",
    "accountIndex",
    "createdAt",
    "credentialIdHash",
    "factoryVersion",
    "publicKey",
    "recoveryPermissionId",
    "recoverySignerAddress",
    "registrationKind"
  ])
  if (input.registrationKind !== "existing_account") {
    throw new Error("Recovery credential must register an existing account.")
  }
  const createdAt = stringValue(input.createdAt, "Credential creation time")
  if (Number.isNaN(new Date(createdAt).getTime())) {
    throw new Error("Credential creation time is invalid.")
  }
  return {
    accountAddress: addressValue(input.accountAddress, "Credential account"),
    accountIndex: integerValue(input.accountIndex, "Credential account index"),
    createdAt,
    credentialIdHash: hexValue(
      input.credentialIdHash,
      "Credential id hash",
      32
    ),
    factoryVersion: resolveSliceWalletDeploymentProfileId(
      stringValue(input.factoryVersion, "Credential factory version")
    ),
    publicKey: hexValue(input.publicKey, "Credential public key", 65),
    recoveryPermissionId:
      input.recoveryPermissionId === null
        ? null
        : hexValue(input.recoveryPermissionId, "Recovery permission id", 4),
    recoverySignerAddress:
      input.recoverySignerAddress === null
        ? null
        : addressValue(input.recoverySignerAddress, "Recovery signer"),
    registrationKind: "existing_account"
  }
}

export const parseSliceWalletRecoveryHandoffAuthorizationRequest = (
  value: SliceWalletProtocolValue
): SliceWalletRecoveryHandoffAuthorizationRequest => {
  const input = record(value, "Recovery authorization request")
  assertKeys(input, [
    "account",
    "accountIndex",
    "challenge",
    "chainId",
    "credentialIdHash",
    "factoryVersion",
    "message",
    "nonce",
    "publicKey",
    "type",
    "version"
  ])
  if (
    input.type !== "slice-wallet:recovery-root-authorization" ||
    input.version !== 1
  ) {
    throw new Error("Recovery authorization request is invalid.")
  }
  const chainId = integerValue(input.chainId, "Recovery chain id")
  if (chainId === 0) throw new Error("Recovery chain id must be positive.")
  return {
    account: addressValue(input.account, "Recovery account"),
    accountIndex: integerValue(input.accountIndex, "Recovery account index"),
    challenge: hexValue(input.challenge, "Registry challenge", 32),
    chainId,
    credentialIdHash: hexValue(
      input.credentialIdHash,
      "Credential id hash",
      32
    ),
    factoryVersion: resolveSliceWalletDeploymentProfileId(
      stringValue(input.factoryVersion, "Factory version")
    ),
    message: stringValue(input.message, "Root authorization message"),
    nonce: hexValue(input.nonce, "Recovery handoff nonce", 32),
    publicKey: hexValue(input.publicKey, "Credential public key", 65),
    type: "slice-wallet:recovery-root-authorization",
    version: 1
  }
}

export const parseSliceWalletRecoveryHandoffAuthorizationResponse = (
  value: SliceWalletProtocolValue
): SliceWalletRecoveryHandoffAuthorizationResponse => {
  const input = record(value, "Recovery authorization response")
  assertKeys(input, [
    "nonce",
    "recoveryPermissionId",
    "recoverySignerAddress",
    "rootSignature",
    "type",
    "version"
  ])
  if (
    input.type !== "slice-wallet:recovery-root-signature" ||
    input.version !== 1
  ) {
    throw new Error("Recovery authorization response is invalid.")
  }
  return {
    nonce: hexValue(input.nonce, "Recovery handoff nonce", 32),
    recoveryPermissionId: hexValue(
      input.recoveryPermissionId,
      "Recovery permission id",
      4
    ),
    recoverySignerAddress: addressValue(
      input.recoverySignerAddress,
      "Recovery signer"
    ),
    rootSignature: hexValue(input.rootSignature, "Root signature"),
    type: "slice-wallet:recovery-root-signature",
    version: 1
  }
}

export const parseSliceWalletRecoveryHandoffResult = (
  value: SliceWalletProtocolValue
):
  | SliceWalletRecoveryHandoffCredentialResponse
  | SliceWalletRecoveryHandoffErrorResponse => {
  const input = record(value, "Recovery handoff result")
  if (input.type === "slice-wallet:recovery-error") {
    assertKeys(input, ["message", "nonce", "type", "version"])
    if (input.version !== 1)
      throw new Error("Recovery handoff error is invalid.")
    return {
      message: stringValue(input.message, "Recovery error"),
      nonce: hexValue(input.nonce, "Recovery handoff nonce", 32),
      type: "slice-wallet:recovery-error",
      version: 1
    }
  }
  assertKeys(input, ["credentialId", "nonce", "registry", "type", "version"])
  if (
    input.type !== "slice-wallet:recovery-credential" ||
    input.version !== 1
  ) {
    throw new Error("Recovery handoff result is invalid.")
  }
  return {
    credentialId: stringValue(input.credentialId, "Credential id"),
    nonce: hexValue(input.nonce, "Recovery handoff nonce", 32),
    registry: parseRegistryCredential(input.registry),
    type: "slice-wallet:recovery-credential",
    version: 1
  }
}
