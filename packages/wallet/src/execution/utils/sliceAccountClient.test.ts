import { describe, expect, it } from "bun:test"
import type { WalletPolicyDescriptor } from "@slicekit/wallet-primitives"
import { sliceKernelPasskeyBackend } from "@slicekit/wallet-primitives/execution"
import type { Address, Hex } from "viem"
import { base } from "viem/chains"
import type { SliceAccountClientExecutionRequest } from "../../types/accountClient"
import {
  createKernelPasskeySliceAccountClient,
  SliceAccountClientExecutionError
} from "./sliceAccountClient"

const account = "0x0000000000000000000000000000000000000001" satisfies Address
const target = "0x0000000000000000000000000000000000000002" satisfies Address
const transactionHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" satisfies Hex
const userOperationHash =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" satisfies Hex
const call = {
  data: "0x1234",
  to: target,
  value: 1n
} satisfies { data: Hex; to: Address; value: bigint }
const policy = {
  account,
  calls: [
    {
      parameterRules: [],
      selector: "0x12345678",
      target,
      valueLimit: 1n
    }
  ],
  chainId: base.id,
  grantKind: "management",
  validAfter: 1,
  validUntil: 2_000_000_000,
  version: 1
} satisfies WalletPolicyDescriptor

describe("createKernelPasskeySliceAccountClient", () => {
  it("returns the execution id and transaction hash after execution succeeds", async () => {
    let capturedRequest: SliceAccountClientExecutionRequest | undefined
    const client = createKernelPasskeySliceAccountClient({
      account,
      transport: {
        submitCalls: async (request) => {
          capturedRequest = request
          return { executionId: userOperationHash }
        },
        waitForExecutionReceipt: async (request) => {
          expect(request).toEqual({ executionId: userOperationHash })
          return {
            success: true,
            transactionHash
          }
        }
      }
    })

    const result = await client.sendCalls({
      calls: [call],
      paymasterUrl: "https://shop.slice.so/api/paymaster"
    })

    expect(capturedRequest).toEqual({
      account,
      backend: sliceKernelPasskeyBackend,
      calls: [call],
      chainId: base.id,
      paymasterUrl: "https://shop.slice.so/api/paymaster"
    })
    expect(result).toEqual({
      executionId: userOperationHash,
      transactionHash
    })
  })

  it("throws when the EntryPoint receipt marks the user operation as failed", async () => {
    const client = createKernelPasskeySliceAccountClient({
      account,
      transport: {
        submitCalls: async () => ({ executionId: userOperationHash }),
        waitForExecutionReceipt: async () => ({
          revertReason: "Slice purchase reverted",
          success: false,
          transactionHash
        })
      }
    })

    const error = await client.sendCalls({ calls: [call] }).then(
      () => null,
      (caught: Error) => caught
    )
    expect(error).toBeInstanceOf(SliceAccountClientExecutionError)
    expect(error?.message).toBe(
      "Kernel passkey user operation failed: Slice purchase reverted"
    )
    expect((error as SliceAccountClientExecutionError).wasBroadcast).toBe(true)
  })

  it("rejects non-Base execution before submitting a user operation", async () => {
    let submitted = false
    const client = createKernelPasskeySliceAccountClient({
      account,
      transport: {
        submitCalls: async () => {
          submitted = true
          return { executionId: userOperationHash }
        },
        waitForExecutionReceipt: async () => ({
          success: true,
          transactionHash
        })
      }
    })

    await expect(
      client.sendCalls({ calls: [call], chainId: 1 })
    ).rejects.toThrow(
      "Kernel passkey Slice account client received a mismatched chain."
    )
    expect(submitted).toBe(false)
  })

  it("rejects calls outside the delegated policy before bundler submission", async () => {
    let submitted = false
    const client = createKernelPasskeySliceAccountClient({
      account,
      policy,
      transport: {
        submitCalls: async () => {
          submitted = true
          return { executionId: userOperationHash }
        },
        waitForExecutionReceipt: async () => ({
          success: true,
          transactionHash
        })
      }
    })

    const error = await client.sendCalls({ calls: [call] }).then(
      () => null,
      (caught: Error) => caught
    )

    expect(error).toBeInstanceOf(SliceAccountClientExecutionError)
    expect((error as SliceAccountClientExecutionError).fallbackReason).toBe(
      "outside-policy"
    )
    expect((error as SliceAccountClientExecutionError).wasBroadcast).toBe(false)
    expect(submitted).toBe(false)
  })

  it("treats transport submission failures as unsafe for a duplicate retry", async () => {
    const client = createKernelPasskeySliceAccountClient({
      account,
      transport: {
        submitCalls: async () => {
          throw new Error("bundler unavailable")
        },
        waitForExecutionReceipt: async () => ({
          success: true,
          transactionHash
        })
      }
    })

    const error = await client.sendCalls({ calls: [call] }).then(
      () => null,
      (caught: Error) => caught
    )
    expect(error).toBeInstanceOf(SliceAccountClientExecutionError)
    expect((error as SliceAccountClientExecutionError).wasBroadcast).toBe(true)
  })

  it("marks receipt failures as unsafe for a duplicate retry", async () => {
    const client = createKernelPasskeySliceAccountClient({
      account,
      transport: {
        submitCalls: async () => ({ executionId: userOperationHash }),
        waitForExecutionReceipt: async () => {
          throw new Error("receipt timed out")
        }
      }
    })

    const error = await client.sendCalls({ calls: [call] }).then(
      () => null,
      (caught: Error) => caught
    )
    expect(error).toBeInstanceOf(SliceAccountClientExecutionError)
    expect((error as SliceAccountClientExecutionError).wasBroadcast).toBe(true)
  })
})
