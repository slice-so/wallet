import {
  sliceKernelBaseV33Config,
  sliceKernelPasskeyBackend
} from "@slicekit/wallet-primitives/execution"
import { assertWalletCallsMatchPolicy } from "@slicekit/wallet-primitives/policy"
import type { WalletPolicyDescriptor } from "@slicekit/wallet-primitives/server"
import type { Address, Hex } from "viem"
import type {
  SliceAccountClient,
  SliceAccountClientTransport
} from "../../types/accountClient"

export class SliceAccountClientExecutionError extends Error {
  readonly fallbackReason: "outside-policy" | null
  readonly wasBroadcast: boolean

  constructor(
    message: string,
    {
      cause,
      fallbackReason,
      wasBroadcast
    }: {
      cause?: Error
      fallbackReason?: "outside-policy"
      wasBroadcast: boolean
    }
  ) {
    super(message, cause ? { cause } : undefined)
    this.name = "SliceAccountClientExecutionError"
    this.fallbackReason = fallbackReason ?? null
    this.wasBroadcast = wasBroadcast
  }
}

export const createKernelPasskeySliceAccountClient = ({
  account,
  chainId: clientChainId = sliceKernelBaseV33Config.chainId,
  policy,
  transport
}: {
  account: Address
  /**
   * Chain the Kernel account operates on. Defaults to Base; the staging fork
   * runs the same pinned contracts under a different chain id.
   */
  chainId?: number
  policy?: WalletPolicyDescriptor
  transport: SliceAccountClientTransport
}): SliceAccountClient => ({
  account,
  backend: sliceKernelPasskeyBackend,
  chainId: clientChainId,
  sendCalls: async ({ calls, chainId, paymasterContext, paymasterUrl }) => {
    const requestChainId = chainId ?? clientChainId
    if (requestChainId !== clientChainId) {
      throw new SliceAccountClientExecutionError(
        "Kernel passkey Slice account client received a mismatched chain.",
        { wasBroadcast: false }
      )
    }

    if (policy !== undefined) {
      try {
        assertWalletCallsMatchPolicy(calls, policy)
      } catch (error) {
        throw new SliceAccountClientExecutionError(
          error instanceof Error
            ? error.message
            : "Wallet calls are outside the delegated policy.",
          {
            ...(error instanceof Error ? { cause: error } : {}),
            fallbackReason: "outside-policy",
            wasBroadcast: false
          }
        )
      }
    }

    let executionId: Hex
    try {
      const submission = await transport.submitCalls({
        account,
        backend: sliceKernelPasskeyBackend,
        calls,
        chainId: requestChainId,
        ...(paymasterContext === undefined ? {} : { paymasterContext }),
        ...(paymasterUrl !== undefined ? { paymasterUrl } : {})
      })
      executionId = submission.executionId
    } catch (error) {
      if (error instanceof SliceAccountClientExecutionError) throw error
      throw new SliceAccountClientExecutionError(
        error instanceof Error
          ? error.message
          : "Kernel passkey user operation submission is unknown.",
        {
          ...(error instanceof Error ? { cause: error } : {}),
          // A transport failure can happen after the bundler accepted the
          // request but before its hash reached the client. Never duplicate
          // the operation automatically when submission outcome is unknown.
          wasBroadcast: true
        }
      )
    }

    let receipt: Awaited<ReturnType<typeof transport.waitForExecutionReceipt>>
    try {
      receipt = await transport.waitForExecutionReceipt({ executionId })
    } catch (error) {
      throw new SliceAccountClientExecutionError(
        error instanceof Error
          ? error.message
          : "Kernel passkey user operation receipt is unavailable.",
        {
          ...(error instanceof Error ? { cause: error } : {}),
          wasBroadcast: true
        }
      )
    }
    if (!receipt.success) {
      const reason = receipt.revertReason ? `: ${receipt.revertReason}` : ""
      throw new SliceAccountClientExecutionError(
        `Kernel passkey user operation failed${reason}`,
        { wasBroadcast: true }
      )
    }

    return {
      executionId,
      transactionHash: receipt.transactionHash
    }
  }
})
