import {
  type Address,
  BaseError,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  parseAbiParameters,
  RpcRequestError,
  zeroAddress
} from "viem"
import {
  createBundlerClient,
  createPaymasterClient,
  formatUserOperationRequest,
  type PrepareUserOperationParameterType,
  type SmartAccount,
  type UserOperation
} from "viem/account-abstraction"
import { base } from "viem/chains"
import {
  type SliceBundlerRetryReason,
  sliceBundlerRetryDataCode,
  sliceBundlerRetryRpcCode,
  sliceKernelPasskeyBackend
} from "../../protocol/execution"
import { sliceKernelConfig } from "../../protocol/index"
import type {
  CreateSliceKernelPasskeyBundlerClient,
  CreateSliceKernelPasskeyPaymasterClient,
  CreateSliceKernelPasskeyTransportParameters,
  SliceAccountClientCall,
  SliceAccountClientExecutionRequest,
  SliceAccountClientPaymasterContext,
  SliceAccountClientTransport,
  SliceKernelPasskeyPaymasterClient
} from "../../types/accountClient"
import { SliceAccountClientExecutionError } from "../utils/sliceAccountClient"

type SliceKernelPasskeyPrepareUserOperationParameters = {
  account: SmartAccount
  paymaster?: SliceKernelPasskeyPaymasterClient
  paymasterContext?: SliceAccountClientPaymasterContext
  parameters?: readonly PrepareUserOperationParameterType[]
} & (
  | {
      callData: Hex
      calls?: never
      factory?: Address
      factoryData?: Hex
      nonce: bigint
    }
  | { callData?: never; calls: readonly SliceAccountClientCall[] }
)

const normalizePreparedUserOperation = (
  userOperation: UserOperation<"0.9">
): UserOperation<"0.9"> => {
  if (userOperation.paymaster !== undefined) return userOperation

  // Some bundlers return zero paymaster gas estimates for self-funded
  // operations. They are not part of the operation without a paymaster and
  // must not cross the signing or submission boundary as orphan fields.
  const {
    paymasterData: _paymasterData,
    paymasterPostOpGasLimit: _paymasterPostOpGasLimit,
    paymasterVerificationGasLimit: _paymasterVerificationGasLimit,
    ...selfFundedUserOperation
  } = userOperation
  return selfFundedUserOperation
}

const normalizeAddress = (address: string) => address.toLowerCase()

const createDefaultSliceKernelPasskeyBundlerClient: CreateSliceKernelPasskeyBundlerClient =
  ({ bundlerUrl, chain, client }) => {
    const bundlerClient = createBundlerClient({
      chain,
      client,
      transport: http(bundlerUrl)
    })

    return {
      prepareUserOperation: (parameters) => {
        const { account, paymaster, paymasterContext } = parameters
        if (parameters.calls !== undefined) {
          return bundlerClient.prepareUserOperation({
            account,
            calls: parameters.calls,
            ...(paymaster === undefined ? {} : { paymaster }),
            ...(paymasterContext === undefined ? {} : { paymasterContext })
          }) as Promise<UserOperation<"0.9">>
        }
        return bundlerClient.prepareUserOperation({
          account,
          callData: parameters.callData,
          ...(parameters.factory === undefined
            ? {}
            : { factory: parameters.factory }),
          ...(parameters.factoryData === undefined
            ? {}
            : { factoryData: parameters.factoryData }),
          nonce: parameters.nonce,
          ...(parameters.parameters === undefined
            ? {}
            : { parameters: parameters.parameters }),
          ...(paymaster === undefined ? {} : { paymaster }),
          ...(paymasterContext === undefined ? {} : { paymasterContext })
        }) as Promise<UserOperation<"0.9">>
      },
      sendPreparedUserOperation: (userOperation) =>
        bundlerClient.request(
          {
            method: "eth_sendUserOperation",
            params: [
              formatUserOperationRequest(userOperation),
              sliceKernelConfig.entryPoint
            ]
          },
          { retryCount: 0 }
        ),
      sendUserOperation: async ({
        account,
        calls,
        paymaster,
        paymasterContext
      }) =>
        bundlerClient.sendUserOperation({
          account,
          calls,
          ...(paymaster !== undefined ? { paymaster } : {}),
          ...(paymasterContext === undefined ? {} : { paymasterContext })
        }),
      waitForUserOperationReceipt: ({ hash }) =>
        bundlerClient.waitForUserOperationReceipt({ hash })
    }
  }

const createDefaultSliceKernelPasskeyPaymasterClient: CreateSliceKernelPasskeyPaymasterClient =
  ({ paymasterUrl }) => {
    const paymasterClient = createPaymasterClient({
      transport: http(paymasterUrl)
    })

    return {
      getPaymasterData: (parameters) =>
        paymasterClient.getPaymasterData(parameters),
      getPaymasterStubData: (parameters) =>
        paymasterClient.getPaymasterStubData(parameters)
    }
  }

