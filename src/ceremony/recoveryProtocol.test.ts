import { describe, expect, it } from "bun:test"
import { formatSliceWalletExistingCredentialAuthorization } from "../registry"
import {
  parseSliceWalletRecoveryHandoffAuthorizationRequest,
  parseSliceWalletRecoveryHandoffAuthorizationResponse,
  parseSliceWalletRecoveryHandoffResult
} from "./recoveryProtocol"

const account = "0x1000000000000000000000000000000000000001" as const
const challenge = `0x${"11".repeat(32)}` as const
const credentialIdHash = `0x${"22".repeat(32)}` as const
const nonce = `0x${"33".repeat(32)}` as const
const publicKey = `0x04${"44".repeat(64)}` as const
const factoryVersion = "0.3.3"
const message = formatSliceWalletExistingCredentialAuthorization({
  accountAddress: account,
  accountIndex: 0,
  challenge,
  credentialIdHash,
  factoryVersion,
  publicKey
})

describe("recovery handoff protocol", () => {
  it("parses the exact root authorization and rejects injected fields", () => {
    const request = {
      account,
      accountIndex: 0,
      challenge,
      credentialIdHash,
      factoryVersion,
      message,
      nonce,
      publicKey,
      type: "slice-wallet:recovery-root-authorization",
      version: 1
    } as const
    expect(
      parseSliceWalletRecoveryHandoffAuthorizationRequest(request)
    ).toMatchObject({ account, credentialIdHash, nonce })
    expect(() =>
      parseSliceWalletRecoveryHandoffAuthorizationRequest({
        ...request,
        digest: challenge
      })
    ).toThrow("invalid fields")
  })

  it("accepts only complete signatures and existing-account credentials", () => {
    expect(
      parseSliceWalletRecoveryHandoffAuthorizationResponse({
        nonce,
        recoveryPermissionId: "0x01020304",
        recoverySignerAddress: account,
        rootSignature: "0x01",
        type: "slice-wallet:recovery-root-signature",
        version: 1
      })
    ).toMatchObject({ nonce, recoverySignerAddress: account })

    const result = {
      credentialId: "credential-id-with-entropy",
      nonce,
      registry: {
        accountAddress: account,
        accountIndex: 0,
        createdAt: "2026-07-11T00:00:00.000Z",
        credentialIdHash,
        factoryVersion,
        publicKey,
        registrationKind: "existing_account"
      },
      type: "slice-wallet:recovery-credential",
      version: 1
    } as const
    expect(parseSliceWalletRecoveryHandoffResult(result)).toMatchObject({
      credentialId: result.credentialId,
      registry: { registrationKind: "existing_account" }
    })
    expect(() =>
      parseSliceWalletRecoveryHandoffResult({
        ...result,
        registry: { ...result.registry, registrationKind: "initial" }
      })
    ).toThrow("existing account")
  })
})
