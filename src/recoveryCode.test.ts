import { describe, expect, it } from "bun:test"
import { generatePrivateKey } from "viem/accounts"
import {
  encodeSliceWalletRecoveryCode,
  isSliceWalletRecoveryCodeShaped,
  parseSliceWalletRecoveryCode,
  sliceWalletRecoveryCodeUsername
} from "./recoveryCode"

const fixedPayload = {
  account: "0x1111111111111111111111111111111111111111",
  chainId: 8453,
  recoveryPrivateKey:
    "0x0000000000000000000000000000000000000000000000000000000000000001"
} as const

const fixedCode =
  "SLW1-000221-8H248H-248H24-8H248H-248H24-8H248H-248000-000000-000000-000000-000000-000000-000000-000000-000007-8NMYEY"

describe("Slice wallet recovery codes", () => {
  it("matches the permanent recovery-code vector", () => {
    expect(encodeSliceWalletRecoveryCode(fixedPayload)).toBe(fixedCode)
    expect(parseSliceWalletRecoveryCode(fixedCode)).toEqual(fixedPayload)
    expect(sliceWalletRecoveryCodeUsername(fixedPayload.account)).toBe(
      `slice-recovery-${fixedPayload.account}`
    )
  })

  it("round-trips randomized private keys", () => {
    for (let index = 0; index < 32; index += 1) {
      const payload = {
        account: "0x2222222222222222222222222222222222222222" as const,
        chainId: 31337,
        recoveryPrivateKey: generatePrivateKey()
      }
      expect(
        parseSliceWalletRecoveryCode(encodeSliceWalletRecoveryCode(payload))
      ).toEqual(payload)
    }
  })

  it("normalizes ambiguous body characters after validating the prefix", () => {
    expect(
      parseSliceWalletRecoveryCode(fixedCode.replace("000221", "OOO22L"))
    ).toEqual(fixedPayload)
    expect(() =>
      parseSliceWalletRecoveryCode(fixedCode.replace("SLW1", "SIW1"))
    ).toThrow("prefix")
  })

  it("distinguishes unsupported versions, malformed codes, and checksum errors", () => {
    expect(() =>
      parseSliceWalletRecoveryCode(fixedCode.replace("SLW1", "SLW2"))
    ).toThrow("newer recovery tool")
    expect(() => parseSliceWalletRecoveryCode(`${fixedCode}0`)).toThrow(
      "length"
    )
    expect(() =>
      parseSliceWalletRecoveryCode(`${fixedCode.slice(0, -1)}Z`)
    ).toThrow("checksum")
    expect(isSliceWalletRecoveryCodeShaped(fixedCode)).toBe(true)
    expect(isSliceWalletRecoveryCodeShaped("not-a-code")).toBe(false)
  })

  it("rejects invalid scalar and chain bounds before encoding", () => {
    expect(() =>
      encodeSliceWalletRecoveryCode({
        ...fixedPayload,
        recoveryPrivateKey: `0x${"00".repeat(32)}`
      })
    ).toThrow("private key")
    expect(() =>
      encodeSliceWalletRecoveryCode({ ...fixedPayload, chainId: 0 })
    ).toThrow("chain id")
    expect(() =>
      encodeSliceWalletRecoveryCode({ ...fixedPayload, chainId: 0x1_0000_0000 })
    ).toThrow("chain id")
  })
})