const assertSliceKernelExecutionRequest = ({
  account,
  chainId,
  request
}: {
  account: SmartAccount
  chainId: number
  request: SliceAccountClientExecutionRequest
}) => {
  if (request.backend !== sliceKernelPasskeyBackend) {
    throw new SliceAccountClientExecutionError(
      "Kernel passkey transport received an unsupported backend.",
      { wasBroadcast: false }
    )
  }
  if (normalizeAddress(request.account) !== normalizeAddress(account.address)) {
    throw new SliceAccountClientExecutionError(
      "Kernel passkey transport received a mismatched account.",
      { wasBroadcast: false }
    )
  }
  if (request.chainId !== chainId) {
    throw new SliceAccountClientExecutionError(
      "Kernel passkey transport received a mismatched chain.",
      { wasBroadcast: false }
    )
  }
}

const isExplicitBundlerRpcRejection = (error: Error) =>
  error instanceof BaseError &&
  error.walk((cause) => cause instanceof RpcRequestError) !== null

const getSliceBundlerRetryReason = (
  error: Error
): SliceBundlerRetryReason | null => {
  if (!(error instanceof BaseError)) return null
  const rpcError = error.walk(
    (cause) => cause instanceof RpcRequestError
  ) as RpcRequestError | null
  if (rpcError === null || rpcError.code !== sliceBundlerRetryRpcCode) {
    return null
  }
  const data = rpcError.data
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null
  }
  if (
    !("code" in data) ||
    data.code !== sliceBundlerRetryDataCode ||
    !("provider" in data) ||
    data.provider !== "alto-v2" ||
    !("version" in data) ||
    data.version !== "1" ||
    !("reason" in data)
  ) {
    return null
  }
  return data.reason === "fee_floor" ||
    data.reason === "replacement_underpriced"
    ? data.reason
    : null
}

const canonicalizePaymasterContext = (
  value: SliceAccountClientPaymasterContext
): { canonicalHash: Hex; value: SliceAccountClientPaymasterContext } => {
  const visit = (
    input: SliceAccountClientPaymasterContext
  ): SliceAccountClientPaymasterContext => {
    if (typeof input === "number" && !Number.isFinite(input)) {
      throw new Error("Paymaster context contains a non-finite number.")
    }
    if (Array.isArray(input)) return Object.freeze(input.map(visit))
    if (typeof input !== "object" || input === null) return input
    return Object.freeze(
      Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, visit(item)])
      )
    )
  }
  const canonical = visit(value)
  return {
    canonicalHash: keccak256(
      new TextEncoder().encode(JSON.stringify(canonical))
    ),
    value: canonical
  }
}

const getUserOperationProposalKey = ({
  paymasterContextHash,
  paymasterUrl,
  userOperation
}: {
  paymasterContextHash?: Hex
  paymasterUrl?: string
  userOperation: UserOperation<"0.9">
}) =>
  keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address sender, uint256 nonce, bytes callData, address factory, bytes factoryData, string paymasterUrl, bytes32 paymasterContextHash"
      ),
      [
        userOperation.sender,
        userOperation.nonce,
        userOperation.callData,
        userOperation.factory ?? zeroAddress,
        userOperation.factoryData ?? "0x",
        paymasterUrl ?? "",
        paymasterContextHash ?? keccak256("0x")
      ]
    )
  )

const assertRetryPreservesProposal = ({
  original,
  retried
}: {
  original: UserOperation<"0.9">
  retried: UserOperation<"0.9">
}) => {
  if (
    original.sender.toLowerCase() !== retried.sender.toLowerCase() ||
    original.nonce !== retried.nonce ||
    original.callData.toLowerCase() !== retried.callData.toLowerCase() ||
    (original.factory ?? zeroAddress).toLowerCase() !==
      (retried.factory ?? zeroAddress).toLowerCase() ||
    (original.factoryData ?? "0x").toLowerCase() !==
      (retried.factoryData ?? "0x").toLowerCase()
  ) {
    throw new Error("Repriced user operation changed proposal-bound fields.")
  }
}

const toPreBroadcastExecutionError = (error: Error) =>
  new SliceAccountClientExecutionError(error.message, {
    cause: error,
    wasBroadcast: false
  })

