import { describe, expect, it } from "bun:test"
import {
  assertSliceWalletAccountIndex,
  sliceWalletAccountIndexCap,
  sliceWalletMaxAccountIndex
} from "./accountIndex"

describe("Slice wallet account index", () => {
  it("accepts every supported wire index", () => {
    expect(sliceWalletAccountIndexCap).toBe(32)
    expect(sliceWalletMaxAccountIndex).toBe(31)
    for (let index = 0; index < sliceWalletAccountIndexCap; index += 1) {
      expect(assertSliceWalletAccountIndex(index)).toBe(index)
    }
  })

  it("rejects values outside the integer wire range", () => {
    for (const value of [-1, 1.5, 32, Number.NaN]) {
      expect(() => assertSliceWalletAccountIndex(value)).toThrow(
        "between 0 and 31"
      )
    }
  })
})
