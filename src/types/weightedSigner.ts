import type { Address, Hex } from "viem"

export type WeightedEcdsaSignerParameters = {
  coSignerAddress: Address
  sessionPrivateKey?: Hex
  sessionSignerAddress: Address
  signerContractAddress?: Address
}

export type WeightedEcdsaProposalTypedDataParameters = {
  account: Address
  callData: Hex
  chainId: number
  nonce: bigint
  permissionId: Hex
  verifyingContract?: Address
}
