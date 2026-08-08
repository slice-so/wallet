type AdmissionEvidence = {
  runtimeCodeHashes: Readonly<Record<string, string | null>>
  status: string
  verification: {
    factoryStakerApproved: boolean
    p256CanaryPassed: boolean
    userOperationCanary: object | null
    verifiedAtBlock: number | null
  }
}

const requiredWalletContractNames = [
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
  "webAuthnSigner"
] as const

const hasRuntime = (deployment: AdmissionEvidence, contractName: string) =>
  deployment.runtimeCodeHashes[contractName] !== undefined &&
  deployment.runtimeCodeHashes[contractName] !== null

export const hasCompleteSliceWalletAdmissionEvidence = (
  deployment: AdmissionEvidence
) =>
  deployment.status === "admitted" &&
  requiredWalletContractNames.every((name) => hasRuntime(deployment, name)) &&
  deployment.verification.factoryStakerApproved &&
  deployment.verification.p256CanaryPassed &&
  deployment.verification.userOperationCanary !== null &&
  deployment.verification.verifiedAtBlock !== null

export const hasVerifiedGenericAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasRuntime(deployment, "rateLimitPolicy")

export const hasVerifiedCheckoutAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasRuntime(deployment, "weightedP256Signer")

export const hasVerifiedManagementAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasRuntime(deployment, "slicerRegistryPolicy")

export const hasAdmittedManagementAuthority = (
  deployment: AdmissionEvidence,
  validationStorageReadsAllowed: boolean
) =>
  validationStorageReadsAllowed &&
  hasVerifiedManagementAuthorityDeployment(deployment)
