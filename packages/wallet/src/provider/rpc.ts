import { numberToHex } from "viem"
import type { SliceWalletProviderValue } from "../types"
import { SliceWalletProviderRpcError } from "./errors"

const forwardedRpcMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
  "eth_getLogs",
  "eth_getProof",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_newBlockFilter",
  "eth_newFilter",
  "eth_newPendingTransactionFilter",
  "eth_sendRawTransaction",
  "eth_syncing",
  "eth_uninstallFilter",
  "web3_clientVersion"
])

export const forwardSliceWalletRpc = async ({
  fetch,
  method,
  params,
  rpcUrl
}: {
  fetch: typeof globalThis.fetch
  method: string
  params: SliceWalletProviderValue | undefined
  rpcUrl: string
}) => {
  if (!forwardedRpcMethods.has(method)) return { handled: false as const }
  const response = await fetch(rpcUrl, {
    body: JSON.stringify(
      { id: 1, jsonrpc: "2.0", method, params: params ?? [] },
      (_key, value) => (typeof value === "bigint" ? numberToHex(value) : value)
    ),
    headers: { "content-type": "application/json" },
    method: "POST"
  })
  const payload = (await response.json()) as SliceWalletProviderValue
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new SliceWalletProviderRpcError(
      -32603,
      "RPC returned an invalid response."
    )
  }
  const responseRecord = payload as {
    readonly [key: string]: SliceWalletProviderValue | undefined
  }
  if (responseRecord.error !== undefined) {
    const error = responseRecord.error
    if (typeof error === "object" && error !== null && !Array.isArray(error)) {
      const errorRecord = error as {
        readonly [key: string]: SliceWalletProviderValue | undefined
      }
      throw new SliceWalletProviderRpcError(
        typeof errorRecord.code === "number" ? errorRecord.code : -32603,
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : "RPC request failed."
      )
    }
    throw new SliceWalletProviderRpcError(-32603, "RPC request failed.")
  }
  return { handled: true as const, result: responseRecord.result ?? null }
}
