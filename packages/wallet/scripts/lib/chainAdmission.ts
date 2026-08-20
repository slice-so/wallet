type AdmissionEvidence = {
  runtimeCodeHashes: Readonly<Record<string, string | null>>
  status: string
  verification: {
    kernelReleaseCommit: string
    p256CanaryPassed: boolean
    verifiedAtBlock: number | null
  }
}

const requiredWalletContractNames = [
  "callPolicy",
  "ecdsaSigner",
  "entryPoint",
  "kernelFactory",
  "kernelImplementation",
  "kernelStaker",
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
  deployment.verification.kernelReleaseCommit ===
    "f2a84a332ec5a722e7e95a0d64601905c3c87fe9" &&
  deployment.verification.p256CanaryPassed &&
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
  hasRuntime(deployment, "authorizationRevocationRegistry") &&
  hasRuntime(deployment, "weightedP256Signer")

export const hasVerifiedManagementAuthorityDeployment = (
  deployment: AdmissionEvidence
) =>
  hasCompleteSliceWalletAdmissionEvidence(deployment) &&
  hasRuntime(deployment, "authorizationRevocationRegistry") &&
  hasRuntime(deployment, "slicerRegistryPolicy")

export const hasAdmittedManagementAuthority = (
  deployment: AdmissionEvidence,
  validationStorageReadsAllowed: boolean
) =>
  validationStorageReadsAllowed &&
  hasVerifiedManagementAuthorityDeployment(deployment)
