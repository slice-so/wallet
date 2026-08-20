import type { Address } from "viem"
import { base } from "viem/chains"
import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses
} from "../../constants"

export const sliceKernelVersion = "4.0" as const
export const sliceKernelPasskeyBackend = "kernel-passkey" as const

export const sliceKernelAddresses = {
  factory: sliceWalletKernelAddresses.factory,
  implementation: sliceWalletKernelAddresses.implementation
} as const satisfies Record<"factory" | "implementation", Address>

export const sliceKernelWebAuthnValidatorAddress =
  sliceWalletKernelAddresses.webAuthnRootValidator satisfies Address

export const sliceKernelWeightedP256SignerAddress =
  sliceWalletKernelAddresses.weightedP256Signer satisfies Address

export const sliceKernelTimelockPolicyAddress =
  sliceWalletKernelAddresses.timelockPolicy satisfies Address

export const sliceKernelSlicerRegistryPolicyAddress =
  sliceWalletKernelAddresses.slicerRegistryPolicy satisfies Address

/** Canonical Slice Kernel lane: Kernel v4 accounts on EntryPoint v0.9. */
export const sliceKernelConfig = {
  addresses: sliceKernelAddresses,
  backend: sliceKernelPasskeyBackend,
  chainId: base.id,
  entryPoint: sliceWalletEntryPoint.address,
  entryPointVersion: sliceWalletEntryPoint.version,
  version: sliceKernelVersion
} as const
