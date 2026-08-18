import type { WalletCall } from "@slicekit/wallet-primitives"
import { type Address, bytesToHex, type Hex, numberToHex } from "viem"
import type {
  SliceWalletRequestPaymasterService,
  StoredWalletCall
} from "../types/providerInternal"
import { SliceWalletProviderRpcError } from "./errors"
import {
  readStoredSliceWalletCall,
  writeStoredSliceWalletCall
} from "./storage"

type UserOperationReceipt = {
  actualGasUsed: bigint
  logs: readonly {
    address: Address
    data: Hex
    topics: readonly Hex[]
  }[]
  receipt: {
    blockHash: Hex
    blockNumber: bigint
    transactionHash: Hex
  }
  success: boolean
}

export const createSliceWalletCallTracker = ({
  chainId,
  crypto,
  getUserOperationReceipt,
  sendUserOperation,
  storage
}: {
  chainId: number
  crypto: Crypto
  getUserOperationReceipt: (hash: Hex) => Promise<UserOperationReceipt>
  sendUserOperation: (
    calls: readonly WalletCall[],
    paymasterService?: SliceWalletRequestPaymasterService
  ) => Promise<Hex>
  storage: Storage | null
}) => {
  const memoryCalls = new Map<string, StoredWalletCall>()
  const reservedCallIds = new Set<string>()

  const reserveCallId = (requested?: string) => {
    let id = requested
    if (id === undefined) {
      do {
        const bytes = new Uint8Array(32)
        crypto.getRandomValues(bytes)
        id = bytesToHex(bytes)
      } while (
        reservedCallIds.has(id) ||
        memoryCalls.has(id) ||
        readStoredSliceWalletCall(storage, id) !== null
      )
    }
    if (
      reservedCallIds.has(id) ||
      memoryCalls.has(id) ||
      readStoredSliceWalletCall(storage, id) !== null
    ) {
      throw new SliceWalletProviderRpcError(
        5720,
        "Call id has already been used."
      )
    }
    reservedCallIds.add(id)
    return id
  }

  return {
    hasCall: (id: string) => memoryCalls.has(id),
    getCallsStatus: async (id: string) => {
      const call = memoryCalls.get(id) ?? readStoredSliceWalletCall(storage, id)
      if (call === null || call === undefined) {
        throw new SliceWalletProviderRpcError(5730, "Unknown wallet call id.")
      }
      try {
        const operation = await getUserOperationReceipt(call.userOperationHash)
        return {
          atomic: true,
          chainId: numberToHex(call.chainId),
          id,
          receipts: [
            {
              blockHash: operation.receipt.blockHash,
              blockNumber: numberToHex(operation.receipt.blockNumber),
              gasUsed: numberToHex(operation.actualGasUsed),
              logs: operation.logs.map((log) => ({
                address: log.address,
                data: log.data,
                topics: [...log.topics]
              })),
              status: operation.success ? "0x1" : "0x0",
              transactionHash: operation.receipt.transactionHash
            }
          ],
          status: operation.success ? 200 : 500,
          version: "2.0.0"
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "UserOperationReceiptNotFoundError"
        ) {
          return {
            atomic: true,
            chainId: numberToHex(call.chainId),
            id,
            status: 100,
            version: "2.0.0"
          }
        }
        throw error
      }
    },
    sendCalls: async (
      calls: readonly WalletCall[],
      requestedId?: string,
      paymasterService?: SliceWalletRequestPaymasterService
    ) => {
      const id = reserveCallId(requestedId)
      try {
        const userOperationHash = await sendUserOperation(
          calls,
          paymasterService
        )
        const stored = {
          chainId,
          createdAt: Date.now(),
          id,
          userOperationHash
        }
        memoryCalls.set(id, stored)
        writeStoredSliceWalletCall(storage, stored)
        return { id, userOperationHash }
      } finally {
        reservedCallIds.delete(id)
      }
    }
  }
}
