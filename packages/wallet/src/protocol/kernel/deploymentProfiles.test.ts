import { describe, expect, test } from "bun:test"
import {
  resolveSliceWalletDeployment,
  resolveSliceWalletDeploymentProfile,
  sliceWalletCurrentDeploymentProfileId,
  sliceWalletDeploymentProfiles,
  sliceWalletKernelV4Ep09R1DeploymentProfileId
} from "./deploymentProfiles"

describe("Slice Wallet deployment profiles", () => {
  test("resolves only the exact immutable r1 id", () => {
    expect(
      resolveSliceWalletDeploymentProfile(
        sliceWalletKernelV4Ep09R1DeploymentProfileId
      ).id
    ).toBe(sliceWalletKernelV4Ep09R1DeploymentProfileId)
    for (const selector of [
      "0.4.0",
      "Kernel 0.4.0",
      "4.0",
      "kernel 0.4.0",
      " 0.4.0",
      "0.4.1"
    ]) {
      expect(() => resolveSliceWalletDeploymentProfile(selector)).toThrow(
        "Unknown Slice Wallet deployment profile"
      )
    }
  })

  test("gives an explicit persisted selector precedence over the default", () => {
    expect(
      resolveSliceWalletDeploymentProfile(
        sliceWalletKernelV4Ep09R1DeploymentProfileId,
        "future-default"
      ).id
    ).toBe(sliceWalletKernelV4Ep09R1DeploymentProfileId)
    expect(() =>
      resolveSliceWalletDeploymentProfile(undefined, "future-default")
    ).toThrow("Unknown Slice Wallet deployment profile")
  })

  test("freezes r1 and resolves its chain facts through the manifest", () => {
    const profile = sliceWalletDeploymentProfiles[0]
    expect(sliceWalletCurrentDeploymentProfileId).toBe(profile.id)
    expect(Object.isFrozen(sliceWalletDeploymentProfiles)).toBe(true)
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.contractKeys)).toBe(true)

    const deployment = resolveSliceWalletDeployment({
      chainId: 8453,
      factoryVersion: sliceWalletKernelV4Ep09R1DeploymentProfileId
    })
    expect(deployment.factory).toBe(
      deployment.manifest.contracts.kernelFactory.address
    )
    expect(deployment.implementation).toBe(
      deployment.manifest.contracts.kernelImplementation.address
    )
    expect(deployment.rootValidator).toBe(
      deployment.manifest.contracts.webAuthnRootValidator.address
    )
    expect(deployment.entryPoint.address).toBe(
      deployment.manifest.contracts.entryPoint.address
    )
    expect(deployment.erc6492BootstrapFactory).toBeUndefined()

    const developmentDeployment = resolveSliceWalletDeployment({
      chainId: 31337
    })
    expect(developmentDeployment.erc6492BootstrapFactory).toBe(
      developmentDeployment.manifest.contracts.erc6492BootstrapFactory.address
    )
  })
})
