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

// Deployed root-account simulation must pass through EntryPoint so Kernel can
// establish its transient validation context before executing the call.
export const sliceWalletSimulationCaller =
  "0x0000000000000000000000000000000000000001"
export const sliceWalletSimulationValidatorCode =
  "0x600060005260206000f3" as const
export const sliceWalletSimulationMulticall =
  "0xca11bde05977b3631167028862be2a173976ca11" as const
// Snapshot reads must not mutate state: Multicall3's aggregate3 performs
// ordinary CALLs, so a hostile token's balanceOf could alter the very state
// being measured. Reads are routed through this forwarder instead, injected
// via state override at an address beyond any precompile range. Compiled from
// a fallback-only contract whose assembly performs exactly one STATICCALL:
//
//   let target := calldataload(0)   ; left-padded word: integer == address
//   let size := sub(calldatasize(), 32)
//   calldatacopy(0x20, 32, size)
//   let ok := staticcall(gas(), target, 0x20, size, 0, 0)
//   returndatacopy(0, 0, returndatasize())
//   ok ? return(0, returndatasize()) : revert(0, returndatasize())
//
// so a reverting read surfaces as a failed aggregate3 subcall, matching the
// tolerant per-read parsing. Calldata layout: <32-byte left-padded inner
// target> ++ <original call data>. Executed against Anvil in
// simulationStaticCallProxy.test.ts.
export const sliceWalletSimulationStaticCallProxy =
  "0x0000000000000000000000000000000000010000" as const
export const sliceWalletSimulationStaticCallCode =
  "0x608060405236601f190180602080375f5f8260205f355afa90503d5f5f3e8080156027573d5ff35b3d5ffdfea26469706673582212208c02c51193c444effa7247b70ae3357d3c875d7302a9665d3ce6c91ebac55e3e64736f6c634300081c0033" as const

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
