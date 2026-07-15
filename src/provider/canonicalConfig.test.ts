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

  test("applies only valid transport URL overrides", () => {
    const config = resolveCanonicalSliceWalletConfig({
      transports: {
        8453: {
          bundlerUrl: "https://bundler.example/rpc",
          rpcUrl: "https://rpc.example"
        }
      }
    })

    expect(config.chains[0]).toMatchObject({
      bundlerUrl: "https://bundler.example/rpc",
      rpcUrl: "https://rpc.example/"
    })
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        transports: {
          8453: {
            paymasterUrl: "https://paymaster.example"
          }
        }
      } as SliceWalletParameters)
    ).toThrow("only rpcUrl and bundlerUrl")
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        transports: { 8453: { rpcUrl: "javascript:alert(1)" } }
      })
    ).toThrow("RPC URL is not permitted")
  })
})
