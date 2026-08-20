import type { Address } from "viem"
import type { SliceWalletRegisteredRootCredential } from "./account"
import type { SliceKernelPolicy } from "./kernel"

export type SliceTimelockPolicyParameters = {
  delaySec?: number
  expirationSec?: number
  guardian?: Address
  policyAddress?: Address
}

export type SliceTimelockPolicy = SliceKernelPolicy & {
  sliceTimelockPolicyParams: {
    delaySec: number
    expirationSec: number
    guardian: Address
    policyAddress: Address
    type: "slice-timelock"
  }
}

export type PredictSliceWalletKernelAccountAddressParameters = {
  chainId: number
  credential: SliceWalletRegisteredRootCredential
  factoryVersion?: string
  index?: bigint
  recoverySignerAddress: Address
}
