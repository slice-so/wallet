import { describe, expect, it, mock } from "bun:test"
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  RpcRequestError
} from "viem"
import {
  entryPoint09Address,
  type GetPaymasterDataReturnType,
  type GetPaymasterStubDataReturnType,
  type UserOperation
} from "viem/account-abstraction"
import { anvil, base } from "viem/chains"
import {
  type SliceBundlerRetryReason,
  sliceBundlerRetryDataCode,
  sliceBundlerRetryRpcCode,
  sliceKernelPasskeyBackend
} from "../../protocol/execution"
import type { SliceWalletKernelAccount } from "../../types/account"
import type {
  SliceKernelPasskeyBundlerClient,
  SliceKernelPasskeyBundlerReceipt,
  SliceKernelPasskeyPaymasterClient,
  SliceKernelPasskeySendUserOperationParameters
} from "../../types/accountClient"
import { SliceAccountClientExecutionError } from "../utils/sliceAccountClient"
import { createSliceKernelPasskeyTransport } from "./transport"

const accountAddress =
  "0x0000000000000000000000000000000000000001" satisfies Address
const otherAddress =
  "0x0000000000000000000000000000000000000002" satisfies Address
const targetAddress =
  "0x0000000000000000000000000000000000000003" satisfies Address
const bundlerUrl = "https://shop.test/api/bundler"
const paymasterUrl = "https://shop.test/api/paymaster"
const userOperationHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" satisfies Hex
const replacementUserOperationHash =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" satisfies Hex
const transactionHash =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" satisfies Hex
const paymasterData = {
  paymasterAndData: "0x"
} satisfies GetPaymasterDataReturnType
const paymasterStubData = {
  paymasterAndData: "0x"
} satisfies GetPaymasterStubDataReturnType
const successfulBundlerReceipt = {
  receipt: { transactionHash },
  success: true
} satisfies SliceKernelPasskeyBundlerReceipt
const client = createPublicClient({
  chain: base,
  transport: http("https://base.test")
})
const account = {
  address: accountAddress
} as never as SliceWalletKernelAccount
const call = {
  data: "0x1234",
  to: targetAddress,
  value: 1n
} satisfies { data: Hex; to: Address; value: bigint }
const preparedUserOperation = {
  callData: "0x1234",
  callGasLimit: 100_000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  nonce: 0n,
  preVerificationGas: 50_000n,
  sender: accountAddress,
  signature: "0x",
  verificationGasLimit: 100_000n
} satisfies UserOperation<"0.9">
const signingAccount = {
  ...account,
  signUserOperation: mock(async () => "0x1234" as Hex)
} as SliceWalletKernelAccount

const createKernelUserOperationRequest = (
  accountOverride: Address = accountAddress
) => ({
  account: accountOverride,
  backend: sliceKernelPasskeyBackend,
  calls: [call],
  chainId: base.id
})

const createRetryRpcError = (reason: SliceBundlerRetryReason) =>
  new RpcRequestError({
    body: {
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendUserOperation",
      params: []
    },
    error: {
      code: sliceBundlerRetryRpcCode,
      data: {
        code: sliceBundlerRetryDataCode,
        provider: "alto-v2",
        reason,
        version: "1"
      },
      message: "Bundler rejected the user operation fee parameters."
    },
    url: bundlerUrl
  })

