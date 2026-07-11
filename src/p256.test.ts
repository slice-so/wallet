import { describe, expect, it } from "bun:test"
import {
  concat,
  decodeAbiParameters,
  hexToBytes,
  sha256,
  stringToHex,
  toHex
} from "viem"
import {
  encodeSliceWalletSyntheticWebAuthnSignature,
  generateSliceWalletP256KeyPair,
  getSliceWalletP256SignerId,
  signSliceWalletP256
} from "./p256"

describe("P-256 session keys", () => {
  it("keeps the private key non-extractable and derives a stable signer id", async () => {
    const keyPair = await generateSliceWalletP256KeyPair()

    expect(keyPair.privateKey.extractable).toBe(false)
    expect(keyPair.publicKey.extractable).toBe(true)
    expect(keyPair.publicKeyHex.startsWith("0x04")).toBe(true)
    expect(keyPair.publicKeyHex.length).toBe(132)
    expect(getSliceWalletP256SignerId(keyPair.publicKeyHex)).toBe(
      keyPair.signerId
    )
  })

  it("produces a low-s signature WebCrypto verifies", async () => {
    const keyPair = await generateSliceWalletP256KeyPair()
    const message = new TextEncoder().encode("slice-wallet-session-proof")
    const signature = await signSliceWalletP256({
      key: keyPair.privateKey,
      message
    })
    const signatureBytes = hexToBytes(signature)
    const signatureBuffer = new Uint8Array(
      new ArrayBuffer(signatureBytes.byteLength)
    )
    signatureBuffer.set(signatureBytes)
    const s = BigInt(toHex(signatureBytes.slice(32)))

    expect(signature.length).toBe(130)
    expect(s).toBeLessThanOrEqual(
      0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n
    )
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.publicKey,
        signatureBuffer,
        message
      )
    ).toBe(true)
  })

  it("builds a synthetic WebAuthn envelope over the supplied challenge", async () => {
    const keyPair = await generateSliceWalletP256KeyPair()
    const challenge = sha256(stringToHex("user-operation"))
    const encoded = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId: 8453,
      challenge,
      key: keyPair.privateKey,
      origin: "https://id.slice.so",
      rpId: "id.slice.so"
    })
    const [
      authenticatorData,
      clientDataJSON,
      responseTypeLocation,
      r,
      s,
      usePrecompiled
    ] = decodeAbiParameters(
      [
        { name: "authenticatorData", type: "bytes" },
        { name: "clientDataJSON", type: "string" },
        { name: "responseTypeLocation", type: "uint256" },
        { name: "r", type: "uint256" },
        { name: "s", type: "uint256" },
        { name: "usePrecompiled", type: "bool" }
      ],
      encoded
    )
    const signedPayload = concat([
      authenticatorData,
      sha256(stringToHex(clientDataJSON))
    ])
    const signature = new Uint8Array(new ArrayBuffer(64))
    signature.set(hexToBytes(toHex(r, { size: 32 })), 0)
    signature.set(hexToBytes(toHex(s, { size: 32 })), 32)
    const payloadBytes = hexToBytes(signedPayload)
    const payload = new Uint8Array(new ArrayBuffer(payloadBytes.byteLength))
    payload.set(payloadBytes)

    expect(JSON.parse(clientDataJSON)).toMatchObject({
      crossOrigin: false,
      origin: "https://id.slice.so",
      type: "webauthn.get"
    })
    expect(responseTypeLocation).toBe(
      BigInt(clientDataJSON.lastIndexOf('"type":"webauthn.get"'))
    )
    expect(responseTypeLocation).toBe(1n)
    expect(clientDataJSON.indexOf('"challenge":"')).toBe(23)
    expect(usePrecompiled).toBe(true)
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.publicKey,
        signature,
        payload
      )
    ).toBe(true)
  })
})
