import type { ModularSigner } from "@zerodev/permissions"
import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import type { Address, Hex, LocalAccount } from "viem"
import type { SliceWalletRegisteredRootCredential } from "./account"

export type SliceWalletDeviceCredential = {
  credentialIdHash: Hex
  publicKey: Hex
}

export type CreateSliceWalletDeviceValidatorParameters = {
  chainId: number
  client: KernelSmartAccountImplementation["client"]
  credential: SliceWalletDeviceCredential
  signer: ModularSigner
}

export type BuildSliceWalletDeviceCallsParameters =
  CreateSliceWalletDeviceValidatorParameters & {
    account: Address
  }

export type CreateSliceWalletDeviceKernelAccountParameters =
  CreateSliceWalletDeviceValidatorParameters & {
    account: Address
    accountIndex: bigint
    rootCredential: SliceWalletRegisteredRootCredential
  }

export type CreateSliceWalletDeviceSignerParameters = {
  account: LocalAccount
  credential: SliceWalletDeviceCredential
}

export type SliceWalletDeviceCall = {
  data: Hex
  to: Address
  value: bigint
}
