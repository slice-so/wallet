import { describe, expect, test } from "bun:test"
import type { SliceWalletParameters } from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"

describe("canonical Slice Wallet config", () => {
  const localParameters = {
    chainIds: [31_337],
    defaultChainId: 31_337,
    idOrigin: "http://localhost:3003",
    transports: {
      31337: {
        bundlerUrl: "http://localhost:3001/api/bundler",
        rpcUrl: "http://127.0.0.1:8545"
      }
    }
  } as const satisfies SliceWalletParameters

  test("rejects the production default while no chain is admitted", () => {
    expect(() => resolveCanonicalSliceWalletConfig()).toThrow(
      "Slice Wallet chain 8453 is not provisioned."
    )
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

  test("rejects configured production chains that are not admitted", () => {
    expect(() =>
      resolveCanonicalSliceWalletConfig({ chainIds: [10, 1] })
    ).toThrow("Slice Wallet chain 10 is not provisioned.")
  })

  test("accepts only supported ceremony modes", () => {
    expect(
      resolveCanonicalSliceWalletConfig({
        ...localParameters,
        ceremonyMode: "iframe"
      }).ceremonyMode
    ).toBe("iframe")
    const invalidConfig: SliceWalletParameters = {}
    Reflect.set(invalidConfig, "ceremonyMode", "embedded")
    expect(() => resolveCanonicalSliceWalletConfig(invalidConfig)).toThrow(
      "ceremonyMode is invalid"
    )
  })

  test("applies only valid transport URL overrides", () => {
    const config = resolveCanonicalSliceWalletConfig({
      ...localParameters,
      transports: {
        31337: {
          bundlerUrl: "http://localhost:4337/rpc",
          rpcUrl: "http://127.0.0.1:8546"
        }
      }
    })

    expect(config.chains[0]).toMatchObject({
      bundlerUrl: "http://localhost:4337/rpc",
      rpcUrl: "http://127.0.0.1:8546/"
    })
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        ...localParameters,
        transports: {
          31337: {
            paymasterUrl: "https://paymaster.example"
          }
        }
      } as SliceWalletParameters)
    ).toThrow("only rpcUrl and bundlerUrl")
    expect(() =>
      resolveCanonicalSliceWalletConfig({
        ...localParameters,
        transports: {
          31337: {
            bundlerUrl: "http://localhost:4337",
            rpcUrl: "javascript:alert(1)"
          }
        }
      })
    ).toThrow("RPC URL is not permitted")
  })

  test("allows Anvil only with explicit loopback identity and transports", () => {
    const config = resolveCanonicalSliceWalletConfig(localParameters)

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
