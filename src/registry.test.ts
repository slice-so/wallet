import { describe, expect, test } from "bun:test"
import type { Hex } from "viem"
import {
  formatSliceWalletCredentialListAuthorization,
  formatSliceWalletExistingCredentialAuthorization,
  getSliceWalletRegistryProofChallenge
} from "./registry"

const base = {
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
      getSliceWalletRegistryProofChallenge(base)
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
    expect(
      formatSliceWalletExistingCredentialAuthorization({
        ...input,
        chainId: 8453
      })
    ).not.toBe(
      formatSliceWalletExistingCredentialAuthorization({
        ...input,
        chainId: 10
      })
    )
  })
})
