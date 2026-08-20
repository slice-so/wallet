import type { Address, Hex, LocalAccount } from "viem"
import type {
  SliceKernelModularSigner,
  SliceWalletRegisteredRootCredential
} from "../protocol/index"
import type { SliceWalletPublicClient } from "./account"
export type SliceWalletDeviceCredential = {
  credentialIdHash: Hex
  publicKey: Hex
}

export type CreateSliceWalletDeviceValidatorParameters = {
  chainId: number
  client: SliceWalletPublicClient
  credential: SliceWalletDeviceCredential
  factoryVersion?: string
  signer: SliceKernelModularSigner
}

export type BuildSliceWalletDeviceCallsParameters =
  CreateSliceWalletDeviceValidatorParameters & {
    account: Address
  }

export type CreateSliceWalletDeviceKernelAccountParameters =
  CreateSliceWalletDeviceValidatorParameters & {
    account: Address
    accountIndex: bigint
    enableSignature?: Hex
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
