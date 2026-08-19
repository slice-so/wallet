import { describe, expect, it } from "bun:test"
import { entryPoint07Address } from "viem/account-abstraction"
import {
  normalizeSliceBundlerRpcUrl,
  parseSliceBundlerRequest
} from "./sliceBundlerRequest"

const sender = "0x1111111111111111111111111111111111111111"

describe("Slice bundler request protocol", () => {
  it("parses only the supported methods and canonical parameter shapes", () => {
    const request = parseSliceBundlerRequest({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: [
        { callData: "0x1234", nonce: "0x0", sender },
        entryPoint07Address
      ]
    })
    expect(request).toEqual({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: [
        { callData: "0x1234", nonce: "0x0", sender },
        entryPoint07Address
      ],
      raw: {
        id: 1,
        jsonrpc: "2.0",
        method: "eth_sendUserOperation",
        params: [
          { callData: "0x1234", nonce: "0x0", sender },
          entryPoint07Address
        ]
      }
    })
    expect(
      parseSliceBundlerRequest({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_chainId",
        params: []
      })
    ).toBeNull()
    expect(
      parseSliceBundlerRequest({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_supportedEntryPoints",
        params: [entryPoint07Address]
      })
    ).toBeNull()
  })

  it("allows HTTPS and local HTTP bundlers only", () => {
    expect(normalizeSliceBundlerRpcUrl(" https://bundler.example/rpc ")).toBe(
      "https://bundler.example/rpc"
    )
    expect(normalizeSliceBundlerRpcUrl("http://localhost:4337")).toBe(
      "http://localhost:4337"
    )
    expect(normalizeSliceBundlerRpcUrl("   ")).toBeNull()
    expect(() =>
      normalizeSliceBundlerRpcUrl("http://bundler.example/rpc")
    ).toThrow("not permitted")
  })
})
