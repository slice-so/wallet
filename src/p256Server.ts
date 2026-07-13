import {
  type Address,
  bytesToBigInt,
  bytesToHex,
  concat,
  decodeAbiParameters,
  type Hex,
  hashTypedData,
  hexToBytes,
  keccak256,
  pad,
  slice,
  toHex
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"

const p256Order =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const p256HalfOrder = p256Order / 2n

const webAuthnAssertionParameters = [
  { name: "authenticatorData", type: "bytes" },
  { name: "clientDataJSON", type: "string" },
  { name: "responseTypeLocation", type: "uint256" },
  { name: "r", type: "uint256" },
  { name: "s", type: "uint256" },
  { name: "usePrecompiled", type: "bool" }
] as const

export const decodeSliceWalletWebAuthnAssertion = (signature: Hex) => {
  const [
    authenticatorData,
    clientDataJSON,
    responseTypeLocation,
    r,
    s,
    usePrecompiled
  ] = decodeAbiParameters(webAuthnAssertionParameters, signature)
  return {
    authenticatorData,
    clientDataJSON,
    r,
    responseTypeLocation,
    s,
    usePrecompiled
  }
}

const normalizeP256Scalars = (r: bigint, rawS: bigint) => {
  if (r === 0n || r >= p256Order || rawS === 0n || rawS >= p256Order) {
    throw new Error("Invalid P-256 signature scalar.")
  }
  return {
    r,
    s: rawS > p256HalfOrder ? p256Order - rawS : rawS
  }
}

export const getSliceWalletP256SignerId = (publicKey: Hex): Address => {
  const bytes = hexToBytes(publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Expected an uncompressed P-256 public key.")
  }
  return slice(keccak256(bytesToHex(bytes.slice(1))), 12) as Address
}

export const normalizeSliceWalletP256Signature = (
  signature: ArrayBuffer
): Hex => {
  const bytes = new Uint8Array(signature)
  if (bytes.length !== 64) {
    throw new Error("Expected a 64-byte P-256 signature.")
  }

  const { r, s } = normalizeP256Scalars(
    bytesToBigInt(bytes.slice(0, 32)),
    bytesToBigInt(bytes.slice(32))
  )
  return concat([toHex(r, { size: 32 }), toHex(s, { size: 32 })])
}

export const verifySliceWalletP256 = async ({
  cryptoImpl = crypto,
  message,
  publicKey,
  signature
}: {
  cryptoImpl?: Crypto
  message: Uint8Array
  publicKey: Hex
  signature: Hex
}) => {
  const signatureBytes = hexToBytes(signature)
  if (signatureBytes.length !== 64) return false
  const s = bytesToBigInt(signatureBytes.slice(32))
  if (s === 0n || s > p256HalfOrder) return false

  const rawPublicKey = hexToBytes(publicKey)
  if (rawPublicKey.length !== 65 || rawPublicKey[0] !== 4) return false
  const publicKeyBuffer = new Uint8Array(new ArrayBuffer(rawPublicKey.length))
  publicKeyBuffer.set(rawPublicKey)
  const signatureBuffer = new Uint8Array(new ArrayBuffer(signatureBytes.length))
  signatureBuffer.set(signatureBytes)
  const messageBuffer = new Uint8Array(new ArrayBuffer(message.length))
  messageBuffer.set(message)
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    publicKeyBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  )
  return cryptoImpl.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signatureBuffer,
    messageBuffer
  )
}

const weightedP256ProposalTypes = {
  Proposal: [
    { name: "account", type: "address" },
    { name: "id", type: "bytes32" },
    { name: "callData", type: "bytes" },
    { name: "nonce", type: "uint256" }
  ]
} as const

export const hashSliceWalletWeightedP256Proposal = ({
  account,
  callData,
  chainId,
  nonce,
  permissionId
}: {
  account: Address
  callData: Hex
  chainId: number
  nonce: bigint
  permissionId: Hex
}) =>
  hashTypedData({
    domain: {
      chainId,
      name: "WeightedP256Signer",
      verifyingContract: sliceWalletKernelAddresses.weightedP256Signer,
      version: "0.0.1"
    },
    message: {
      account,
      callData,
      id: pad(permissionId, { dir: "right", size: 32 }),
      nonce
    },
    primaryType: "Proposal",
    types: weightedP256ProposalTypes
  })

export const normalizeSliceWalletP256Scalars = normalizeP256Scalars
