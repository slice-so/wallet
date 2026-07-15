import { describe, expect, test } from "bun:test"
import type { SliceWalletParameters } from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"

describe("canonical Slice Wallet config", () => {
  test("fails closed while no generated chain has admission evidence", () => {
    expect(() => resolveCanonicalSliceWalletConfig()).toThrow(
      "requires unique supported chains"
    )
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
