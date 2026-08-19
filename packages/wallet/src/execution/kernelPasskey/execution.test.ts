import { describe, expect, it } from "bun:test"
import {
  getKernelNonceValidation,
  isKernelRootValidationNonce
} from "@slicekit/wallet-primitives/execution"
import { Base64 } from "ox"
import { decodeAbiParameters, keccak256, toHex } from "viem"
import {
  encodeWebAuthnRootValidatorData,
  encodeWebAuthnValidatorSignature
} from "./webAuthn"

const buildKernelNonce = ({
  mode,
  validatorAddress,
  validatorType
}: {
  mode: bigint
  validatorAddress: bigint
  validatorType: bigint
}) => (mode << 248n) | (validatorType << 240n) | (validatorAddress << 80n) | 7n

describe("kernel nonce validation parsing", () => {
  it("identifies root (passkey) validation nonces", () => {
    expect(
      isKernelRootValidationNonce(
        buildKernelNonce({ mode: 0n, validatorAddress: 0n, validatorType: 0n })
      )
    ).toBe(true)
  })

  it("identifies enable-mode and permission-validator nonces as non-root", () => {
    const validatorAddress = 0x7ab16ff354acb328452f1d445b3ddee9a91e9e69n

    const enableNonce = buildKernelNonce({
      mode: 1n,
      validatorAddress,
      validatorType: 2n
    })
    expect(isKernelRootValidationNonce(enableNonce)).toBe(false)

    const permissionNonce = buildKernelNonce({
      mode: 0n,
      validatorAddress,
      validatorType: 2n
    })
    expect(isKernelRootValidationNonce(permissionNonce)).toBe(false)

    const parsed = getKernelNonceValidation(permissionNonce)
    expect(parsed.mode).toBe(0)
    expect(parsed.validatorType).toBe(2)
    expect(parsed.validatorAddress).toBe(
      "0x7ab16ff354acb328452f1d445b3ddee9a91e9e69"
    )
  })
})

describe("webauthn root validator encoding", () => {
  it("encodes the credential public key and authenticator id hash", () => {
    // Uncompressed P-256 public key (0x04 || x || y)
    const x = 1234n
    const y = 5678n
    const publicKey = `0x04${x.toString(16).padStart(64, "0")}${y
      .toString(16)
      .padStart(64, "0")}` as const
    const credentialId = Base64.fromBytes(new Uint8Array([1, 2, 3, 4]), {
      url: true
    })

    const encoded = encodeWebAuthnRootValidatorData({
      id: credentialId,
      publicKey
    })
    const [webAuthnData, authenticatorIdHash] = decodeAbiParameters(
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
      encoded
    )

    expect(webAuthnData.x).toBe(x)
    expect(webAuthnData.y).toBe(y)
    expect(authenticatorIdHash).toBe(
      keccak256(toHex(Base64.toBytes(credentialId)))
    )
  })
})

describe("webauthn validator signature envelope", () => {
  it("packs assertion metadata with r and s", () => {
    const r = 11n
    const s = 22n
    const signature = `0x${r.toString(16).padStart(64, "0")}${s
      .toString(16)
      .padStart(64, "0")}` as const

    const encoded = encodeWebAuthnValidatorSignature({
      signature,
      webauthn: {
        authenticatorData: "0x1234",
        challengeIndex: 23,
        clientDataJSON: '{"type":"webauthn.get"}',
        typeIndex: 1,
        userVerificationRequired: false
      }
    })

    const [authenticatorData, clientDataJSON, typeIndex, rOut, sOut] =
      decodeAbiParameters(
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

    expect(authenticatorData).toBe("0x1234")
    expect(clientDataJSON).toBe('{"type":"webauthn.get"}')
    expect(typeIndex).toBe(1n)
    expect(rOut).toBe(r)
    expect(sOut).toBe(s)
  })
})
