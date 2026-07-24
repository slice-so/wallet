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
  readonly erc20AllowanceGuard: SliceWalletContractDeployment & {
    readonly version: "1"
  }
  readonly kernelFactory: SliceWalletContractDeployment
  readonly kernelImplementation: SliceWalletContractDeployment & {
    readonly version: "0.3.3"
  }
  readonly kernelMetaFactory: SliceWalletContractDeployment
  readonly p256Verifier: SliceWalletContractDeployment
  readonly singleCallPolicy: SliceWalletContractDeployment & {
    readonly version: "1"
  }
  readonly soladyP256Verifier: SliceWalletContractDeployment
  readonly sudoPolicy: SliceWalletContractDeployment
  readonly timelockPolicy: SliceWalletContractDeployment
  readonly webAuthnRootValidator: SliceWalletContractDeployment
  readonly webAuthnSigner: SliceWalletContractDeployment
  readonly weightedEcdsaSigner: SliceWalletContractDeployment
  readonly weightedP256Signer: SliceWalletContractDeployment
  readonly weightedP256SignerV2: SliceWalletContractDeployment & {
    readonly version: "2"
  }
}

export type SliceWalletProductsModuleDeployment = {
  readonly deployedImplementationAddress: Address | null
  readonly deployedRuntimeCodeHash: Hex | null
  readonly expectedRuntimeCodeHash: Hex
  readonly proxyAddress: Address
  readonly upgradeTransactionHash: Hex | null
  readonly verifiedAtBlock: number | null
}

export type SliceWalletAuthorityKind = "checkout" | "generic"

export type SliceWalletCoreLinkedLibraryDeployments = {
  readonly productManagementLib: SliceWalletContractDeployment
  readonly productPaymentLib: SliceWalletContractDeployment
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
  }
  readonly chain: Chain
  readonly commerce: {
    readonly linkedLibraries: SliceWalletCoreLinkedLibraryDeployments | null
    readonly productsModule: SliceWalletProductsModuleDeployment | null
  }
  readonly contracts: SliceWalletContractDeployments
  readonly defaultTransports: {
    readonly bundlerUrl: string
    readonly rpcUrl: string
  }
  readonly executionSafety: SliceWalletExecutionSafetyEnvelope
  readonly funding: SliceWalletFundingPolicy
  readonly rip7212Available: boolean
}
