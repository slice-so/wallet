import { describe, expect, test } from "bun:test"
import { sliceWalletKernelAddresses } from "@slicekit/wallet-primitives/server"
import { decodeAbiParameters } from "viem"
import { toAccount } from "viem/accounts"
import {
  getSliceWalletDevicePermissionId,
  toSliceWalletDeviceSigner
} from "./deviceValidator"

const credential = {
  credentialIdHash: `0x${"11".repeat(32)}` as const,
  publicKey: `0x04${"00".repeat(31)}01${"00".repeat(31)}02` as const
}

describe("root-equivalent device validator", () => {
  test("derives the reconstructable v1 permission id", () => {
    expect(getSliceWalletDevicePermissionId(credential.credentialIdHash)).toBe(
      "0xf2fd7058"
    )
    expect(() => getSliceWalletDevicePermissionId("0x1234")).toThrow("32 bytes")
  })

  test("binds WebAuthnSigner data to the credential hash and public key", () => {
    const account = toAccount({
      address: "0x0000000000000000000000000000000000000000",
      signMessage: async () => "0x1234",
      signTransaction: async () => {
        throw new Error("not used")
      },
      signTypedData: async () => "0x1234"
    })
    const signer = toSliceWalletDeviceSigner({ account, credential })
    const [publicKey, authenticatorIdHash] = decodeAbiParameters(
      [
        {
          components: [
            { name: "pubKeyX", type: "uint256" },
            { name: "pubKeyY", type: "uint256" }
          ],
          name: "WebAuthnSignerData",
          type: "tuple"
        },
        { name: "authenticatorIdHash", type: "bytes32" }
      ],
      signer.getSignerData()
    )

    expect(signer.signerContractAddress).toBe(
      sliceWalletKernelAddresses.webAuthnSignerV004
    )
    expect(publicKey).toEqual({ pubKeyX: 1n, pubKeyY: 2n })
    expect(authenticatorIdHash).toBe(credential.credentialIdHash)
  })
})
