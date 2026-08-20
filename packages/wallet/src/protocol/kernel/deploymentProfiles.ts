import { entryPoint09Abi } from "viem/account-abstraction"
import {
  getSliceWalletChainPolicy,
  sliceWalletDevelopmentChainIds
} from "../chains"
import type {
  SliceWalletDeploymentProfile,
  SliceWalletDeploymentProfileId
} from "../types/deploymentProfile"

export const sliceWalletKernelV4Ep09R1DeploymentProfileId =
  "slice-kernel-v4-ep09-r1" as const satisfies SliceWalletDeploymentProfileId

export const sliceWalletCurrentDeploymentProfileId =
  sliceWalletKernelV4Ep09R1DeploymentProfileId

const kernelV4Ep09R1ContractKeys = Object.freeze({
  erc6492BootstrapFactory: "erc6492BootstrapFactory",
  entryPoint: "entryPoint",
  factory: "kernelFactory",
  implementation: "kernelImplementation",
  rootValidator: "webAuthnRootValidator"
} as const)

const kernelV4Ep09R1Profile = Object.freeze({
  accountRecipe: "kernel-v4-erc1967-webauthn-root-r1",
  contractKeys: kernelV4Ep09R1ContractKeys,
  entryPointVersion: "0.9",
  id: sliceWalletKernelV4Ep09R1DeploymentProfileId,
  kernelVersion: "0.4.0",
  proxyRuntimeCodeHash:
    "0xaaa52c8cc8a0e3fd27ce756cc6b4e70c51423e9b597b11f32d3e49f8b1fc890d"
} as const satisfies SliceWalletDeploymentProfile)

export const sliceWalletDeploymentProfiles = Object.freeze([
  kernelV4Ep09R1Profile
] as const satisfies readonly SliceWalletDeploymentProfile[])

export class SliceWalletDeploymentProfileError extends Error {}

export const resolveSliceWalletDeploymentProfile = (
  selector?: string,
  defaultSelector: string = sliceWalletCurrentDeploymentProfileId
): SliceWalletDeploymentProfile => {
  const selectedProfile = selector ?? defaultSelector
  const profile = sliceWalletDeploymentProfiles.find(
    (candidate) => candidate.id === selectedProfile
  )
  if (profile === undefined) {
    throw new SliceWalletDeploymentProfileError(
      `Unknown Slice Wallet deployment profile: ${selectedProfile}.`
    )
  }
  return profile
}

export const resolveSliceWalletDeploymentProfileId = (selector?: string) =>
  resolveSliceWalletDeploymentProfile(selector).id

export const resolveSliceWalletDeployment = ({
  chainId,
  factoryVersion
}: {
  chainId: number
  factoryVersion?: string
}) => {
  const profile = resolveSliceWalletDeploymentProfile(factoryVersion)
  const manifest = getSliceWalletChainPolicy(chainId)
  const entryPoint = manifest.contracts[profile.contractKeys.entryPoint]
  const erc6492BootstrapFactory =
    manifest.contracts[profile.contractKeys.erc6492BootstrapFactory]
  const implementation = manifest.contracts[profile.contractKeys.implementation]
  if (
    entryPoint.version !== profile.entryPointVersion ||
    implementation.version !== profile.kernelVersion
  ) {
    throw new SliceWalletDeploymentProfileError(
      `Slice Wallet deployment profile ${profile.id} is not provisioned on chain ${chainId}.`
    )
  }
  return {
    entryPoint: {
      abi: entryPoint09Abi,
      address: entryPoint.address,
      version: entryPoint.version
    },
    erc6492BootstrapFactory:
      erc6492BootstrapFactory.runtimeCodeHash !== null ||
      sliceWalletDevelopmentChainIds.includes(
        chainId as (typeof sliceWalletDevelopmentChainIds)[number]
      )
        ? erc6492BootstrapFactory.address
        : undefined,
    factory: manifest.contracts[profile.contractKeys.factory].address,
    implementation: implementation.address,
    manifest,
    profile,
    rootValidator:
      manifest.contracts[profile.contractKeys.rootValidator].address
  } as const
}
