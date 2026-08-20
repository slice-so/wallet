import { describe, expect, test } from "bun:test"
import {
  hasAdmittedManagementAuthority,
  hasCompleteSliceWalletAdmissionEvidence,
  hasVerifiedCheckoutAuthorityDeployment,
  hasVerifiedGenericAuthorityDeployment,
  hasVerifiedManagementAuthorityDeployment
} from "./chainAdmission"

const releaseCommit = "f2a84a332ec5a722e7e95a0d64601905c3c87fe9"
const runtimeCodeHashes = {
  authorizationRevocationRegistry: "0x1234",
  callPolicy: "0x1234",
  ecdsaSigner: "0x1234",
  entryPoint: "0x1234",
  kernelFactory: "0x1234",
  kernelImplementation: "0x1234",
  kernelStaker: "0x1234",
  p256Verifier: "0x1234",
  rateLimitPolicy: "0x1234",
  slicerRegistryPolicy: "0x1234",
  soladyP256Verifier: "0x1234",
  sudoPolicy: "0x1234",
  timelockPolicy: "0x1234",
  timestampPolicy: "0x1234",
  webAuthnRootValidator: "0x1234",
  webAuthnSigner: "0x1234",
  weightedP256Signer: "0x1234"
} as const
const admitted = {
  runtimeCodeHashes,
  status: "admitted",
  verification: {
    kernelReleaseCommit: releaseCommit,
    p256CanaryPassed: true,
    verifiedAtBlock: 1
  }
} as const

describe("Kernel v4 chain admission", () => {
  test("requires the pinned release and base module evidence", () => {
    expect(hasCompleteSliceWalletAdmissionEvidence(admitted)).toBe(true)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...admitted,
        verification: {
          ...admitted.verification,
          kernelReleaseCommit: "untrusted"
        }
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...admitted,
        runtimeCodeHashes: { ...runtimeCodeHashes, entryPoint: null }
      })
    ).toBe(false)
    expect(
      hasCompleteSliceWalletAdmissionEvidence({
        ...admitted,
        runtimeCodeHashes: { ...runtimeCodeHashes, kernelFactory: null }
      })
    ).toBe(false)
  })

  test("requires authority-specific modules", () => {
    expect(hasVerifiedGenericAuthorityDeployment(admitted)).toBe(true)
    expect(hasVerifiedCheckoutAuthorityDeployment(admitted)).toBe(true)
    expect(hasVerifiedManagementAuthorityDeployment(admitted)).toBe(true)
    expect(
      hasVerifiedCheckoutAuthorityDeployment({
        ...admitted,
        runtimeCodeHashes: {
          ...runtimeCodeHashes,
          weightedP256Signer: null
        }
      })
    ).toBe(false)
  })

  test("keeps management storage reads as an explicit prerequisite", () => {
    expect(hasAdmittedManagementAuthority(admitted, true)).toBe(true)
    expect(hasAdmittedManagementAuthority(admitted, false)).toBe(false)
  })
})
