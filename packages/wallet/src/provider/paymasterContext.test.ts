import { describe, expect, test } from "bun:test"
import type { SliceWalletProviderValue } from "../types"
import { canonicalizeSliceWalletPaymasterContext } from "./paymasterContext"

describe("ERC-7677 paymaster context canonicalization", () => {
  test("sorts object keys recursively and preserves array order", () => {
    const first = canonicalizeSliceWalletPaymasterContext({
      policy: { tier: "buyer", version: 1 },
      tags: ["checkout", "portable"]
    })
    const reordered = canonicalizeSliceWalletPaymasterContext({
      tags: ["checkout", "portable"],
      policy: { version: 1, tier: "buyer" }
    })
    const differentArray = canonicalizeSliceWalletPaymasterContext({
      policy: { tier: "buyer", version: 1 },
      tags: ["portable", "checkout"]
    })

    expect(first.canonicalJson).toBe(
      '{"policy":{"tier":"buyer","version":1},"tags":["checkout","portable"]}'
    )
    expect(reordered.canonicalHash).toBe(first.canonicalHash)
    expect(reordered.value).toEqual(first.value)
    expect(differentArray.canonicalHash).not.toBe(first.canonicalHash)
  })

  test.each([
    1n,
    { missing: undefined },
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(0)
  ] as SliceWalletProviderValue[])(
    "rejects non-JSON or non-plain context %#",
    (value) => {
      expect(() => canonicalizeSliceWalletPaymasterContext(value)).toThrow(
        "Paymaster context"
      )
    }
  )

  test("rejects cycles, sparse arrays, and accessor properties", () => {
    const cycle: { self?: SliceWalletProviderValue } = {}
    cycle.self = cycle
    const sparse: SliceWalletProviderValue[] = []
    sparse.length = 2
    sparse[1] = "present"
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "secret"
    }) as SliceWalletProviderValue

    expect(() => canonicalizeSliceWalletPaymasterContext(cycle)).toThrow(
      "must not contain cycles"
    )
    expect(() => canonicalizeSliceWalletPaymasterContext(sparse)).toThrow(
      "sparse or extended arrays"
    )
    expect(() => canonicalizeSliceWalletPaymasterContext(accessor)).toThrow(
      "enumerable data properties"
    )
  })

  test("enforces depth, key-count, array-length, and byte caps", () => {
    let deep: SliceWalletProviderValue = "end"
    for (let index = 0; index < 10; index += 1) deep = { child: deep }
    const manyKeys = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`key-${index}`, index])
    ) as SliceWalletProviderValue

    expect(() => canonicalizeSliceWalletPaymasterContext(deep)).toThrow(
      "maximum depth"
    )
    expect(() => canonicalizeSliceWalletPaymasterContext(manyKeys)).toThrow(
      "maximum of 128 keys"
    )
    expect(() =>
      canonicalizeSliceWalletPaymasterContext(
        Array.from({ length: 129 }, () => 1)
      )
    ).toThrow("maximum array length")
    expect(() =>
      canonicalizeSliceWalletPaymasterContext("x".repeat(8_193))
    ).toThrow("8192 serialized bytes")
  })
})
