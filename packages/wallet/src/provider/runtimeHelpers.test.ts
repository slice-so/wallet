import { describe, expect, it } from "bun:test"
import type { Address, Hex } from "viem"
import { createSliceWalletCallTracker } from "./callTracker"
import { SliceWalletProviderRpcError } from "./errors"
import { forwardSliceWalletRpc } from "./rpc"

const hash = `0x${"11".repeat(32)}` as Hex
const blockHash = `0x${"22".repeat(32)}` as Hex
const transactionHash = `0x${"33".repeat(32)}` as Hex
const account = "0x1000000000000000000000000000000000000001" as Address
const mockFetch = (response: () => Response): typeof fetch =>
  Object.assign(async () => response(), { preconnect: fetch.preconnect })

describe("portable provider runtime helpers", () => {
  it("preserves a valid null RPC result without treating the method as unsupported", async () => {
    const forwarded = await forwardSliceWalletRpc({
      fetch: mockFetch(() =>
        Response.json({ id: 1, jsonrpc: "2.0", result: null })
      ),
      method: "eth_getTransactionReceipt",
      params: [hash],
      rpcUrl: "https://rpc.example"
    })
    expect(forwarded).toEqual({ handled: true, result: null })
    await expect(
      forwardSliceWalletRpc({
        fetch: mockFetch(() => Response.json({ result: null })),
        method: "wallet_notSupported",
        params: undefined,
        rpcUrl: "https://rpc.example"
      })
    ).resolves.toEqual({ handled: false })
  })

  it("maps UserOperation success rather than the outer transaction status", async () => {
    const tracker = createSliceWalletCallTracker({
      chainId: 8453,
      crypto,
      getUserOperationReceipt: async () => ({
        actualGasUsed: 10n,
        logs: [{ address: account, data: "0x", topics: [] }],
        receipt: { blockHash, blockNumber: 2n, transactionHash },
        success: false
      }),
      sendUserOperation: async () => hash,
      storage: null
    })
    await tracker.sendCalls([{ data: "0x", to: account, value: 0n }], "call-1")
    await expect(tracker.getCallsStatus("call-1")).resolves.toMatchObject({
      receipts: [{ status: "0x0", transactionHash }],
      status: 500
    })
    try {
      await tracker.sendCalls([], "call-1")
      throw new Error("Expected duplicate call id rejection.")
    } catch (error) {
      expect(error).toBeInstanceOf(SliceWalletProviderRpcError)
      expect((error as SliceWalletProviderRpcError).code).toBe(5720)
    }
  })

  it("returns a finalized EIP-5792 receipt for a successful UserOperation", async () => {
    const tracker = createSliceWalletCallTracker({
      chainId: 8453,
      crypto,
      getUserOperationReceipt: async () => ({
        actualGasUsed: 10n,
        logs: [{ address: account, data: "0x", topics: [hash] }],
        receipt: { blockHash, blockNumber: 2n, transactionHash },
        success: true
      }),
      sendUserOperation: async () => hash,
      storage: null
    })
    await tracker.sendCalls([{ data: "0x", to: account, value: 0n }], "call-2")

    await expect(tracker.getCallsStatus("call-2")).resolves.toEqual({
      atomic: true,
      chainId: "0x2105",
      id: "call-2",
      receipts: [
        {
          blockHash,
          blockNumber: "0x2",
          gasUsed: "0xa",
          logs: [{ address: account, data: "0x", topics: [hash] }],
          status: "0x1",
          transactionHash
        }
      ],
      status: 200,
      version: "2.0.0"
    })
  })

  it("reports an unmined UserOperation as pending", async () => {
    const tracker = createSliceWalletCallTracker({
      chainId: 8453,
      crypto,
      getUserOperationReceipt: async () => {
        const error = new Error("not found")
        error.name = "UserOperationReceiptNotFoundError"
        throw error
      },
      sendUserOperation: async () => hash,
      storage: null
    })
    await tracker.sendCalls([], "pending-call")
    await expect(tracker.getCallsStatus("pending-call")).resolves.toMatchObject(
      {
        status: 100
      }
    )
  })

  it("returns the final-spec unknown-bundle error for an untracked id", async () => {
    const tracker = createSliceWalletCallTracker({
      chainId: 8453,
      crypto,
      getUserOperationReceipt: async () => {
        throw new Error("Unexpected receipt lookup.")
      },
      sendUserOperation: async () => hash,
      storage: null
    })

    try {
      await tracker.getCallsStatus("missing-call")
      throw new Error("Expected unknown wallet call rejection.")
    } catch (error) {
      expect(error).toBeInstanceOf(SliceWalletProviderRpcError)
      expect((error as SliceWalletProviderRpcError).code).toBe(5730)
    }
  })
})
