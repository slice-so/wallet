import { describe, expect, test } from "bun:test"
import type { Hex } from "viem"
import { getSliceWalletRegistryProofChallenge } from "./registry"

const base = {
  challenge: `0x${"11".repeat(32)}` as Hex,
  credentialIdHash: `0x${"22".repeat(32)}` as Hex,
  publicKey: `0x04${"33".repeat(64)}` as Hex,
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
  })
})
