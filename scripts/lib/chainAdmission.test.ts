import { describe, expect, it } from "bun:test"
import {
  hasAdmittedManagementAuthority,
  hasCompleteSliceWalletAdmissionEvidence,
  hasVerifiedManagementAuthorityDeployment
} from "./chainAdmission"

const exactRuntime = {
  deployedRuntimeCodeHash: "0x1234",
  expectedRuntimeCodeHash: "0x1234"
} as const

const completeEvidence = {
  contracts: {
    callPolicy: exactRuntime,
    ecdsaSigner: exactRuntime,
    entryPoint: exactRuntime,
    kernelFactory: exactRuntime,
    kernelImplementation: exactRuntime,
    kernelMetaFactory: exactRuntime,
    p256Verifier: exactRuntime,
    soladyP256Verifier: exactRuntime,
    sudoPolicy: exactRuntime,
    timelockPolicy: exactRuntime,
    timestampPolicy: exactRuntime,
    webAuthnRootValidator: exactRuntime,
    webAuthnSigner: exactRuntime,
    weightedEcdsaSigner: exactRuntime
  },
  status: "admitted",
  verification: {
    factoryStakerApproved: true,
    p256CanaryPassed: true,
    userOperationCanary: { transactionHash: "0x1234" },
    verifiedAtBlock: 1
  }
} as const

describe("wallet chain admission evidence", () => {
  it("fails closed for incomplete or mismatched evidence", () => {
    expect(hasCompleteSliceWalletAdmissionEvidence(completeEvidence)).toBe(true)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        contracts: {
          ...completeEvidence.contracts,
          entryPoint: {
            deployedRuntimeCodeHash: "0xabcd",
            expectedRuntimeCodeHash: "0x1234"
          }
        }
      })
    ).toBe(false)
    const { entryPoint: _entryPoint, ...missingRequiredContract } =
      completeEvidence.contracts
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        contracts: missingRequiredContract
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        contracts: {
          ...completeEvidence.contracts,
          futureWalletContract: {
            deployedRuntimeCodeHash: null,
            expectedRuntimeCodeHash: "0x1234"
          }
        }
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        status: "pending"
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        verification: {
          ...completeEvidence.verification,
          factoryStakerApproved: false
        }
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        verification: {
          ...completeEvidence.verification,
          p256CanaryPassed: false
        }
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        verification: {
          ...completeEvidence.verification,
          verifiedAtBlock: null
        }
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        verification: {
          ...completeEvidence.verification,
          userOperationCanary: null
        }
      })
    ).toBe(false)
  })

  it("admits management only with the exact registry-policy runtime", () => {
    expect(hasVerifiedManagementAuthorityDeployment(completeEvidence)).toBe(
      false
    )
    expect(
      hasVerifiedManagementAuthorityDeployment({
        ...completeEvidence,
        contracts: {
          ...completeEvidence.contracts,
          slicerRegistryPolicy: exactRuntime
        }
      })
    ).toBe(true)
  })

  it("requires explicit bundler support for management validation storage reads", () => {
    const deployment = {
      ...completeEvidence,
      contracts: {
        ...completeEvidence.contracts,
        slicerRegistryPolicy: exactRuntime
      }
    }

    expect(hasAdmittedManagementAuthority(deployment, false)).toBe(false)
    expect(hasAdmittedManagementAuthority(deployment, true)).toBe(true)
  })
})
