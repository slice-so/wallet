import { describe, expect, it, mock } from "bun:test"
import { pad } from "viem"
import {
  createSliceProxyResponse,
  createSliceSenderAccountFetch,
  createSliceSlicerAddressResolver
} from "./sliceUserOperationTransport"

const sender = "0x1111111111111111111111111111111111111111"
const implementation = "0x2222222222222222222222222222222222222222"
const erc1967ImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"

describe("Slice user-operation transport", () => {
  it("fetches sender code and ERC-1967 state in one batch", async () => {
    const fetchRpc = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json([
          { id: 2, jsonrpc: "2.0", result: pad(implementation, { size: 32 }) },
          { id: 1, jsonrpc: "2.0", result: "0x6001" }
        ])
    )

    const snapshot = await createSliceSenderAccountFetch({
      fetchRpc,
      rpcUrl: "https://rpc.example"
    })(sender)

    expect(snapshot).toEqual({
      code: "0x6001",
      erc1967Implementation: pad(implementation, { size: 32 })
    })
    const [, init] = fetchRpc.mock.calls[0] ?? []
    expect(JSON.parse(String(init?.body))).toEqual([
      {
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getCode",
        params: [sender, "latest"]
      },
      {
        id: 2,
        jsonrpc: "2.0",
        method: "eth_getStorageAt",
        params: [sender, erc1967ImplementationSlot, "latest"]
      }
    ])
  })

  it("resolves slicer addresses fail-closed", async () => {
    const fetchSlicer = mock(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ isSlicer: true })
    )
    const resolve = createSliceSlicerAddressResolver({
      fetchSlicer,
      policyBaseUrl: "https://api.slice.so"
    })

    expect(await resolve(sender)).toBe(true)
    expect(fetchSlicer).toHaveBeenCalledWith(
      `https://api.slice.so/slicers/validate-address/${sender}`,
      { method: "GET" }
    )
    expect(
      await createSliceSlicerAddressResolver({
        fetchSlicer,
        policyBaseUrl: undefined
      })(sender)
    ).toBe(false)
  })

  it("preserves only forwarding-safe response metadata", async () => {
    const response = createSliceProxyResponse(
      new Response("upstream", {
        headers: {
          "content-type": "application/json",
          "x-upstream-secret": "hidden"
        },
        status: 429
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("content-type")).toBe("application/json")
    expect(response.headers.get("x-upstream-secret")).toBeNull()
    expect(await response.text()).toBe("upstream")
  })
})
