import * as Base64 from "ox/Base64"
import * as PublicKey from "ox/PublicKey"
import { encodeAbiParameters, type Hex, keccak256, toHex } from "viem"
import type { WebAuthnAccount } from "viem/account-abstraction"
import type { SliceWalletPasskeyCredential } from "../../types/account"

/**
 * Enable data for the onchain WebAuthn root validator: public-key coordinates
 * plus the keccak256 hash of the base64url credential id.
 */
export const encodeWebAuthnRootValidatorData = (
  credential: SliceWalletPasskeyCredential
) => {
  const publicKey = PublicKey.fromHex(credential.publicKey)
  const authenticatorIdHash = keccak256(toHex(Base64.toBytes(credential.id)))

  return encodeAbiParameters(
    [
      {
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" }
        ],
        name: "webAuthnData",
        type: "tuple"
      },
      { name: "authenticatorIdHash", type: "bytes32" }
    ],
    [{ x: publicKey.x, y: publicKey.y }, authenticatorIdHash]
  )
}

const parseWebAuthnSignature = (signature: Hex) => {
  const bytes = signature.slice(2)
  if (bytes.length < 128) {
    throw new Error("Invalid WebAuthn signature length.")
  }

  return {
    r: BigInt(`0x${bytes.slice(0, 64)}`),
    s: BigInt(`0x${bytes.slice(64, 128)}`)
  }
}

/** Encodes a WebAuthn assertion for Kernel's onchain validator. */
export const encodeWebAuthnValidatorSignature = ({
  signature,
  webauthn
}: Pick<
  Awaited<ReturnType<WebAuthnAccount["sign"]>>,
  "signature" | "webauthn"
>) => {
  const { r, s } = parseWebAuthnSignature(signature)

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
      webauthn.authenticatorData,
      webauthn.clientDataJSON,
      BigInt(webauthn.typeIndex ?? 0),
      r,
      s,
      false
    ]
  )
}
