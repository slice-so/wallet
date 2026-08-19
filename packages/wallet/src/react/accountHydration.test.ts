import { describe, expect, test } from "bun:test"
import {
  shouldCommitActivation,
  shouldLockReplacedSliceAccount
} from "./accountHydration"

const account = "0x0000000000000000000000000000000000000001" as const
const otherAccount = "0x0000000000000000000000000000000000000002" as const

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
