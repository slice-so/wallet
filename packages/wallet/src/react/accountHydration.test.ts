import { describe, expect, test } from "bun:test"
import {
  shouldCommitActivation,
  shouldLockReplacedSliceAccount,
  toSliceWalletCredentialRecord
} from "./accountHydration"

const account = "0x0000000000000000000000000000000000000001" as const
const otherAccount = "0x0000000000000000000000000000000000000002" as const
const registryCredential = {
  accountAddress: account,
  accountIndex: 0,
  createdAt: "2026-08-18T00:00:00.000Z",
  credentialIdHash: `0x${"11".repeat(32)}` as const,
  factoryVersion: "0.4.0",
  publicKey: `0x04${"22".repeat(64)}` as const,
  recoveryPermissionId: null,
  recoverySignerAddress: null,
  registrationKind: "initial" as const
}

describe("toSliceWalletCredentialRecord", () => {
  test("retains and canonicalizes the persisted deployment selector", () => {
    expect(
      toSliceWalletCredentialRecord(registryCredential).factoryVersion
    ).toBe("slice-kernel-v4-ep09-r1")
  })

  test("rejects an unknown deployment selector during hydration", () => {
    expect(() =>
      toSliceWalletCredentialRecord({
        ...registryCredential,
        factoryVersion: "4.0"
      })
    ).toThrow("Unknown Slice Wallet deployment profile")
  })
})

describe("shouldCommitActivation", () => {
  test("requires a live effect and the currently connected account", () => {
    expect(
      shouldCommitActivation({
        active: true,
        builtAddress: account,
        connectedAccount: account
      })
    ).toBe(true)
    expect(
      shouldCommitActivation({
        active: false,
        builtAddress: account,
        connectedAccount: account
      })
    ).toBe(false)
    expect(
      shouldCommitActivation({
        active: true,
        builtAddress: account,
        connectedAccount: otherAccount
      })
    ).toBe(false)
  })
})

describe("shouldLockReplacedSliceAccount", () => {
  test("locks only when one connected Slice account replaces another", () => {
    expect(
      shouldLockReplacedSliceAccount({
        connectedAccount: otherAccount,
        previousAccount: account
      })
    ).toBe(true)
    expect(
      shouldLockReplacedSliceAccount({
        connectedAccount: account,
        previousAccount: account
      })
    ).toBe(false)
    expect(
      shouldLockReplacedSliceAccount({
        connectedAccount: null,
        previousAccount: account
      })
    ).toBe(false)
  })
})
