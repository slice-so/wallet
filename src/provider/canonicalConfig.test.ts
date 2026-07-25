import { describe, expect, test } from "bun:test"
import type { SliceWalletParameters } from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"

describe("canonical Slice Wallet config", () => {
  test("defaults to Base while exposing every admitted wallet chain", () => {
    const config = resolveCanonicalSliceWalletConfig()

    expect(config.defaultChainId).toBe(8453)
    expect(config.chains.map(({ chain }) => chain.id)).toEqual([
      8453, 1, 10, 42161
    ])
    expect(config.requireAdmittedChain).toBe(true)
    expect(config.ceremonyMode).toBe("auto")
  })

  test("rejects unsupported chains and security-metadata overrides", () => {
    expect(() =>
      resolveCanonicalSliceWalletConfig({ chainIds: [137] })
    ).toThrow("not provisioned")
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
    ).toThrow("idOrigin must use id.slice.so")
  })

  test("uses the first configured chain when Base is omitted", () => {
    const config = resolveCanonicalSliceWalletConfig({ chainIds: [10, 1] })

    expect(config.defaultChainId).toBe(10)
  })

  test("accepts only supported ceremony modes", () => {
    expect(
      resolveCanonicalSliceWalletConfig({ ceremonyMode: "iframe" }).ceremonyMode
    ).toBe("iframe")
    const invalidConfig: SliceWalletParameters = {}
    Reflect.set(invalidConfig, "ceremonyMode", "embedded")
    expect(() => resolveCanonicalSliceWalletConfig(invalidConfig)).toThrow(
      "ceremonyMode is invalid"
    )
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

    expect(config.chains.find(({ chain }) => chain.id === 8453)).toMatchObject({
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

  test("allows Anvil only with explicit loopback identity and transports", () => {
    if (process.env.NODE_ENV === "production") {
      expect(() =>
        resolveCanonicalSliceWalletConfig({
          chainIds: [31_337],
          defaultChainId: 31_337,
          idOrigin: "http://localhost:3003",
          transports: {
            31337: {
              bundlerUrl: "http://localhost:3001/api/bundler",
              rpcUrl: "http://127.0.0.1:8545"
            }
          }
        })
      ).toThrow("unavailable in production")
      return
    }
    const config = resolveCanonicalSliceWalletConfig({
      chainIds: [31_337],
      defaultChainId: 31_337,
      idOrigin: "http://localhost:3003",
      transports: {
        31337: {
          bundlerUrl: "http://localhost:3001/api/bundler",
          rpcUrl: "http://127.0.0.1:8545"
        }
      }
    })

    expect(config.requireAdmittedChain).toBe(false)
    expect(config.chains[0]?.chain.id).toBe(31_337)
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        chainIds: [31_337, 8453],
        idOrigin: "http://localhost:3003",
        transports: {
          31337: {
            bundlerUrl: "http://localhost:3001/api/bundler",
            rpcUrl: "http://localhost:8545"
          }
        }
      })
    ).toThrow("cannot be mixed")
  })
})
