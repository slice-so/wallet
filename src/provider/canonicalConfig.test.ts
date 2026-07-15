import { describe, expect, test } from "bun:test"
import type { SliceWalletParameters } from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"

describe("canonical Slice Wallet config", () => {
  test("resolves Base defaults from generated inputs", () => {
    const config = resolveCanonicalSliceWalletConfig()

    expect(config).toMatchObject({
      announce: true,
      bundlerUrl: "https://api.slice.so/wallet-rpc/8453/bundler",
      idOrigin: "https://id.slice.so",
      requireAdmittedChain: true,
      rpcUrl: "https://mainnet.base.org"
    })
    expect(config.chain.id).toBe(8453)
    expect(config.paymasterUrl).toBeUndefined()
  })

  test("accepts only HTTP transport overrides", () => {
    const config = resolveCanonicalSliceWalletConfig({
      announce: false,
      chainIds: [8453],
      defaultChainId: 8453,
      transports: {
        8453: {
          bundlerUrl: "http://localhost:4337",
          rpcUrl: "https://rpc.example/base"
        }
      }
    })

    expect(config).toMatchObject({
      announce: false,
      bundlerUrl: "http://localhost:4337/",
      rpcUrl: "https://rpc.example/base"
    })
  })

  test("rejects unsupported chains and security-metadata overrides", () => {
    expect(() => resolveCanonicalSliceWalletConfig({ chainIds: [10] })).toThrow(
      "supports Base only"
    )
    expect(() =>
      resolveCanonicalSliceWalletConfig({ defaultChainId: 10 })
    ).toThrow("default Slice Wallet chain must be Base")
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        idOrigin: "https://evil.example"
      } as SliceWalletParameters)
    ).toThrow("unknown field")
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        transports: {
          8453: {
            rpcUrl: "https://user:secret@rpc.example"
          }
        }
      })
    ).toThrow("RPC URL is not permitted")
  })
})
