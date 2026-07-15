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

export const hasCompleteSliceWalletAdmissionEvidence = (
  deployment: AdmissionEvidence
) =>
  deployment.status === "admitted" &&
  Object.values(deployment.contracts).every(
    (contract) =>
      contract.deployedRuntimeCodeHash !== null &&
      contract.deployedRuntimeCodeHash === contract.expectedRuntimeCodeHash
  ) &&
  deployment.verification.factoryStakerApproved &&
  deployment.verification.p256CanaryPassed &&
  deployment.verification.userOperationCanary !== null &&
  deployment.verification.verifiedAtBlock !== null