export const createSliceKernelPasskeyTransport = ({
  account,
  bundlerUrl,
  chain = base,
  client,
  createBundlerClient = createDefaultSliceKernelPasskeyBundlerClient,
  createPaymasterClient = createDefaultSliceKernelPasskeyPaymasterClient,
  onUserOperationEvent
}: CreateSliceKernelPasskeyTransportParameters): SliceAccountClientTransport => {
  const bundlerClient = createBundlerClient({ bundlerUrl, chain, client })
  const acceptedHashesByProposal = new Map<Hex, readonly Hex[]>()
  const receiptCandidatesByHash = new Map<Hex, readonly Hex[]>()

  const trackAcceptedHashes = (proposalKey: Hex, hashes: readonly Hex[]) => {
    const uniqueHashes = [...new Set(hashes)]
    acceptedHashesByProposal.set(proposalKey, uniqueHashes)
    for (const hash of uniqueHashes) {
      receiptCandidatesByHash.set(hash, uniqueHashes)
    }
  }

  const prepareAndSign = async (
    parameters: SliceKernelPasskeyPrepareUserOperationParameters
  ) => {
    if (!bundlerClient.prepareUserOperation) {
      throw new Error("Bundler client cannot prepare user operations.")
    }
    const prepared = normalizePreparedUserOperation(
      await bundlerClient.prepareUserOperation(parameters)
    )
    return {
      ...prepared,
      signature: await account.signUserOperation(prepared)
    }
  }

  return {
    submitCalls: async (request) => {
      assertSliceKernelExecutionRequest({
        account,
        chainId: chain.id,
        request
      })

      // Slice-controlled sponsorship is selected by the caller's chain
      // configuration. An explicit request-scoped ERC-7677 service remains
      // usable on every provisioned chain.
      const paymasterUrl = request.paymasterUrl
      const paymaster =
        paymasterUrl === undefined
          ? undefined
          : createPaymasterClient({ paymasterUrl })
      const paymasterContext =
        request.paymasterContext === undefined
          ? undefined
          : canonicalizePaymasterContext(request.paymasterContext)
      let userOperationHash: Hex
      if (
        bundlerClient.prepareUserOperation &&
        bundlerClient.sendPreparedUserOperation
      ) {
        let userOperation: UserOperation<"0.9">
        try {
          userOperation = await prepareAndSign({
            account,
            calls: request.calls,
            ...(paymaster !== undefined ? { paymaster } : {}),
            ...(paymasterContext === undefined
              ? {}
              : { paymasterContext: paymasterContext.value })
          })
        } catch (error) {
          throw toPreBroadcastExecutionError(
            error instanceof Error
              ? error
              : new Error("Kernel user operation preparation failed.")
          )
        }

        const proposalKey = getUserOperationProposalKey({
          ...(paymasterContext === undefined
            ? {}
            : { paymasterContextHash: paymasterContext.canonicalHash }),
          paymasterUrl,
          userOperation
        })
        try {
          userOperationHash =
            await bundlerClient.sendPreparedUserOperation(userOperation)
          trackAcceptedHashes(proposalKey, [userOperationHash])
        } catch (error) {
          if (!(error instanceof Error)) throw error
          const retryReason = getSliceBundlerRetryReason(error)
          const trackedHashes = acceptedHashesByProposal.get(proposalKey) ?? []
          const mayRetry =
            retryReason === "fee_floor" ||
            (retryReason === "replacement_underpriced" &&
              trackedHashes.length > 0)
          if (!mayRetry) {
            if (isExplicitBundlerRpcRejection(error)) {
              throw toPreBroadcastExecutionError(error)
            }
            throw error
          }

          let retriedUserOperation: UserOperation<"0.9">
          try {
            retriedUserOperation = await prepareAndSign({
              account,
              callData: userOperation.callData,
              ...(userOperation.factory === undefined
                ? {}
                : { factory: userOperation.factory }),
              ...(userOperation.factoryData === undefined
                ? {}
                : { factoryData: userOperation.factoryData }),
              nonce: userOperation.nonce,
              parameters: ["fees", "gas", "paymaster", "signature"],
              ...(paymaster !== undefined ? { paymaster } : {}),
              ...(paymasterContext === undefined
                ? {}
                : { paymasterContext: paymasterContext.value })
            })
            assertRetryPreservesProposal({
              original: userOperation,
              retried: retriedUserOperation
            })
          } catch (retryError) {
            throw toPreBroadcastExecutionError(
              retryError instanceof Error
                ? retryError
                : new Error("Kernel user operation repricing failed.")
            )
          }

          try {
            userOperationHash =
              await bundlerClient.sendPreparedUserOperation(
                retriedUserOperation
              )
          } catch (retryError) {
            if (
              retryError instanceof Error &&
              isExplicitBundlerRpcRejection(retryError)
            ) {
              throw toPreBroadcastExecutionError(retryError)
            }
            throw retryError
          }
          trackAcceptedHashes(proposalKey, [
            ...trackedHashes,
            userOperationHash
          ])
        }
      } else {
        userOperationHash = await bundlerClient.sendUserOperation({
          account,
          calls: request.calls,
          ...(paymaster !== undefined ? { paymaster } : {}),
          ...(paymasterContext === undefined
            ? {}
            : { paymasterContext: paymasterContext.value })
        })
      }
      onUserOperationEvent?.({
        account: account.address,
        type: "userOperationSubmitted",
        userOperationHash
      })

      return { executionId: userOperationHash }
    },
    waitForExecutionReceipt: async ({ executionId }) => {
      const userOperationHash = executionId
      const receiptCandidates = receiptCandidatesByHash.get(executionId) ?? [
        executionId
      ]
      const receipt = await Promise.any(
        receiptCandidates.map((hash) =>
          bundlerClient.waitForUserOperationReceipt({ hash })
        )
      )

      const mappedReceipt = {
        ...(receipt.reason === undefined
          ? {}
          : { revertReason: receipt.reason }),
        success: receipt.success,
        transactionHash: receipt.receipt.transactionHash
      }
      onUserOperationEvent?.({
        account: account.address,
        ...mappedReceipt,
        type: "userOperationReceipt",
        userOperationHash
      })

      return mappedReceipt
    }
  }
}
