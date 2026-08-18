import { describe, expect, it } from "bun:test"
import { kernelDummyEcdsaSignature } from "@slicekit/wallet-primitives/kernel"
import { concat, encodeAbiParameters, hashTypedData, slice } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { recoverTypedDataAddress } from "viem/utils"
import {
  buildWeightedEcdsaStubSignature,
  encodeWeightedEcdsaSignerData,
  getWeightedEcdsaProposalTypedData,
  toWeightedEcdsaSigner,
  weightedEcdsaDummySignature,
  weightedEcdsaSignerSignatureHexLength
} from "./weightedSigner"

const account = "0x3333333333333333333333333333333333333333"
const sessionSignerAddress = "0x1111111111111111111111111111111111111111"
const coSignerAddress = "0x2222222222222222222222222222222222222222"
const permissionId = "0x01020304"

describe("weighted ECDSA signer", () => {
  it("ABI-encodes two guardians, equal weights, and a 2-of-2 threshold", () => {
    expect(
      encodeWeightedEcdsaSignerData({ coSignerAddress, sessionSignerAddress })
    ).toBe(
      encodeAbiParameters(
        [
          { name: "guardians", type: "address[]" },
          { name: "weights", type: "uint24[]" },
          { name: "threshold", type: "uint24" }
        ],
        [[sessionSignerAddress, coSignerAddress], [1, 1], 2]
      )
    )
  })

  it("uses a 130-byte dummy signature", () => {
    expect(weightedEcdsaDummySignature).toBe(
      concat([kernelDummyEcdsaSignature, kernelDummyEcdsaSignature])
    )
    expect(weightedEcdsaDummySignature.length).toBe(
      weightedEcdsaSignerSignatureHexLength
    )
    expect(
      toWeightedEcdsaSigner({
        coSignerAddress,
        sessionSignerAddress
      }).stubSignature.length
    ).toBe(weightedEcdsaSignerSignatureHexLength)
  })

  it("builds the signer-domain proposal typed data", () => {
    const typedData = getWeightedEcdsaProposalTypedData({
      account,
      callData: "0x1234",
      chainId: 8453,
      nonce: 9n,
      permissionId,
      verifyingContract: "0x4444444444444444444444444444444444444444"
    })

    expect(typedData.domain).toEqual({
      chainId: 8453,
      name: "WeightedECDSASigner",
      verifyingContract: "0x4444444444444444444444444444444444444444",
      version: "0.0.2"
    })
    expect(typedData.message).toEqual({
      account,
      callData: "0x1234",
      id: "0x0102030400000000000000000000000000000000000000000000000000000000",
      nonce: 9n
    })
    expect(hashTypedData(typedData)).toBe(
      "0x38f896662c30a90ec3ff78287daaa0e49764b8331cfd1cbc21598ddc3b9e25c6"
    )
  })

  it("builds an estimation stub with a real proposal signature and a dummy co-signature", async () => {
    const sessionPrivateKey =
      "0x0505050505050505050505050505050505050505050505050505050505050505" as const
    const sessionAccount = privateKeyToAccount(sessionPrivateKey)
    const typedData = getWeightedEcdsaProposalTypedData({
      account,
      callData: "0xdeadbeef",
      chainId: 8453,
      nonce: 42n,
      permissionId
    })
    const proposalSignature = await sessionAccount.signTypedData(typedData)

    const stub = buildWeightedEcdsaStubSignature(proposalSignature)

    expect(stub.length).toBe(weightedEcdsaSignerSignatureHexLength)
    expect(slice(stub, 0, 65)).toBe(proposalSignature)
    expect(slice(stub, 65)).toBe(kernelDummyEcdsaSignature)
    // The proposal slot must recover to the registered session guardian so
    // the weighted signer never hits its ZeroWeightSigner revert during
    // eth_estimateUserOperationGas; only the dummy last slot soft-fails.
    expect(
      await recoverTypedDataAddress({
        ...typedData,
        signature: slice(stub, 0, 65)
      })
    ).toBe(sessionAccount.address)
  })
})
