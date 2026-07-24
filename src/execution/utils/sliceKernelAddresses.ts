import type { Address } from "viem"

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
  "0x45fC7d684683773DDA5bE3b3ba0a7997EccFdb0a" as const satisfies Address

export const sliceKernelWeightedP256SignerAddress =
  "0xAD6e9430244f179101207D614F3c810f987d0786" as const satisfies Address

export const sliceKernelWeightedP256SignerV2Address =
  "0x2Ea791821AeEf796EE4444f96e4B4F3A5e8BB5f5" as const satisfies Address

export const sliceKernelSingleCallPolicyAddress =
  "0xb01643c720984eaA0bc2A568c9a6E578655E7470" as const satisfies Address

export const sliceKernelERC20AllowanceGuardAddress =
  "0x5eF07dBFf4f1c4Ae5A386629193BAB686D40CC4B" as const satisfies Address

export const sliceKernelTimelockPolicyAddress =
  "0x7f66B69270f96EC6793c545742CCBbBe028Be3f6" as const satisfies Address
