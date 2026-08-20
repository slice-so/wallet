import {
  type Address,
  decodeAbiParameters,
  decodeFunctionData,
  type Hex,
  hexToBigInt,
  isAddress,
  sliceHex,
  toFunctionSelector
} from "viem"
import type { SliceSmartAccountCall } from "../../types/commerce"
import {
  ambireAccountExecutionAbi,
  coinbaseSmartWalletExecutionAbi,
  erc7579AccountExecutionAbi,
  erc7579BatchExecutionAbiParameters,
  metaMaskDelegatorExecutionAbi,
  operationAwareExecutionAbi,
  safeExecutionAbi,
  simpleAccountBatchExecutionAbi,
  zeroValueBatchExecutionAbi
} from "./slicePaymasterAbis"

type SliceSmartAccountCallDecoder = {
  decode: (callData: Hex) => SliceSmartAccountCall[] | null
}

const erc7579ExecutionModes = {
  batchDefault:
    "0x0100000000000000000000000000000000000000000000000000000000000000",
  singleDefault:
    "0x0000000000000000000000000000000000000000000000000000000000000000"
} as const

const isCallOperation = (operation: number | bigint) =>
  operation.toString() === "0"

const createParallelBatchCalls = ({
  data,
  targets,
  values
}: {
  data: readonly Hex[]
  targets: readonly Address[]
  values: readonly bigint[]
}) => {
  if (targets.length !== values.length || targets.length !== data.length) {
    return null
  }

  const calls: SliceSmartAccountCall[] = []
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const value = values[index]
    const callData = data[index]
    if (target === undefined || value === undefined || callData === undefined) {
      return null
    }
    calls.push({ target, value, data: callData })
  }

  return calls
}

const createZeroValueBatchCalls = ({
  data,
  targets
}: {
  data: readonly Hex[]
  targets: readonly Address[]
}) => {
  if (targets.length !== data.length) return null

  const calls: SliceSmartAccountCall[] = []
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const callData = data[index]
    if (target === undefined || callData === undefined) return null
    calls.push({ target, value: 0n, data: callData })
  }

  return calls
}

const decodeCoinbaseSmartWalletCalls = (callData: Hex) => {
  const decoded = decodeFunctionData({
    abi: coinbaseSmartWalletExecutionAbi,
    data: callData
  })

  if (decoded.functionName === "execute") {
    const [target, value, data] = decoded.args
    return [{ target, value, data }]
  }

  return decoded.args[0].map((call) => ({
    target: call.target,
    value: call.value,
    data: call.data
  }))
}

const decodeSimpleAccountBatchCalls = (callData: Hex) => {
  const [targets, values, data] = decodeFunctionData({
    abi: simpleAccountBatchExecutionAbi,
    data: callData
  }).args
  return createParallelBatchCalls({ data, targets, values })
}

const decodeZeroValueBatchCalls = (callData: Hex) => {
  const [targets, data] = decodeFunctionData({
    abi: zeroValueBatchExecutionAbi,
    data: callData
  }).args
  return createZeroValueBatchCalls({ data, targets })
}

const decodeOperationAwareExecuteCalls = (callData: Hex) => {
  const [target, value, data, operation] = decodeFunctionData({
    abi: operationAwareExecutionAbi,
    data: callData
  }).args
  return isCallOperation(operation) ? [{ target, value, data }] : null
}

const decodeSafeCalls = (callData: Hex) => {
  const [target, value, data, operation] = decodeFunctionData({
    abi: safeExecutionAbi,
    data: callData
  }).args
  return isCallOperation(operation) ? [{ target, value, data }] : null
}

const decodeAmbireAccountCalls = (callData: Hex) => {
  const decoded = decodeFunctionData({
    abi: ambireAccountExecutionAbi,
    data: callData
  })

  if (decoded.functionName === "executeBySelfSingle") {
    const [call] = decoded.args
    return [{ target: call.to, value: call.value, data: call.data }]
  }

  if (decoded.functionName === "executeMultiple") {
    const [executionBatches] = decoded.args
    return executionBatches.flatMap((executionBatch) =>
      executionBatch.calls.map((call) => ({
        target: call.to,
        value: call.value,
        data: call.data
      }))
    )
  }

  const [calls] = decoded.args
  return calls.map((call) => ({
    target: call.to,
    value: call.value,
    data: call.data
  }))
}

