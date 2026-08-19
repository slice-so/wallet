import type { Address } from "viem"
import { entryPoint07Address } from "viem/account-abstraction"
import { base } from "viem/chains"
import { sliceWalletKernelAddresses } from "../../constants"

export const sliceKernelV33Version = "3.3" as const
export const sliceKernelPasskeyBackend = "kernel-passkey" as const

export const sliceKernelBaseV33Addresses = {
  factory: "0x2577507b78c2008Ff367261CB6285d44ba5eF2E9",
  implementation: "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28",
  metaFactory: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5"
} as const satisfies Record<
  "factory" | "implementation" | "metaFactory",
  Address
>

export const sliceKernelWebAuthnValidatorAddress =
  "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69" as const satisfies Address

export const sliceKernelWeightedEcdsaSignerAddress =
  sliceWalletKernelAddresses.weightedEcdsaSigner satisfies Address

export const sliceKernelWeightedP256SignerAddress =
  sliceWalletKernelAddresses.weightedP256Signer satisfies Address

export const sliceKernelTimelockPolicyAddress =
  sliceWalletKernelAddresses.timelockPolicy satisfies Address

export const sliceKernelSlicerRegistryPolicyAddress =
  sliceWalletKernelAddresses.slicerRegistryPolicy satisfies Address

export const sliceKernelBaseV33Config = {
  addresses: sliceKernelBaseV33Addresses,
  backend: sliceKernelPasskeyBackend,
  chainId: base.id,
  entryPoint: entryPoint07Address,
  entryPointVersion: "0.7",
  version: sliceKernelV33Version
} as const
