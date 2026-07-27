import {
  type Address,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  hexToBigInt,
  isAddress,
  keccak256,
  sliceHex
} from "viem"
import type { WalletCall } from "./types/policy"

const erc7579ExecutionAbi = [
  {
    inputs: [
      { name: "execMode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" }
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

const erc7579BatchParameters = [
  {
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "callData", type: "bytes" }
    ],
    name: "executions",
    type: "tuple[]"
  }
] as const

const walletCallsHashParameters = [
  {
    components: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "callData", type: "bytes" }
    ],
    name: "calls",
    type: "tuple[]"
  }
] as const

export const getSliceWalletCallsHash = (calls: readonly WalletCall[]) =>
  keccak256(
    encodeAbiParameters(walletCallsHashParameters, [
      calls.map((call) => ({
        callData: call.data ?? "0x",
        target: call.to,
        value: call.value ?? 0n
      }))
    ])
  )

const singleCallMode =
  "0x0000000000000000000000000000000000000000000000000000000000000000"
const batchCallMode =
  "0x0100000000000000000000000000000000000000000000000000000000000000"

export const decodeErc7579WalletCalls = (
  callData: Hex
): readonly WalletCall[] => {
  const [mode, executionCalldata] = decodeFunctionData({
    abi: erc7579ExecutionAbi,
    data: callData
  }).args

  if (mode.toLowerCase() === singleCallMode) {
    if (executionCalldata.length < 106) {
      throw new Error("Malformed ERC-7579 single execution.")
    }
    const target = sliceHex(executionCalldata, 0, 20)
    if (!isAddress(target)) throw new Error("Malformed ERC-7579 target.")
    return [
      {
        data: sliceHex(executionCalldata, 52),
        to: target,
        value: hexToBigInt(sliceHex(executionCalldata, 20, 52))
      }
    ]
  }
  if (mode.toLowerCase() === batchCallMode) {
    const [executions] = decodeAbiParameters(
      erc7579BatchParameters,
      executionCalldata
    )
    if (executions.length === 0) throw new Error("ERC-7579 batch is empty.")
    return executions.map((execution) => ({
      data: execution.callData,
      to: execution.target,
      value: execution.value
    }))
  }

  throw new Error("Delegated execution mode must be CALL.")
}

export const decodeSliceWalletRootUserOperationCalls = ({
  account,
  callData
}: {
  account: Address
  callData: Hex
}): readonly WalletCall[] => {
  try {
    return decodeErc7579WalletCalls(callData)
  } catch {
    // Kernel root validation executes account-administration calldata as a
    // direct self-call instead of wrapping it in ERC-7579 execute.
    return [{ data: callData, to: account, value: 0n }]
  }
}
