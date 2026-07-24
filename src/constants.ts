import { getSliceWalletChainPolicy } from "./chains"

export const maximumBrowserGenericGrantTtlSec = 30 * 24 * 60 * 60

const baseManifest = getSliceWalletChainPolicy(8453)

export const sliceWalletKernelVersion =
  baseManifest.contracts.kernelImplementation.version
export const sliceWalletEntryPoint = {
  address: baseManifest.contracts.entryPoint.address,
  version: baseManifest.contracts.entryPoint.version
} as const

export const sliceWalletKernelAddresses = {
  callPolicyV005: baseManifest.contracts.callPolicy.address,
  ecdsaSigner: baseManifest.contracts.ecdsaSigner.address,
  factory: baseManifest.contracts.kernelFactory.address,
  implementation: baseManifest.contracts.kernelImplementation.address,
  metaFactory: baseManifest.contracts.kernelMetaFactory.address,
  p256Verifier: baseManifest.contracts.p256Verifier.address,
  sudoPolicy: baseManifest.contracts.sudoPolicy.address,
  timelockPolicy: baseManifest.contracts.timelockPolicy.address,
  webAuthnRootValidator: baseManifest.contracts.webAuthnRootValidator.address,
  webAuthnSignerV004: baseManifest.contracts.webAuthnSigner.address,
  weightedEcdsaSigner: baseManifest.contracts.weightedEcdsaSigner.address,
  weightedP256Signer: baseManifest.contracts.weightedP256Signer.address
} as const

export const sliceWalletDefaultRpId = "id.slice.so"
export const sliceWalletProtocolVersion = 1 as const
