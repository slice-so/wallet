import { describe, expect, test } from "bun:test"
import {
  getSliceWalletChainManifest,
  getSliceWalletChainPolicy,
  sliceWalletChainManifests,
  sliceWalletSupportedChainIds
} from "./chains"

describe("Slice Wallet chain manifest", () => {
  test("deep-freezes generated security and operational metadata", () => {
    const base = getSliceWalletChainPolicy(8453)

    expect(Object.isFrozen(sliceWalletChainManifests)).toBe(true)
    expect(Object.isFrozen(base)).toBe(true)
    expect(Object.isFrozen(base.chain)).toBe(true)
    expect(Object.isFrozen(base.chain.nativeCurrency)).toBe(true)
    expect(Object.isFrozen(base.contracts)).toBe(true)
    expect(Object.isFrozen(base.contracts.weightedP256Signer)).toBe(true)
    expect(Object.isFrozen(base.executionSafety)).toBe(true)
    expect(Object.isFrozen(base.defaultTransports)).toBe(true)
    expect(Object.isFrozen(base.funding.sponsoredSecurityOperations)).toBe(true)
    expect(() =>
      Object.defineProperty(base.contracts, "entryPoint", { value: null })
    ).toThrow()
  })

  test("exposes only chains with complete admission evidence", () => {
    expect(getSliceWalletChainPolicy(8453).admitted).toBe(true)
    expect(sliceWalletSupportedChainIds).toEqual([8453])
    expect(getSliceWalletChainManifest(8453).chain.id).toBe(8453)
  })

  test("rejects chains missing from the generated inputs", () => {
    expect(() => getSliceWalletChainPolicy(10)).toThrow(
      "Slice Wallet chain 10 is unsupported."
    )
  })
})
