import { describe, expect, test } from "bun:test"
import type { Hex } from "viem"
import {
  formatSliceWalletCredentialListAuthorization,
  formatSliceWalletExistingCredentialAuthorization,
  getSliceWalletRegistryProofChallenge,
  SliceWalletRegistryRequestError
} from "./registry"

const base = {
  accountIndex: 0,
  challenge: `0x${"11".repeat(32)}` as Hex,
  chainId: 8453,
  credentialIdHash: `0x${"22".repeat(32)}` as Hex,
  publicKey: `0x04${"33".repeat(64)}` as Hex,
  recoverySignerAddress: "0x0000000000000000000000000000000000000001" as const,
  registrationKind: "initial" as const
}

describe("registry proof challenge commitment", () => {
  test("is deterministic for identical inputs", () => {
    expect(getSliceWalletRegistryProofChallenge(base)).toBe(
      "0x95cdbcfd6543bc8080f2a158e60d63dd16378cdcd31f910a58f403b760c0a6f8"
    )
  })

  test("changes when the credential id hash changes", () => {
    expect(
      getSliceWalletRegistryProofChallenge({
        ...base,
        credentialIdHash: `0x${"44".repeat(32)}`
      })
    ).not.toBe(getSliceWalletRegistryProofChallenge(base))
  })

  test("changes when the chain changes", () => {
    expect(
      getSliceWalletRegistryProofChallenge({
        ...base,
        chainId: 10
      })
    ).not.toBe(getSliceWalletRegistryProofChallenge(base))
  })

  test("changes when the public key changes", () => {
    expect(
      getSliceWalletRegistryProofChallenge({
        ...base,
        publicKey: `0x04${"55".repeat(64)}`
      })
    ).not.toBe(getSliceWalletRegistryProofChallenge(base))
  })

  test("changes when the registration kind changes", () => {
    expect(
      getSliceWalletRegistryProofChallenge({
        ...base,
        registrationKind: "existing_account"
      })
    ).not.toBe(getSliceWalletRegistryProofChallenge(base))
    expect(
      getSliceWalletRegistryProofChallenge({
        ...base,
        registrationKind: "device"
      })
    ).not.toBe(getSliceWalletRegistryProofChallenge(base))
  })

  test("changes when the recovery signer changes", () => {
    expect(
      getSliceWalletRegistryProofChallenge({
        ...base,
        recoverySignerAddress: "0x0000000000000000000000000000000000000002"
      })
    ).not.toBe(getSliceWalletRegistryProofChallenge(base))
  })
})

describe("private credential-list authorization", () => {
  test("binds account, chain, expiry, purpose, and one-shot nonce", () => {
    const authorization = {
      accountAddress: "0x0000000000000000000000000000000000000002",
      challenge: base.challenge,
      chainId: 8453,
      expiresAt: "2026-07-15T12:00:00.000Z"
    } as const
    const message = formatSliceWalletCredentialListAuthorization(authorization)

    expect(message).toContain("Purpose: credential-list")
    expect(message).toContain(`Nonce: ${base.challenge}`)
    expect(message).not.toBe(
      formatSliceWalletCredentialListAuthorization({
        ...authorization,
        chainId: 10
      })
    )
    expect(message).not.toBe(
      formatSliceWalletCredentialListAuthorization({
        ...authorization,
        expiresAt: "2026-07-15T12:01:00.000Z"
      })
    )
  })
})

describe("existing-account registry authorization", () => {
  test("binds the signed message to its chain", () => {
    const input = {
      accountAddress: "0x0000000000000000000000000000000000000002",
      accountIndex: 0,
      challenge: base.challenge,
      credentialIdHash: base.credentialIdHash,
      factoryVersion: "0.3.3",
      publicKey: base.publicKey
    } as const
    const message = formatSliceWalletExistingCredentialAuthorization({
      ...input,
      chainId: 8453
    })
    expect(message).toContain("Version: 1")
    expect(message).not.toBe(
      formatSliceWalletExistingCredentialAuthorization({
        ...input,
        chainId: 10
      })
    )
  })
})

describe("registry request failures", () => {
  test("surfaces a structured registry reason without discarding the body", () => {
    const body = JSON.stringify({ error: "invalid_session_authorization" })
    const error = new SliceWalletRegistryRequestError(400, body)

    expect(error.message).toBe(
      "Slice wallet registry request failed with status 400 (invalid_session_authorization)."
    )
    expect(error.responseBody).toBe(body)
  })

  test("surfaces validation messages returned by the registry", () => {
    const body = JSON.stringify({
      error: { message: "Credential registration payload is invalid." }
    })

    expect(new SliceWalletRegistryRequestError(400, body).message).toBe(
      "Slice wallet registry request failed with status 400 (Credential registration payload is invalid.)."
    )
  })
})
