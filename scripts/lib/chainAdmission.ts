type AdmissionContractEvidence = {
  deployedRuntimeCodeHash: string | null
  expectedRuntimeCodeHash: string
}

type AdmissionEvidence = {
  contracts: Readonly<Record<string, AdmissionContractEvidence>>
  status: string
  verification: {
    factoryStakerApproved: boolean
    p256CanaryPassed: boolean
    userOperationCanary: object | null
    verifiedAtBlock: number | null
  }
}

const baseWalletContractNames = [
  "callPolicy",
  "ecdsaSigner",
  "entryPoint",
  "kernelFactory",
  "kernelImplementation",
  "kernelMetaFactory",
  "p256Verifier",
  "soladyP256Verifier",
  "sudoPolicy",
  "timelockPolicy",
  "timestampPolicy",
  "webAuthnRootValidator",
  "webAuthnSigner",
  "weightedEcdsaSigner"
] as const

const authoritySpecificContractNames = new Set([
  "rateLimitPolicy",
  "slicerRegistryPolicy",
  "weightedP256Signer"
])

const hasExactRuntime = (contract: AdmissionContractEvidence | undefined) =>
  contract !== undefined &&
  contract.deployedRuntimeCodeHash !== null &&
  contract.deployedRuntimeCodeHash === contract.expectedRuntimeCodeHash

export const hasCompleteSliceWalletAdmissionEvidence = (
  deployment: AdmissionEvidence
) =>
  deployment.status === "admitted" &&
  baseWalletContractNames.every((name) =>
    hasExactRuntime(deployment.contracts[name])
  ) &&
  Object.entries(deployment.contracts).every(
    ([name, contract]) =>
      authoritySpecificContractNames.has(name) || hasExactRuntime(contract)
  ) &&
  deployment.verification.factoryStakerApproved &&
  deployment.verification.p256CanaryPassed &&
  deployment.verification.userOperationCanary !== null &&
  deployment.verification.verifiedAtBlock !== null

export const hasVerifiedGenericAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasExactRuntime(deployment.contracts.rateLimitPolicy)

export const hasVerifiedCheckoutAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasExactRuntime(deployment.contracts.weightedP256Signer)

export const hasVerifiedManagementAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasExactRuntime(deployment.contracts.slicerRegistryPolicy)

export const hasAdmittedManagementAuthority = (
  deployment: AdmissionEvidence,
  validationStorageReadsAllowed: boolean
) =>
  validationStorageReadsAllowed &&
  hasVerifiedManagementAuthorityDeployment(deployment)
