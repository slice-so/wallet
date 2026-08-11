import { describe, expect, it, mock } from "bun:test"
import { loadSliceWalletAccountActivity } from "./accountActivity"
import type {
  SliceWalletAccountActivityBatchRequest,
  SliceWalletAccountActivityBatchResponse
} from "./types"

const addresses = Array.from(
  { length: 32 },
  (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}` as const
)

const respond = (
  requests: readonly SliceWalletAccountActivityBatchRequest[]
): readonly SliceWalletAccountActivityBatchResponse[] =>
  requests.map((request) => ({
    id: request.id,
    jsonrpc: "2.0",
    result: request.method === "eth_getCode" ? "0x" : "0x1"
  }))

describe("wallet account activity", () => {
  it("loads code and native balances for 32 accounts in one 64-entry batch", async () => {
    const batchFetch = mock(async (requests) => respond(requests))
    const activity = await loadSliceWalletAccountActivity(addresses, {
      batchFetch
    })

    expect(batchFetch).toHaveBeenCalledTimes(1)
    expect(batchFetch.mock.calls[0]?.[0]).toHaveLength(64)
    expect(activity).toHaveLength(32)
    expect(activity[0]).toMatchObject({
      code: { status: "available", value: null },
      nativeBalance: { status: "available", value: "1" },
      tokenBalances: {}
    })
  })

  it("chunks larger code and balance batches at 64 entries", async () => {
    const batchFetch = mock(async (requests) => respond(requests))
    await loadSliceWalletAccountActivity(
      [...addresses, "0x0000000000000000000000000000000000000033"],
      { batchFetch }
    )
    expect(batchFetch.mock.calls.map(([requests]) => requests.length)).toEqual([
      64, 2
    ])
  })

  it("marks failed fields unavailable instead of synthesizing zero values", async () => {
    const batchFetch = mock(
      async (requests: readonly SliceWalletAccountActivityBatchRequest[]) =>
        requests.map((request) => ({
          error: { code: -32_000, message: "upstream unavailable" },
          id: request.id,
          jsonrpc: "2.0" as const
        }))
    )
    const [activity] = await loadSliceWalletAccountActivity([addresses[0]], {
      batchFetch,
      tokens: [
        {
          address: "0x0000000000000000000000000000000000000042",
          symbol: "TEST"
        }
      ]
    })

    expect(activity).toMatchObject({
      code: { error: { code: -32_000 }, status: "unavailable" },
      nativeBalance: { status: "unavailable" },
      tokenBalances: { TEST: { status: "unavailable" } }
    })
  })
})
