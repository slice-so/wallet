import { describe, expect, test } from "bun:test"
import type { SliceWalletParameters } from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"

describe("canonical Slice Wallet config", () => {
  test("defaults to the admitted Base deployment", () => {
    const config = resolveCanonicalSliceWalletConfig()

    expect(config.defaultChainId).toBe(8453)
    expect(config.chains.map(({ chain }) => chain.id)).toEqual([8453])
    expect(config.requireAdmittedChain).toBe(true)
  })

  test("rejects unsupported chains and security-metadata overrides", () => {
    expect(() => resolveCanonicalSliceWalletConfig({ chainIds: [10] })).toThrow(
      "not provisioned"
    )
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        chainIds: [8453],
        defaultChainId: 10
      })
    ).toThrow("default Slice Wallet chain must be configured")
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        idOrigin: "https://evil.example"
      } as SliceWalletParameters)
    ).toThrow("unknown field")
  })
})
