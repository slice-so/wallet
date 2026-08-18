import {
  getSliceWalletChainPolicy,
  getSliceWalletP256SignerId,
  normalizeSliceWalletP256Scalars,
  normalizeSliceWalletP256Signature
} from "@slicekit/wallet-primitives"
import {
  bytesToBigInt,
  bytesToHex,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  sha256,
  stringToBytes
} from "viem"
import type { SliceWalletP256KeyPair } from "./types"

export {
  getSliceWalletP256SignerId,
  hashSliceWalletWeightedP256CoSign,
  hashSliceWalletWeightedP256Proposal,
  normalizeSliceWalletP256Signature,
  verifySliceWalletP256
} from "@slicekit/wallet-primitives/server"

export const generateSliceWalletP256KeyPair = async (
  cryptoImpl: Crypto = crypto
): Promise<SliceWalletP256KeyPair> => {
  const keyPair = await cryptoImpl.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  )
  const publicKeyHex = bytesToHex(
    new Uint8Array(await cryptoImpl.subtle.exportKey("raw", keyPair.publicKey))
  )

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyHex,
    signerId: getSliceWalletP256SignerId(publicKeyHex)
  }
}

export const isSliceWalletRip7212Available = (chainId: number) => {
  try {
    return getSliceWalletChainPolicy(chainId).rip7212Available
  } catch {
    return false
  }
}

export const signSliceWalletP256 = async ({
  cryptoImpl = crypto,
  key,
  message
}: {
  cryptoImpl?: Crypto
  key: CryptoKey
  message: Uint8Array
}): Promise<Hex> => {
  const input = new Uint8Array(new ArrayBuffer(message.byteLength))
  input.set(message)
  return normalizeSliceWalletP256Signature(
    await cryptoImpl.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, input)
  )
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
}

export const encodeSliceWalletWebAuthnAssertion = ({
  authenticatorData,
  clientDataJSON,
  r,
  responseTypeLocation,
  s,
  usePrecompiled
}: {
  authenticatorData: Hex
  clientDataJSON: string
  r: bigint
  responseTypeLocation: bigint
  s: bigint
  usePrecompiled: boolean
}): Hex => {
  const normalized = normalizeSliceWalletP256Scalars(r, s)
  return encodeAbiParameters(
    [
      { name: "authenticatorData", type: "bytes" },
      { name: "clientDataJSON", type: "string" },
      { name: "responseTypeLocation", type: "uint256" },
      { name: "r", type: "uint256" },
      { name: "s", type: "uint256" },
      { name: "usePrecompiled", type: "bool" }
    ],
    [
      authenticatorData,
      clientDataJSON,
      responseTypeLocation,
      normalized.r,
      normalized.s,
      usePrecompiled
    ]
  )
}

export const encodeSliceWalletSyntheticWebAuthnSignature = async ({
  chainId,
  challenge,
  cryptoImpl = crypto,
  key,
  origin,
  rpId,
  usePrecompiled = isSliceWalletRip7212Available(chainId)
}: {
  chainId: number
  challenge: Hex
  cryptoImpl?: Crypto
  key: CryptoKey
  origin: string
  rpId: string
  usePrecompiled?: boolean
}): Promise<Hex> => {
  const rpIdHash = sha256(bytesToHex(stringToBytes(rpId)))
  const authenticatorData = concat([rpIdHash, "0x05", "0x00000000"])
  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge: toBase64Url(hexToBytes(challenge)),
    origin,
    crossOrigin: false
  })
  const clientDataHash = sha256(bytesToHex(stringToBytes(clientDataJSON)))
  const signature = await signSliceWalletP256({
    cryptoImpl,
    key,
    message: hexToBytes(concat([authenticatorData, clientDataHash]))
  })
  const signatureBytes = hexToBytes(signature)

  return encodeSliceWalletWebAuthnAssertion({
    authenticatorData,
    clientDataJSON,
    r: bytesToBigInt(signatureBytes.slice(0, 32)),
    responseTypeLocation: BigInt(
      clientDataJSON.lastIndexOf('"type":"webauthn.get"')
    ),
    s: bytesToBigInt(signatureBytes.slice(32)),
    usePrecompiled
  })
}
