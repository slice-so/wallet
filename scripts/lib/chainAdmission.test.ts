import { describe, expect, it } from "bun:test"
import {
  hasAdmittedManagementAuthority,
  hasCompleteSliceWalletAdmissionEvidence,
  hasVerifiedManagementAuthorityDeployment
} from "./chainAdmission"

const completeEvidence = {
  runtimeCodeHashes: {
    callPolicy: "0x1234",
    ecdsaSigner: "0x1234",
    entryPoint: "0x1234",
    kernelFactory: "0x1234",
    kernelImplementation: "0x1234",
    kernelMetaFactory: "0x1234",
    p256Verifier: "0x1234",
    soladyP256Verifier: "0x1234",
    sudoPolicy: "0x1234",
    timelockPolicy: "0x1234",
    timestampPolicy: "0x1234",
    webAuthnRootValidator: "0x1234",
    webAuthnSigner: "0x1234",
    weightedEcdsaSigner: "0x1234"
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
  it("fails closed for incomplete evidence", () => {
    expect(hasCompleteSliceWalletAdmissionEvidence(completeEvidence)).toBe(true)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        runtimeCodeHashes: {
          ...completeEvidence.runtimeCodeHashes,
          entryPoint: null
        }
      })
    ).toBe(false)
    const { entryPoint: _entryPoint, ...missingRequiredContract } =
      completeEvidence.runtimeCodeHashes
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        runtimeCodeHashes: missingRequiredContract
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

  it("does not make the proof-size optimization a wallet admission requirement", () => {
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        runtimeCodeHashes: {
          ...completeEvidence.runtimeCodeHashes,
          erc6492BootstrapFactory: null
        }
      })
    ).toBe(true)
  })

  it("does not require the Base-only weighted ECDSA signer", () => {
    const { weightedEcdsaSigner: _weightedEcdsaSigner, ...genericEvidence } =
      completeEvidence.runtimeCodeHashes
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...completeEvidence,
        runtimeCodeHashes: genericEvidence
      })
    ).toBe(true)
  })

  it("admits management only with a recorded registry-policy runtime", () => {
    expect(hasVerifiedManagementAuthorityDeployment(completeEvidence)).toBe(
      false
    )
    expect(
      hasVerifiedManagementAuthorityDeployment({
        ...completeEvidence,
        runtimeCodeHashes: {
          ...completeEvidence.runtimeCodeHashes,
          slicerRegistryPolicy: "0x1234"
        }
      })
    ).toBe(true)
  })

  it("requires explicit bundler support for management validation storage reads", () => {
    const deployment = {
      ...completeEvidence,
      runtimeCodeHashes: {
        ...completeEvidence.runtimeCodeHashes,
        slicerRegistryPolicy: "0x1234"
      }
    }

    expect(hasAdmittedManagementAuthority(deployment, false)).toBe(false)
    expect(hasAdmittedManagementAuthority(deployment, true)).toBe(true)
  })
})
