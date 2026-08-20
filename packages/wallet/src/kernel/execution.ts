import {
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  hexToBigInt,
  size,
  slice,
  toHex
} from "viem"
import type { SliceKernelCall } from "../protocol/index"
import {
  kernelAccountAbi,
  kernelBatchExecutionMode,
  kernelSingleExecutionMode
} from "../protocol/kernel"

const kernelCallsAbiParameter = {
  components: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" }
  ],
  name: "calls",
  type: "tuple[]"
} as const

export const encodeKernelCalls = (calls: readonly SliceKernelCall[]) => {
  if (calls.length === 0) throw new Error("Kernel execution requires a call.")
  if (calls.length === 1) {
    const call = calls[0]
    if (call === undefined) throw new Error("Kernel execution call is missing.")
    return encodeFunctionData({
      abi: kernelAccountAbi,
      args: [
        kernelSingleExecutionMode,
        concat([call.to, toSizedHex(call.value ?? 0n), call.data ?? "0x"])
      ],
      functionName: "execute"
    })
  }
  return encodeFunctionData({
    abi: kernelAccountAbi,
    args: [
      kernelBatchExecutionMode,
      encodeAbiParameters(
        [kernelCallsAbiParameter],
        [
          calls.map((call) => ({
            data: call.data ?? "0x",
            to: call.to,
            value: call.value ?? 0n
          }))
        ]
      )
    ],
    functionName: "execute"
  })
}

const toSizedHex = (value: bigint) => {
  if (value < 0n) throw new Error("Kernel call value cannot be negative.")
  return toHex(value, { size: 32 })
}

export const decodeKernelCalls = (
  callData: Hex
): readonly SliceKernelCall[] => {
  const decoded = decodeFunctionData({ abi: kernelAccountAbi, data: callData })
  if (decoded.functionName !== "execute") {
    throw new Error("Kernel calldata is not an execution.")
  }
  const [mode, executionData] = decoded.args
  if (mode === kernelSingleExecutionMode) {
    if (size(executionData) < 52) {
      throw new Error("Kernel single execution data is malformed.")
    }
    return [
      {
        data: size(executionData) === 52 ? "0x" : slice(executionData, 52),
        to: getAddress(slice(executionData, 0, 20)),
        value: hexToBigInt(slice(executionData, 20, 52))
      }
    ]
  }
  if (mode !== kernelBatchExecutionMode) {
    throw new Error("Kernel execution mode is unsupported.")
  }
  const [calls] = decodeAbiParameters([kernelCallsAbiParameter], executionData)
  return calls.map((call) => ({
    data: call.data,
    to: call.to,
    value: call.value
  }))
}
