import { entryPoint09Abi } from "viem/account-abstraction"
import { getSliceWalletChainPolicy } from "./chains"
import { sliceWalletCurrentDeploymentProfileId } from "./kernel/deploymentProfiles"

export const maximumBrowserGenericGrantTtlSec = 30 * 24 * 60 * 60

const baseManifest = getSliceWalletChainPolicy(8453)

export const sliceWalletKernelVersion =
  baseManifest.contracts.kernelImplementation.version
export { sliceWalletCurrentDeploymentProfileId }
export const sliceWalletEntryPoint = {
  abi: entryPoint09Abi,
  address: baseManifest.contracts.entryPoint.address,
  version: baseManifest.contracts.entryPoint.version
} as const

export const sliceWalletKernelAddresses = {
  callPolicyV005: baseManifest.contracts.callPolicy.address,
  ecdsaSigner: baseManifest.contracts.ecdsaSigner.address,
  erc6492BootstrapFactory:
    baseManifest.contracts.erc6492BootstrapFactory.address,
  factory: baseManifest.contracts.kernelFactory.address,
  immutableEcdsaImplementation:
    baseManifest.contracts.kernelImmutableEcdsa.address,
  implementation: baseManifest.contracts.kernelImplementation.address,
  p256Verifier: baseManifest.contracts.p256Verifier.address,
  rateLimitPolicy: baseManifest.contracts.rateLimitPolicy.address,
  slicerRegistryPolicy: baseManifest.contracts.slicerRegistryPolicy.address,
  staker: baseManifest.contracts.kernelStaker.address,
  sudoPolicy: baseManifest.contracts.sudoPolicy.address,
  timelockPolicy: baseManifest.contracts.timelockPolicy.address,
  timestampPolicy: baseManifest.contracts.timestampPolicy.address,
  webAuthnRootValidator: baseManifest.contracts.webAuthnRootValidator.address,
  webAuthnSignerV004: baseManifest.contracts.webAuthnSigner.address,
  weightedP256Signer: baseManifest.contracts.weightedP256Signer.address
} as const

export const sliceWalletDefaultRpId = "id.slice.so"
export const sliceWalletProtocolVersion = 1 as const
