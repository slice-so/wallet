import {
  type Address,
  bytesToHex,
  concatBytes,
  getAddress,
  hexToBytes,
  isAddress,
  sha256,
  stringToBytes
} from "viem"
import type { SliceWalletRecoveryCodePayload } from "./types"

const recoveryCodePrefix = "SLW"
const recoveryCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const recoveryCodeBodyBytes = 156
const recoveryCodeChecksumBytes = 4
const recoveryCodeEncodedCharacters = 256
const secp256k1Order =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

const encodeBase32 = (bytes: Uint8Array) => {
  let bits = 0
  let buffer = 0
  let encoded = ""
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      encoded += recoveryCodeAlphabet[(buffer >> bits) & 31]
      buffer &= (1 << bits) - 1
    }
  }
  if (bits !== 0) {
    encoded += recoveryCodeAlphabet[(buffer << (5 - bits)) & 31]
  }
  return encoded
}

const decodeBase32 = (encoded: string) => {
  const bytes = new Uint8Array((encoded.length * 5) / 8)
  let bits = 0
  let buffer = 0
  let offset = 0
  for (const character of encoded) {
    const value = recoveryCodeAlphabet.indexOf(character)
    if (value < 0)
      throw new Error("Recovery code contains an invalid character.")
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[offset] = (buffer >> bits) & 0xff
      offset += 1
      buffer &= (1 << bits) - 1
    }
  }
  if (bits !== 0 || offset !== bytes.length) {
    throw new Error("Recovery code has an invalid length.")
  }
  return bytes
}

const checksum = (prefix: string, body: Uint8Array) =>
  hexToBytes(sha256(concatBytes([stringToBytes(prefix), body]))).slice(
    0,
    recoveryCodeChecksumBytes
  )

const formatEncodedBody = (prefix: string, encoded: string) =>
  `${prefix}-${encoded.match(/.{1,6}/g)?.join("-") ?? ""}`

const parseEncodedBody = (code: string) => {
  const normalized = code.trim().toUpperCase()
  if (!normalized.startsWith(recoveryCodePrefix)) {
    throw new Error("Recovery code prefix is invalid.")
  }
  const suffix = normalized.slice(recoveryCodePrefix.length)
  const encoded = (suffix.startsWith("-") ? suffix.slice(1) : suffix)
    .replace(/[-\s]/g, "")
    .replaceAll("O", "0")
    .replace(/[IL]/g, "1")
  if (encoded.length !== recoveryCodeEncodedCharacters) {
    throw new Error("Recovery code has an invalid length.")
  }
  if (
    [...encoded].some((character) => !recoveryCodeAlphabet.includes(character))
  ) {
    throw new Error("Recovery code contains an invalid character.")
  }
  return encoded
}

const validateRecoveryCodeBase = ({
  account,
  chainId,
  recoveryPrivateKey
}: SliceWalletRecoveryCodePayload) => {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId > 0xffffffff) {
    throw new Error("Recovery chain id must be a non-zero uint32.")
  }
  if (!isAddress(account)) throw new Error("Recovery account is invalid.")
  const privateKey = hexToBytes(recoveryPrivateKey)
  if (privateKey.length !== 32)
    throw new Error("Recovery private key is invalid.")
  const scalar = BigInt(recoveryPrivateKey)
  if (scalar <= 0n || scalar >= secp256k1Order) {
    throw new Error("Recovery private key is invalid.")
  }
  return privateKey
}

export const encodeSliceWalletRecoveryCode = (
  payload: SliceWalletRecoveryCodePayload
) => {
  const privateKey = validateRecoveryCodeBase(payload)
  if (
    !Number.isInteger(payload.accountIndex) ||
    payload.accountIndex < 0 ||
    payload.accountIndex > 31
  ) {
    throw new Error("Recovery account index must be between 0 and 31.")
  }
  const credentialIdHash = hexToBytes(payload.credentialIdHash)
  if (credentialIdHash.length !== 32) {
    throw new Error("Recovery credential id hash is invalid.")
  }
  const credentialPublicKey = hexToBytes(payload.credentialPublicKey)
  if (credentialPublicKey.length !== 65 || credentialPublicKey[0] !== 4) {
    throw new Error("Recovery credential public key is invalid.")
  }
  const body = new Uint8Array(recoveryCodeBodyBytes)
  new DataView(body.buffer).setUint32(0, payload.chainId, false)
  body.set(hexToBytes(payload.account), 4)
  body.set(privateKey, 24)
  body[56] = payload.accountIndex
  body.set(credentialIdHash, 57)
  body.set(credentialPublicKey, 89)
  return formatEncodedBody(
    recoveryCodePrefix,
    encodeBase32(concatBytes([body, checksum(recoveryCodePrefix, body)]))
  )
}

export const parseSliceWalletRecoveryCode = (
  code: string
): SliceWalletRecoveryCodePayload => {
  const decoded = decodeBase32(parseEncodedBody(code))
  if (decoded.length !== recoveryCodeBodyBytes + recoveryCodeChecksumBytes) {
    throw new Error("Recovery code has an invalid length.")
  }
  const body = decoded.slice(0, recoveryCodeBodyBytes)
  const expectedChecksum = checksum(recoveryCodePrefix, body)
  const actualChecksum = decoded.slice(recoveryCodeBodyBytes)
  if (
    !expectedChecksum.every((byte, index) => byte === actualChecksum[index])
  ) {
    throw new Error("Recovery code checksum does not match. Check for a typo.")
  }
  const chainId = new DataView(body.buffer, body.byteOffset, 4).getUint32(
    0,
    false
  )
  if (chainId === 0) throw new Error("Recovery chain id must be non-zero.")
  const account = getAddress(bytesToHex(body.slice(4, 24)))
  const recoveryPrivateKey = bytesToHex(body.slice(24, 56))
  const scalar = BigInt(recoveryPrivateKey)
  if (scalar <= 0n || scalar >= secp256k1Order) {
    throw new Error("Recovery private key is invalid.")
  }
  const accountIndex = body[56]
  if (accountIndex === undefined || accountIndex > 31) {
    throw new Error("Recovery account index must be between 0 and 31.")
  }
  if (body[154] !== 0 || body[155] !== 0) {
    throw new Error("Recovery code reserved bytes are invalid.")
  }
  const credentialIdHash = bytesToHex(body.slice(57, 89))
  const credentialPublicKey = bytesToHex(body.slice(89, 154))
  if (hexToBytes(credentialPublicKey)[0] !== 4) {
    throw new Error("Recovery credential public key is invalid.")
  }
  return {
    account,
    accountIndex,
    chainId,
    credentialIdHash,
    credentialPublicKey,
    recoveryPrivateKey
  } satisfies SliceWalletRecoveryCodePayload
}

export const isSliceWalletRecoveryCodeShaped = (code: string) => {
  try {
    parseEncodedBody(code)
    return true
  } catch {
    return false
  }
}

export const sliceWalletRecoveryCodeUsername = (account: Address) =>
  `slice-recovery-${account.toLowerCase()}`