describe("createSliceKernelPasskeyTransport", () => {
  it("sends user operations through the configured bundler and paymaster", async () => {
    const paymaster = {
      getPaymasterData: mock(async () => paymasterData),
      getPaymasterStubData: mock(async () => paymasterStubData)
    } satisfies SliceKernelPasskeyPaymasterClient
    const sendUserOperation = mock(
      async (
        parameters: SliceKernelPasskeySendUserOperationParameters
      ): Promise<Hex> => {
        expect(parameters).toEqual({
          account,
          calls: [call],
          paymaster
        })
        return userOperationHash
      }
    )
    const bundlerClient = {
      sendUserOperation,
      waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
    } satisfies SliceKernelPasskeyBundlerClient
    const createBundlerClient = mock(() => bundlerClient)
    const createPaymasterClient = mock(() => paymaster)
    const transport = createSliceKernelPasskeyTransport({
      account,
      bundlerUrl,
      client,
      createBundlerClient,
      createPaymasterClient
    })

    const result = await transport.submitCalls({
      ...createKernelUserOperationRequest(),
      paymasterUrl
    })

    expect(result).toEqual({ executionId: userOperationHash })
    expect(createBundlerClient).toHaveBeenCalledWith({
      bundlerUrl,
      chain: base,
      client
    })
    expect(createPaymasterClient).toHaveBeenCalledWith({ paymasterUrl })
    expect(sendUserOperation).toHaveBeenCalledTimes(1)
  })

  it("uses an explicit request-scoped paymaster on non-Base chains", async () => {
    const paymaster = {
      getPaymasterData: mock(async () => paymasterData),
      getPaymasterStubData: mock(async () => paymasterStubData)
    } satisfies SliceKernelPasskeyPaymasterClient
    const sendUserOperation = mock(
      async (
        parameters: SliceKernelPasskeySendUserOperationParameters
      ): Promise<Hex> => {
        expect(parameters).toEqual({ account, calls: [call], paymaster })
        return userOperationHash
      }
    )
    const bundlerClient = {
      sendUserOperation,
      waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
    } satisfies SliceKernelPasskeyBundlerClient
    const createPaymasterClient = mock(() => paymaster)
    const transport = createSliceKernelPasskeyTransport({
      account,
      bundlerUrl,
      chain: anvil,
      client,
      createBundlerClient: () => bundlerClient,
      createPaymasterClient
    })

    const result = await transport.submitCalls({
      ...createKernelUserOperationRequest(),
      chainId: anvil.id,
      paymasterUrl
    })

    expect(result).toEqual({ executionId: userOperationHash })
    expect(createPaymasterClient).toHaveBeenCalledWith({ paymasterUrl })
  })

  it("maps EntryPoint receipt success, revert reason, and transaction hash", async () => {
    const bundlerClient = {
      sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
      waitForUserOperationReceipt: mock(
        async ({
          hash
        }: {
          hash: Hex
        }): Promise<SliceKernelPasskeyBundlerReceipt> => {
          expect(hash).toBe(userOperationHash)
          return {
            reason: "Slice purchase reverted",
            receipt: { transactionHash },
            success: false
          }
        }
      )
    } satisfies SliceKernelPasskeyBundlerClient
    const transport = createSliceKernelPasskeyTransport({
      account,
      bundlerUrl,
      client,
      createBundlerClient: () => bundlerClient
    })

    await expect(
      transport.waitForExecutionReceipt({ executionId: userOperationHash })
    ).resolves.toEqual({
      revertReason: "Slice purchase reverted",
      success: false,
      transactionHash
    })
  })

  it("marks preparation failures as definitely not broadcast", async () => {
    const sendPreparedUserOperation = mock(
      async (): Promise<Hex> => userOperationHash
    )
    const transport = createSliceKernelPasskeyTransport({
      account: signingAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation: mock(async () => {
          throw new Error("gas estimation rejected")
        }),
        sendPreparedUserOperation,
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    const error = await transport
      .submitCalls(createKernelUserOperationRequest())
      .then(
        () => null,
        (caught: Error) => caught
      )

    expect(error).toBeInstanceOf(SliceAccountClientExecutionError)
    expect((error as SliceAccountClientExecutionError).wasBroadcast).toBe(false)
    expect(sendPreparedUserOperation).not.toHaveBeenCalled()
  })

  it("drops orphan paymaster estimates from self-funded operations", async () => {
    const selfFundedEstimate = {
      ...preparedUserOperation,
      paymasterData: "0x",
      paymasterPostOpGasLimit: 0n,
      paymasterVerificationGasLimit: 0n
    } satisfies UserOperation<"0.9">
    const signUserOperation = mock(async () => "0x1234" as Hex)
    const sendPreparedUserOperation = mock(
      async (): Promise<Hex> => userOperationHash
    )
    const transport = createSliceKernelPasskeyTransport({
      account: {
        ...account,
        signUserOperation
      } as SliceWalletKernelAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation: mock(async () => selfFundedEstimate),
        sendPreparedUserOperation,
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    await expect(
      transport.submitCalls(createKernelUserOperationRequest())
    ).resolves.toEqual({ executionId: userOperationHash })

    expect(signUserOperation).toHaveBeenCalledWith(preparedUserOperation)
    expect(sendPreparedUserOperation).toHaveBeenCalledWith({
      ...preparedUserOperation,
      signature: "0x1234"
    })
  })

  it("marks an explicit bundler RPC rejection as definitely not broadcast", async () => {
    const rpcError = new RpcRequestError({
      body: {
        id: 1,
        jsonrpc: "2.0",
        method: "eth_sendUserOperation",
        params: []
      },
      error: { code: -32500, message: "AA24 signature error" },
      url: bundlerUrl
    })
    const transport = createSliceKernelPasskeyTransport({
      account: signingAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation: mock(async () => preparedUserOperation),
        sendPreparedUserOperation: mock(async (): Promise<Hex> => {
          throw rpcError
        }),
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    const error = await transport
      .submitCalls(createKernelUserOperationRequest())
      .then(
        () => null,
        (caught: Error) => caught
      )

    expect(error).toBeInstanceOf(SliceAccountClientExecutionError)
    expect((error as SliceAccountClientExecutionError).wasBroadcast).toBe(false)
  })

  it("reprices exactly once after an explicit fee-floor rejection", async () => {
    const repricedUserOperation = {
      ...preparedUserOperation,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 2n,
      paymasterData: "0x1234"
    } satisfies UserOperation<"0.9">
    const prepareUserOperation = mock(
      async (
        parameters: Parameters<
          NonNullable<SliceKernelPasskeyBundlerClient["prepareUserOperation"]>
        >[0]
      ) =>
        parameters.calls === undefined
          ? repricedUserOperation
          : preparedUserOperation
    )
    const sendPreparedUserOperation = mock(
      async (operation: UserOperation<"0.9">): Promise<Hex> => {
        if (operation.maxFeePerGas === 1n) {
          throw createRetryRpcError("fee_floor")
        }
        return replacementUserOperationHash
      }
    )
    const transport = createSliceKernelPasskeyTransport({
      account: signingAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation,
        sendPreparedUserOperation,
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    await expect(
      transport.submitCalls(createKernelUserOperationRequest())
    ).resolves.toEqual({ executionId: replacementUserOperationHash })
    expect(prepareUserOperation).toHaveBeenCalledTimes(2)
    expect(prepareUserOperation.mock.calls[1]?.[0]).toMatchObject({
      callData: preparedUserOperation.callData,
      nonce: preparedUserOperation.nonce,
      parameters: ["fees", "gas", "paymaster", "signature"]
    })
    expect(sendPreparedUserOperation).toHaveBeenCalledTimes(2)
  })

  it("freezes canonical paymaster context across preparation and repricing", async () => {
    const context = {
      policy: { tier: "checkout", version: 1 },
      projectId: "slice"
    }
    const stubContexts: string[] = []
    const dataContexts: string[] = []
    const getPaymasterStubData = mock(
      async (
        parameters: Parameters<
          SliceKernelPasskeyPaymasterClient["getPaymasterStubData"]
        >[0]
      ) => {
        stubContexts.push(JSON.stringify(parameters.context))
        return paymasterStubData
      }
    )
    const getPaymasterData = mock(
      async (
        parameters: Parameters<
          SliceKernelPasskeyPaymasterClient["getPaymasterData"]
        >[0]
      ) => {
        dataContexts.push(JSON.stringify(parameters.context))
        return paymasterData
      }
    )
    const prepareUserOperation = mock(
      async (
        parameters: Parameters<
          NonNullable<SliceKernelPasskeyBundlerClient["prepareUserOperation"]>
        >[0]
      ) => {
        const paymasterParameters = {
          ...preparedUserOperation,
          chainId: base.id,
          context: parameters.paymasterContext,
          entryPointAddress: entryPoint09Address
        }
        await parameters.paymaster?.getPaymasterStubData(paymasterParameters)
        await parameters.paymaster?.getPaymasterData(paymasterParameters)
        return parameters.calls === undefined
          ? { ...preparedUserOperation, maxFeePerGas: 2n }
          : preparedUserOperation
      }
    )
    let sendCount = 0
    const transport = createSliceKernelPasskeyTransport({
      account: signingAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation,
        sendPreparedUserOperation: mock(async (): Promise<Hex> => {
          sendCount += 1
          if (sendCount === 1) {
            context.projectId = "mutated"
            throw createRetryRpcError("fee_floor")
          }
          return replacementUserOperationHash
        }),
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      }),
      createPaymasterClient: () => ({
        getPaymasterData,
        getPaymasterStubData
      })
    })

    await expect(
      transport.submitCalls({
        ...createKernelUserOperationRequest(),
        paymasterContext: context,
        paymasterUrl
      })
    ).resolves.toEqual({ executionId: replacementUserOperationHash })
    expect(stubContexts).toEqual([
      '{"policy":{"tier":"checkout","version":1},"projectId":"slice"}',
      '{"policy":{"tier":"checkout","version":1},"projectId":"slice"}'
    ])
    expect(dataContexts).toEqual(stubContexts)
    expect(getPaymasterStubData).toHaveBeenCalledTimes(2)
    expect(getPaymasterData).toHaveBeenCalledTimes(2)
  })

  it("does not retry an untracked replacement or malformed retry marker", async () => {
    for (const rpcError of [
      createRetryRpcError("replacement_underpriced"),
      new RpcRequestError({
        body: { id: 1, jsonrpc: "2.0", method: "eth_sendUserOperation" },
        error: {
          code: sliceBundlerRetryRpcCode,
          data: {
            code: sliceBundlerRetryDataCode,
            provider: "alto-v2",
            reason: "fee_floor-near-match",
            version: "1"
          },
          message: "Bundler rejected the user operation fee parameters."
        },
        url: bundlerUrl
      })
    ]) {
      const prepareUserOperation = mock(async () => preparedUserOperation)
      const sendPreparedUserOperation = mock(async () => {
        throw rpcError
      })
      const transport = createSliceKernelPasskeyTransport({
        account: signingAccount,
        bundlerUrl,
        client,
        createBundlerClient: () => ({
          prepareUserOperation,
          sendPreparedUserOperation,
          sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
          waitForUserOperationReceipt: mock(
            async () => successfulBundlerReceipt
          )
        })
      })

      await expect(
        transport.submitCalls(createKernelUserOperationRequest())
      ).rejects.toBeInstanceOf(SliceAccountClientExecutionError)
      expect(prepareUserOperation).toHaveBeenCalledTimes(1)
      expect(sendPreparedUserOperation).toHaveBeenCalledTimes(1)
    }
  })

  it("rejects a repriced operation that changes proposal-bound fields", async () => {
    const changedUserOperation = {
      ...preparedUserOperation,
      callData: "0xabcd",
      maxFeePerGas: 2n
    } satisfies UserOperation<"0.9">
    const prepareUserOperation = mock(
      async (
        parameters: Parameters<
          NonNullable<SliceKernelPasskeyBundlerClient["prepareUserOperation"]>
        >[0]
      ) =>
        parameters.calls === undefined
          ? changedUserOperation
          : preparedUserOperation
    )
    const sendPreparedUserOperation = mock(async () => {
      throw createRetryRpcError("fee_floor")
    })
    const transport = createSliceKernelPasskeyTransport({
      account: signingAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation,
        sendPreparedUserOperation,
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    await expect(
      transport.submitCalls(createKernelUserOperationRequest())
    ).rejects.toThrow("Repriced user operation changed proposal-bound fields.")
    expect(sendPreparedUserOperation).toHaveBeenCalledTimes(1)
  })

  it("retries a tracked same-proposal replacement and watches both hashes", async () => {
    const repricedUserOperation = {
      ...preparedUserOperation,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 2n
    } satisfies UserOperation<"0.9">
    const prepareUserOperation = mock(
      async (
        parameters: Parameters<
          NonNullable<SliceKernelPasskeyBundlerClient["prepareUserOperation"]>
        >[0]
      ) =>
        parameters.calls === undefined
          ? repricedUserOperation
          : preparedUserOperation
    )
    let sendCount = 0
    const sendPreparedUserOperation = mock(async (): Promise<Hex> => {
      sendCount += 1
      if (sendCount === 1) return userOperationHash
      if (sendCount === 2) {
        throw createRetryRpcError("replacement_underpriced")
      }
      return replacementUserOperationHash
    })
    const receiptHashes: Hex[] = []
    const transport = createSliceKernelPasskeyTransport({
      account: signingAccount,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        prepareUserOperation,
        sendPreparedUserOperation,
        sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
        waitForUserOperationReceipt: mock(async ({ hash }) => {
          receiptHashes.push(hash)
          if (hash === userOperationHash) throw new Error("not included")
          return successfulBundlerReceipt
        })
      })
    })

    await transport.submitCalls(createKernelUserOperationRequest())
    const replacement = await transport.submitCalls(
      createKernelUserOperationRequest()
    )
    await expect(
      transport.waitForExecutionReceipt(replacement)
    ).resolves.toMatchObject({ success: true })
    expect(sendPreparedUserOperation).toHaveBeenCalledTimes(3)
    expect(receiptHashes).toEqual([
      userOperationHash,
      replacementUserOperationHash
    ])
  })

  it("emits optional user operation lifecycle events", async () => {
    const onUserOperationEvent = mock(() => {})
    const bundlerClient = {
      sendUserOperation: mock(async (): Promise<Hex> => userOperationHash),
      waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
    } satisfies SliceKernelPasskeyBundlerClient
    const transport = createSliceKernelPasskeyTransport({
      account,
      bundlerUrl,
      client,
      createBundlerClient: () => bundlerClient,
      onUserOperationEvent
    })

    await transport.submitCalls(createKernelUserOperationRequest())
    await transport.waitForExecutionReceipt({ executionId: userOperationHash })

    expect(onUserOperationEvent).toHaveBeenCalledWith({
      account: accountAddress,
      type: "userOperationSubmitted",
      userOperationHash
    })
    expect(onUserOperationEvent).toHaveBeenCalledWith({
      account: accountAddress,
      success: true,
      transactionHash,
      type: "userOperationReceipt",
      userOperationHash
    })
  })

  it("rejects requests for another account before submitting", async () => {
    const sendUserOperation = mock(async (): Promise<Hex> => userOperationHash)
    const transport = createSliceKernelPasskeyTransport({
      account,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        sendUserOperation,
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    await expect(
      transport.submitCalls(createKernelUserOperationRequest(otherAddress))
    ).rejects.toThrow("Kernel passkey transport received a mismatched account.")
    expect(sendUserOperation).not.toHaveBeenCalled()
  })

  it("rejects requests for another chain before submitting", async () => {
    const sendUserOperation = mock(async (): Promise<Hex> => userOperationHash)
    const transport = createSliceKernelPasskeyTransport({
      account,
      bundlerUrl,
      client,
      createBundlerClient: () => ({
        sendUserOperation,
        waitForUserOperationReceipt: mock(async () => successfulBundlerReceipt)
      })
    })

    await expect(
      transport.submitCalls({
        ...createKernelUserOperationRequest(),
        chainId: 1
      })
    ).rejects.toThrow("Kernel passkey transport received a mismatched chain.")
    expect(sendUserOperation).not.toHaveBeenCalled()
  })
})
