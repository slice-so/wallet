import { describe, expect, it } from "bun:test"
import {
  parseSliceWalletRecoveryEnrollRequest,
  parseSliceWalletRecoveryEnrollResponse
} from "./recoveryEnrollProtocol"

const nonce = `0x${"11".repeat(32)}` as const
const request = {
  chainId: 8453,
  credentialId: "credential-id",
  credentialPublicKey: `0x04${"22".repeat(64)}`,
  nonce,
  type: "slice-wallet:recovery-enroll-request",
  version: 1
} as const

const result = {
  account: "0x1111111111111111111111111111111111111111",
  nonce,
  permissionId: "0x12345678",
  signerAddress: "0x2222222222222222222222222222222222222222",
  type: "slice-wallet:recovery-enroll-result",
  version: 1
} as const

describe("recovery enrollment protocol", () => {
  it("parses the exact public request and result", () => {
    expect(parseSliceWalletRecoveryEnrollRequest(request)).toEqual(request)
    expect(parseSliceWalletRecoveryEnrollResponse(result)).toEqual(result)
  })

  it("rejects secret-bearing, replay-shaping, and malformed messages", () => {
    expect(() =>
      parseSliceWalletRecoveryEnrollRequest({
        ...request,
        recoveryPrivateKey: `0x${"33".repeat(32)}`
      })
    ).toThrow("invalid fields")
    expect(() =>
      parseSliceWalletRecoveryEnrollRequest({ ...request, nonce: "0x01" })
    ).toThrow("nonce")
    expect(() =>
      parseSliceWalletRecoveryEnrollResponse({ ...result, version: 2 })
    ).toThrow("invalid")
  })

  it("parses a structured error with no secret fields", () => {
    const error = {
      message: "Enrollment cancelled.",
      nonce,
      type: "slice-wallet:recovery-enroll-error",
      version: 1
    } as const
    expect(parseSliceWalletRecoveryEnrollResponse(error)).toEqual(error)
  })
})