const decodeErc7579PackedExecution = ({
  executionCalldata
}: {
  executionCalldata: Hex
}) => {
  const minimumPackedExecutionLength = 2 + (20 + 32) * 2
  if (executionCalldata.length < minimumPackedExecutionLength) return null

  const target = sliceHex(executionCalldata, 0, 20)
  if (!isAddress(target)) return null

  return {
    target,
    value: hexToBigInt(sliceHex(executionCalldata, 20, 52)),
    data:
      executionCalldata.length === minimumPackedExecutionLength
        ? "0x"
        : sliceHex(executionCalldata, 52)
  }
}

const decodeErc7579BatchExecution = ({
  executionCalldata
}: {
  executionCalldata: Hex
}) => {
  try {
    const [executions] = decodeAbiParameters(
      erc7579BatchExecutionAbiParameters,
      executionCalldata
    )
    return executions.map((execution) => ({
      target: execution.target,
      value: execution.value,
      data: execution.callData
    }))
  } catch {
    return null
  }
}

const decodeErc7579ExecutionCalls = ({
  executionCalldata,
  mode
}: {
  executionCalldata: Hex
  mode: Hex
}) => {
  const normalizedMode = mode.toLowerCase()
  if (normalizedMode === erc7579ExecutionModes.singleDefault) {
    const call = decodeErc7579PackedExecution({ executionCalldata })
    return call ? [call] : null
  }
  if (normalizedMode === erc7579ExecutionModes.batchDefault) {
    return decodeErc7579BatchExecution({ executionCalldata })
  }
  return null
}

const decodeErc7579ExecuteCalls = (callData: Hex) => {
  const [mode, executionCalldata] = decodeFunctionData({
    abi: erc7579AccountExecutionAbi,
    data: callData
  }).args
  return decodeErc7579ExecutionCalls({ executionCalldata, mode })
}

const decodeMetaMaskDelegatorCalls = (callData: Hex) => {
  const [execution] = decodeFunctionData({
    abi: metaMaskDelegatorExecutionAbi,
    data: callData
  }).args
  return [
    {
      target: execution.target,
      value: execution.value,
      data: execution.callData
    }
  ]
}

const smartAccountCallDecoders: SliceSmartAccountCallDecoder[] = [
  { decode: decodeCoinbaseSmartWalletCalls },
  { decode: decodeErc7579ExecuteCalls },
  { decode: decodeMetaMaskDelegatorCalls },
  { decode: decodeAmbireAccountCalls },
  { decode: decodeSimpleAccountBatchCalls },
  { decode: decodeZeroValueBatchCalls },
  { decode: decodeOperationAwareExecuteCalls },
  { decode: decodeSafeCalls }
]

const smartAccountExecutionSelectors = new Set(
  [
    ambireAccountExecutionAbi,
    coinbaseSmartWalletExecutionAbi,
    erc7579AccountExecutionAbi,
    metaMaskDelegatorExecutionAbi,
    operationAwareExecutionAbi,
    safeExecutionAbi,
    simpleAccountBatchExecutionAbi,
    zeroValueBatchExecutionAbi
  ].flatMap((abi) => abi.map((item) => toFunctionSelector(item)))
)

export const isSliceSmartAccountExecutionCallData = (callData: Hex) =>
  callData.length >= 10 &&
  smartAccountExecutionSelectors.has(sliceHex(callData, 0, 4))

export const getSliceSmartAccountCalls = (
  callData: Hex
): SliceSmartAccountCall[] | null => {
  for (const decoder of smartAccountCallDecoders) {
    try {
      const calls = decoder.decode(callData)
      if (calls?.length) return calls
    } catch {}
  }
  return null
}
