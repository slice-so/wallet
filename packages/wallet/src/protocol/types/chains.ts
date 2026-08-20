import type { Address, Chain, Hex } from "viem"

export type SliceWalletContractDeployment = {
  readonly address: Address
  readonly initCodeHash?: Hex
  readonly runtimeCodeHash: Hex | null
  readonly version?: string
}

export type SliceWalletContractDeployments = {
  readonly authorizationRevocationRegistry: SliceWalletContractDeployment
  readonly callPolicy: SliceWalletContractDeployment
  readonly ecdsaSigner: SliceWalletContractDeployment
  readonly erc6492BootstrapFactory: SliceWalletContractDeployment
  readonly entryPoint: SliceWalletContractDeployment & {
    readonly version: "0.9"
  }
  readonly kernelFactory: SliceWalletContractDeployment
  readonly kernelImmutableEcdsa: SliceWalletContractDeployment
  readonly kernelImplementation: SliceWalletContractDeployment & {
    readonly version: "0.4.0"
  }
  readonly kernelStaker: SliceWalletContractDeployment
  readonly p256Verifier: SliceWalletContractDeployment
  readonly rateLimitPolicy: SliceWalletContractDeployment
  readonly slicerRegistryPolicy: SliceWalletContractDeployment
  readonly soladyP256Verifier: SliceWalletContractDeployment
  readonly sudoPolicy: SliceWalletContractDeployment
  readonly timelockPolicy: SliceWalletContractDeployment
  readonly timestampPolicy: SliceWalletContractDeployment
  readonly webAuthnRootValidator: SliceWalletContractDeployment
  readonly webAuthnSigner: SliceWalletContractDeployment
  readonly weightedP256Signer: SliceWalletContractDeployment & {
    readonly version: "1"
  }
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
  readonly sponsoredSecurityOperations: readonly (
    | "device-add"
    | "device-remove"
    | "recovery-cancel"
    | "session-install"
  )[]
}

export type SliceWalletChainManifest = {
  readonly admitted: boolean
  readonly authorityAdmission: {
    readonly checkout: boolean
    readonly generic: boolean
    readonly management: boolean
  }
  readonly chain: Chain
  readonly contracts: SliceWalletContractDeployments
  readonly defaultTransports: {
    readonly bundlerUrl: string
    readonly paymasterUrl: string
    readonly rpcUrl: string
  }
  readonly executionSafety: SliceWalletExecutionSafetyEnvelope
  readonly funding: SliceWalletFundingPolicy
  readonly rip7212Available: boolean
}
