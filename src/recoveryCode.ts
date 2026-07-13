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

const recoveryCodePrefix = "SLW1"
const recoveryCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const recoveryCodeBodyBytes = 56
const recoveryCodeChecksumBytes = 4
const recoveryCodeEncodedCharacters = 96
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

const checksum = (body: Uint8Array) =>
  hexToBytes(
    sha256(concatBytes([stringToBytes(recoveryCodePrefix), body]))
  ).slice(0, recoveryCodeChecksumBytes)

const formatEncodedBody = (encoded: string) =>
  `${recoveryCodePrefix}-${encoded.match(/.{6}/g)?.join("-") ?? ""}`

const parseEncodedBody = (code: string) => {
  const normalized = code.trim().toUpperCase()
  if (!normalized.startsWith("SLW")) {
    throw new Error("Recovery code prefix is invalid.")
  }
  const suffix = normalized.slice(3)
  const delimitedVersion = /^([0-9]+)-/.exec(suffix)
  const compactSuffix = suffix.replace(/[-\s]/g, "")
  if (!/^[0-9]/.test(compactSuffix)) {
    throw new Error("Recovery code prefix is invalid.")
  }
  const versionLength = compactSuffix.length - recoveryCodeEncodedCharacters
  if (delimitedVersion === null && versionLength <= 0) {
    throw new Error("Recovery code has an invalid length.")
  }
  const version = delimitedVersion?.[1] ?? compactSuffix.slice(0, versionLength)
  if (version !== "1") {
    throw new Error("This recovery code requires a newer recovery tool.")
  }
  const body =
    delimitedVersion === null
      ? compactSuffix.slice(versionLength)
      : suffix.slice(delimitedVersion[0].length)
  const encoded = body
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

export const encodeSliceWalletRecoveryCode = ({
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
  const body = new Uint8Array(recoveryCodeBodyBytes)
  new DataView(body.buffer).setUint32(0, chainId, false)
  body.set(hexToBytes(account), 4)
  body.set(privateKey, 24)
  return formatEncodedBody(encodeBase32(concatBytes([body, checksum(body)])))
}

export const parseSliceWalletRecoveryCode = (
  code: string
): SliceWalletRecoveryCodePayload => {
  const decoded = decodeBase32(parseEncodedBody(code))
  if (decoded.length !== recoveryCodeBodyBytes + recoveryCodeChecksumBytes) {
    throw new Error("Recovery code has an invalid length.")
  }
  const body = decoded.slice(0, recoveryCodeBodyBytes)
  const expectedChecksum = checksum(body)
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
  return { account, chainId, recoveryPrivateKey }
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
