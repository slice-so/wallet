import type { SliceKernelModularSigner } from "@slicekit/wallet-primitives"
import { sliceKernelWeightedEcdsaSignerAddress } from "@slicekit/wallet-primitives/execution"
import { kernelDummyEcdsaSignature } from "@slicekit/wallet-primitives/kernel"
import { concat, encodeAbiParameters, type Hex, pad } from "viem"
import { privateKeyToAccount, toAccount } from "viem/accounts"
import type {
  WeightedEcdsaProposalTypedDataParameters,
  WeightedEcdsaSignerParameters
} from "../../types/weightedSigner"
export const weightedEcdsaSignerSignatureLength = 130
export const weightedEcdsaSignerSignatureHexLength =
  2 + weightedEcdsaSignerSignatureLength * 2
export const weightedEcdsaGuardianWeights = [1, 1] as const
export const weightedEcdsaThreshold = 2

export const encodeWeightedEcdsaSignerData = ({
  coSignerAddress,
  sessionSignerAddress
}: Pick<
  WeightedEcdsaSignerParameters,
  "coSignerAddress" | "sessionSignerAddress"
>) =>
  encodeAbiParameters(
    [
      { name: "guardians", type: "address[]" },
      { name: "weights", type: "uint24[]" },
      { name: "threshold", type: "uint24" }
    ],
    [
      [sessionSignerAddress, coSignerAddress],
      [...weightedEcdsaGuardianWeights],
      weightedEcdsaThreshold
    ]
  )

export const weightedEcdsaDummySignature = concat([
  kernelDummyEcdsaSignature,
  kernelDummyEcdsaSignature
])

/**
 * Gas-estimation stub: a REAL session-key signature over the proposal digest
 * plus a dummy co-signature. The proposal hash excludes gas fields, so the
 * browser key can sign it before gas is known; the dummy last signature makes
 * the weighted signer soft-fail — bundlers ignore signature failures during
 * estimation, whereas an all-dummy stub recovers a zero-weight proposal
 * signer and the signer REVERTS with ZeroWeightSigner (AA23), aborting
 * estimation.
 */
export const buildWeightedEcdsaStubSignature = (proposalSignature: Hex) =>
  concat([proposalSignature, kernelDummyEcdsaSignature])

export const weightedEcdsaProposalTypes = {
  Proposal: [
    { name: "account", type: "address" },
    { name: "id", type: "bytes32" },
    { name: "callData", type: "bytes" },
    { name: "nonce", type: "uint256" }
  ]
} as const

export const getWeightedEcdsaProposalTypedData = ({
  account,
  callData,
  chainId,
  nonce,
  permissionId,
  verifyingContract = sliceKernelWeightedEcdsaSignerAddress
}: WeightedEcdsaProposalTypedDataParameters) =>
  ({
    domain: {
      chainId,
      name: "WeightedECDSASigner",
      verifyingContract,
      version: "0.0.2"
    },
    message: {
      account,
      callData,
      id: pad(permissionId, { dir: "right", size: 32 }),
      nonce
    },
    primaryType: "Proposal",
    types: weightedEcdsaProposalTypes
  }) as const

export const toWeightedEcdsaSigner = ({
  coSignerAddress,
  sessionPrivateKey,
  sessionSignerAddress,
  signerContractAddress = sliceKernelWeightedEcdsaSignerAddress
}: WeightedEcdsaSignerParameters): SliceKernelModularSigner => {
  const account =
    sessionPrivateKey === undefined
      ? toAccount({
          address: sessionSignerAddress,
          async signMessage() {
            throw new Error("The execution session key is unavailable.")
          },
          async signTransaction() {
            throw new Error("A permission signer cannot sign transactions.")
          },
          async signTypedData() {
            throw new Error("The execution session key is unavailable.")
          }
        })
      : privateKeyToAccount(sessionPrivateKey)

  return {
    account,
    address: signerContractAddress,
    data: encodeWeightedEcdsaSignerData({
      coSignerAddress,
      sessionSignerAddress
    }),
    stubSignature: weightedEcdsaDummySignature
  }
}
