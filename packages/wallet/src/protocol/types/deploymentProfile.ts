import type { Hex } from "viem"
import type { SliceWalletContractDeployments } from "./chains"

export type SliceWalletDeploymentProfileId = "slice-kernel-v4-ep09-r1"

export type SliceWalletDeploymentProfile = {
  readonly accountRecipe: "kernel-v4-erc1967-webauthn-root-r1"
  readonly contractKeys: {
    readonly erc6492BootstrapFactory: keyof Pick<
      SliceWalletContractDeployments,
      "erc6492BootstrapFactory"
    >
    readonly entryPoint: keyof Pick<
      SliceWalletContractDeployments,
      "entryPoint"
    >
    readonly factory: keyof Pick<
      SliceWalletContractDeployments,
      "kernelFactory"
    >
    readonly implementation: keyof Pick<
      SliceWalletContractDeployments,
      "kernelImplementation"
    >
    readonly rootValidator: keyof Pick<
      SliceWalletContractDeployments,
      "webAuthnRootValidator"
    >
  }
  readonly entryPointVersion: "0.9"
  readonly id: SliceWalletDeploymentProfileId
  readonly kernelVersion: "0.4.0"
  readonly proxyRuntimeCodeHash: Hex
}
