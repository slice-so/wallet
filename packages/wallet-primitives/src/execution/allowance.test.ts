import { describe, expect, it } from "bun:test"
import {
  addWalletAllowanceUsdMicros,
  maximumWalletAllowanceUsdMicros,
  maximumWalletAllowanceUsdMicrosDecimal,
  parseWalletAllowanceUsdMicros
} from "./allowance"

describe("wallet allowance", () => {
  it("accepts canonical positive uint128 values", () => {
    expect(parseWalletAllowanceUsdMicros(1n)).toBe("1")
    expect(parseWalletAllowanceUsdMicros(maximumWalletAllowanceUsdMicros)).toBe(
      maximumWalletAllowanceUsdMicrosDecimal
    )
  })

  it.each(["0", "00", "01", "-1", "+1", "1.0", " 1", "1 ", "x"])(
    "rejects non-canonical value %s",
    (value) => {
      expect(() => parseWalletAllowanceUsdMicros(value)).toThrow()
    }
  )

  it("rejects 40 digits and two-to-the-128", () => {
    expect(() => parseWalletAllowanceUsdMicros("1".repeat(40))).toThrow()
    expect(() =>
      parseWalletAllowanceUsdMicros("340282366920938463463374607431768211456")
    ).toThrow()
  })

  it("adds with an overflow check", () => {
    expect(addWalletAllowanceUsdMicros(["1", 2n])).toBe("3")
    expect(() =>
      addWalletAllowanceUsdMicros([maximumWalletAllowanceUsdMicros, 1n])
    ).toThrow()
    expect(() => addWalletAllowanceUsdMicros([])).toThrow()
  })
})
