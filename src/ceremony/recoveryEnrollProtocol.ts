import { type Address, type Hex, hexToBytes, isAddress, isHex } from "viem"
import type {
  SliceWalletProtocolValue,
  SliceWalletRecoveryEnrollError,
  SliceWalletRecoveryEnrollRequest,
  SliceWalletRecoveryEnrollResult
} from "../types"

type ProtocolRecord = { readonly [key: string]: SliceWalletProtocolValue }

const record = (value: SliceWalletProtocolValue): ProtocolRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Recovery enrollment message must be an object.")
  }
  return value as ProtocolRecord
}

const exactKeys = (value: ProtocolRecord, keys: readonly string[]) => {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  ) {
    throw new Error("Recovery enrollment message contains invalid fields.")
  }
}

const stringValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
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

const nonce = (value: SliceWalletProtocolValue) =>
  hexValue(value, "Recovery enrollment nonce", 32)

export const parseSliceWalletRecoveryEnrollRequest = (
  value: SliceWalletProtocolValue
): SliceWalletRecoveryEnrollRequest => {
  const input = record(value)
  exactKeys(input, [
    "chainId",
    "credentialId",
    "credentialPublicKey",
    "nonce",
    "type",
    "version"
  ])
  if (
    input.type !== "slice-wallet:recovery-enroll-request" ||
    input.version !== 1 ||
    typeof input.chainId !== "number" ||
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0
  ) {
    throw new Error("Recovery enrollment request is invalid.")
  }
  return {
    chainId: input.chainId,
    credentialId: stringValue(input.credentialId, "Credential id"),
    credentialPublicKey: hexValue(
      input.credentialPublicKey,
      "Credential public key",
      65
    ),
    nonce: nonce(input.nonce),
    type: "slice-wallet:recovery-enroll-request",
    version: 1
  }
}

export const parseSliceWalletRecoveryEnrollResponse = (
  value: SliceWalletProtocolValue
): SliceWalletRecoveryEnrollResult | SliceWalletRecoveryEnrollError => {
  const input = record(value)
  if (input.type === "slice-wallet:recovery-enroll-error") {
    exactKeys(input, ["message", "nonce", "type", "version"])
    if (input.version !== 1)
      throw new Error("Recovery enrollment error is invalid.")
    return {
      message: stringValue(input.message, "Recovery enrollment error"),
      nonce: nonce(input.nonce),
      type: "slice-wallet:recovery-enroll-error",
      version: 1
    }
  }
  exactKeys(input, [
    "account",
    "nonce",
    "permissionId",
    "signerAddress",
    "type",
    "version"
  ])
  if (
    input.type !== "slice-wallet:recovery-enroll-result" ||
    input.version !== 1
  ) {
    throw new Error("Recovery enrollment result is invalid.")
  }
  return {
    account: addressValue(input.account, "Recovery account"),
    nonce: nonce(input.nonce),
    permissionId: hexValue(input.permissionId, "Recovery permission id", 4),
    signerAddress: addressValue(input.signerAddress, "Recovery signer"),
    type: "slice-wallet:recovery-enroll-result",
    version: 1
  }
}
