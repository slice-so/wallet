import { describe, expect, it } from "bun:test"
import { hasCompleteSliceWalletAdmissionEvidence } from "./chainAdmission"

const completeEvidence = {
  contracts: {
    entryPoint: {
      deployedRuntimeCodeHash: "0x1234",
      expectedRuntimeCodeHash: "0x1234"
    }
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
          entryPoint: {
            deployedRuntimeCodeHash: "0xabcd",
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
})
