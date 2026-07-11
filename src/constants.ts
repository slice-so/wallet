import type { Address } from "viem"
import { entryPoint07Address } from "viem/account-abstraction"

export const sliceWalletKernelVersion = "0.3.3" as const
export const sliceWalletEntryPoint = {
  address: entryPoint07Address,
  version: "0.7"
} as const

export const sliceWalletKernelAddresses = {
  factory: "0x2577507b78c2008Ff367261CB6285d44ba5eF2E9",
  implementation: "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28",
  metaFactory: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
  webAuthnRootValidator: "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69",
  webAuthnSignerV004: "0x65DEeC8fEe717dc044D0CFD63cCf55F02cCaC2b3",
  weightedP256Signer: "0xAD6e9430244f179101207D614F3c810f987d0786"
} as const satisfies Record<string, Address>

export const sliceWalletDefaultRpId = "id.slice.so"
export const sliceWalletProtocolVersion = 1 as const
