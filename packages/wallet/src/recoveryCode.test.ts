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
  accountIndex: 1,
  chainId: 8453,
  credentialIdHash: `0x${"22".repeat(32)}`,
  credentialPublicKey: `0x04${"33".repeat(64)}`,
  recoveryPrivateKey:
    "0x0000000000000000000000000000000000000000000000000000000000000001"
} as const

const fixedCode =
  "SLW-000221-8H248H-248H24-8H248H-248H24-8H248H-248000-000000-000000-000000-000000-000000-000000-000000-000004-0J48H2-48H248-H248H2-48H248-H248H2-48H248-H248H2-48H248-H248G4-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-SK6CSK-6CSK6C-R002G1-JS0M"

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
        accountIndex: index,
        chainId: 31337,
        credentialIdHash: fixedPayload.credentialIdHash,
        credentialPublicKey: fixedPayload.credentialPublicKey,
        recoveryPrivateKey: generatePrivateKey()
      }
      expect(
        parseSliceWalletRecoveryCode(encodeSliceWalletRecoveryCode(payload))
      ).toEqual(payload)
    }
  })

  it("uses a single unversioned recovery-code format", () => {
    const code = encodeSliceWalletRecoveryCode(fixedPayload)

    expect(code.startsWith("SLW-")).toBe(true)
    expect(parseSliceWalletRecoveryCode(code)).toEqual(fixedPayload)
  })

  it("normalizes ambiguous body characters after validating the prefix", () => {
    expect(
      parseSliceWalletRecoveryCode(fixedCode.replace("000221", "OOO22L"))
    ).toEqual(fixedPayload)
    expect(() =>
      parseSliceWalletRecoveryCode(fixedCode.replace("SLW", "SIW"))
    ).toThrow("prefix")
  })

  it("accepts lowercase, dash-free, and whitespace-mangled input", () => {
    expect(parseSliceWalletRecoveryCode(fixedCode.toLowerCase())).toEqual(
      fixedPayload
    )
    expect(parseSliceWalletRecoveryCode(fixedCode.replaceAll("-", ""))).toEqual(
      fixedPayload
    )
    expect(
      parseSliceWalletRecoveryCode(fixedCode.replaceAll("-", " \n\t"))
    ).toEqual(fixedPayload)
  })

  it("rejects versioned, malformed, and checksum-invalid codes", () => {
    expect(() =>
      parseSliceWalletRecoveryCode(fixedCode.replace("SLW-", "SLW2-"))
    ).toThrow("length")
    expect(() => parseSliceWalletRecoveryCode(`${fixedCode}0`)).toThrow(
      "length"
    )
    expect(() =>
      parseSliceWalletRecoveryCode(`${fixedCode.replaceAll("-", "")}0`)
    ).toThrow("length")
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
