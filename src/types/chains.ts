import type { Address, Chain, Hex } from "viem"

export type SliceWalletContractDeployment = {
  readonly address: Address
  readonly deployedRuntimeCodeHash: Hex | null
  readonly expectedRuntimeCodeHash: Hex
  readonly version?: string
}

export type SliceWalletContractDeployments = {
  readonly callPolicy: SliceWalletContractDeployment
  readonly ecdsaSigner: SliceWalletContractDeployment
  readonly entryPoint: SliceWalletContractDeployment & {
    readonly version: "0.7"
  }
  readonly kernelFactory: SliceWalletContractDeployment
  readonly kernelImplementation: SliceWalletContractDeployment & {
    readonly version: "0.3.3"
  }
  readonly kernelMetaFactory: SliceWalletContractDeployment
  readonly p256Verifier: SliceWalletContractDeployment
  readonly soladyP256Verifier: SliceWalletContractDeployment
  readonly sudoPolicy: SliceWalletContractDeployment
  readonly timelockPolicy: SliceWalletContractDeployment
  readonly webAuthnRootValidator: SliceWalletContractDeployment
  readonly webAuthnSigner: SliceWalletContractDeployment
  readonly weightedEcdsaSigner: SliceWalletContractDeployment
  readonly weightedP256Signer: SliceWalletContractDeployment
}

export type SliceWalletExecutionSafetyEnvelope = {
  readonly maxCallGasLimit: bigint
  readonly maxFeePerGas: bigint
  readonly maxNativeCostWei: bigint
  readonly maxPaymasterPostOpGasLimit: bigint
  readonly maxPaymasterVerificationGasLimit: bigint
  readonly maxPrefundWei: bigint
  readonly maxPreVerificationGas: bigint
  readonly maxPriorityFeePerGas: bigint
  readonly maxVerificationGasLimit: bigint
}

export type SliceWalletFundingPolicy = {
  readonly defaultPath: "self-funded-or-request-paymaster"
  readonly sliceSponsorshipForExternalOrigins: false
  readonly sponsoredSecurityOperations: readonly "recovery-cancel"[]
}

export type SliceWalletChainManifest = {
  readonly admitted: boolean
  readonly chain: Chain
  readonly contracts: SliceWalletContractDeployments
  readonly defaultTransports: {
    readonly bundlerUrl: string
    readonly rpcUrl: string
  }
  readonly executionSafety: SliceWalletExecutionSafetyEnvelope
  readonly funding: SliceWalletFundingPolicy
  readonly rip7212Available: boolean
}
