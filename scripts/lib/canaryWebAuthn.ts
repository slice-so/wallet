import { Base64, Hex as OxHex, P256, PublicKey, WebAuthnP256 } from "ox"
import type { Signature } from "ox/Signature"
import type { BufferSource } from "ox/webauthn/Types"
import type { CreateSliceWalletKernelAccountParameters } from "../../src/types/account"

const canaryPrivateKey =
  "0x0101010101010101010101010101010101010101010101010101010101010101" as const
const canaryCredentialId =
  "0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5" as const
const rpId = "id.slice.so"
const origin = "https://id.slice.so"

const toUint8Array = (source: BufferSource) => {
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.byteLength)
    bytes.set(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    )
    return bytes
  }
  return new Uint8Array(source)
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const encodeDerInteger = (value: bigint) => {
  const normalizedHex =
    value === 0n
      ? "00"
      : value.toString(16).length % 2 === 0
        ? value.toString(16)
        : `0${value.toString(16)}`
  const valueBytes = OxHex.toBytes(`0x${normalizedHex}`)
  const integerBytes =
    valueBytes[0] !== undefined && valueBytes[0] >= 0x80
      ? new Uint8Array([0, ...valueBytes])
      : valueBytes
  return new Uint8Array([0x02, integerBytes.length, ...integerBytes])
}

const encodeDerSignature = ({ r, s }: Pick<Signature, "r" | "s">) => {
  const rBytes = encodeDerInteger(r)
  const sBytes = encodeDerInteger(s)
  return Uint8Array.from([
    0x30,
    rBytes.length + sBytes.length,
    ...rBytes,
    ...sBytes
  ])
}

const publicKey = PublicKey.toHex(
  P256.getPublicKey({ privateKey: canaryPrivateKey }),
  { includePrefix: false }
)
const credentialId = Base64.fromBytes(OxHex.toBytes(canaryCredentialId), {
  pad: false,
  url: true
})

export const canaryCredential = { id: credentialId, publicKey }
export const canaryRpId = rpId

export const canaryGetFn: NonNullable<
  CreateSliceWalletKernelAccountParameters["getFn"]
> = async (options) => {
  const request = options?.publicKey
  if (request?.challenge === undefined) {
    throw new Error("The WebAuthn request is missing a challenge.")
  }

  const challenge = OxHex.fromBytes(toUint8Array(request.challenge))
  const { metadata, payload } = WebAuthnP256.getSignPayload({
    challenge,
    origin,
    rpId: request.rpId ?? rpId,
    userVerification: request.userVerification ?? "required"
  })
  const signature = P256.sign({
    hash: true,
    payload,
    privateKey: canaryPrivateKey
  })

  return {
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    id: credentialId,
    rawId: toArrayBuffer(Base64.toBytes(credentialId)),
    response: {
      authenticatorData: toArrayBuffer(
        OxHex.toBytes(metadata.authenticatorData)
      ),
      clientDataJSON: toArrayBuffer(
        new TextEncoder().encode(metadata.clientDataJSON)
      ),
      signature: toArrayBuffer(encodeDerSignature(signature)),
      userHandle: null
    },
    type: "public-key"
  }
}
