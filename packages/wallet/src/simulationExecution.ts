import {
  type Address,
  decodeEventLog,
  encodeFunctionData,
  type Hex,
  toHex
} from "viem"
import { toPackedUserOperation } from "viem/account-abstraction"
import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletSimulationCaller,
  sliceWalletSimulationStaticCallCode,
  sliceWalletSimulationStaticCallProxy,
  sliceWalletSimulationValidatorCode
} from "./protocol/constants"
import type { SliceWalletProtocolValue } from "./protocol/index"
import type { SliceWalletUnsignedUserOperation } from "./types"

type ProtocolRecord = { readonly [key: string]: SliceWalletProtocolValue }

type SimulatedLog = {
  address: Address
  data: Hex
  topics: readonly Hex[]
}

const maximumSimulationTransactionGas = 50_000_000n

const transactionIntrinsicGas = (data: Hex) => {
  let gas = 21_000n
  for (let index = 2; index < data.length; index += 2) {
    gas += data.slice(index, index + 2) === "00" ? 4n : 16n
  }
  return gas
}

export const getSliceWalletSimulationPlan = (
  userOperation: SliceWalletUnsignedUserOperation
) => {
  if (
    (userOperation.factory === undefined) !==
    (userOperation.factoryData === undefined)
  ) {
    throw new Error("Wallet simulation requires complete factory fields.")
  }
  const data = encodeFunctionData({
    abi: sliceWalletEntryPoint.abi,
    args: [
      [toPackedUserOperation({ ...userOperation, signature: "0x" })],
      sliceWalletSimulationCaller
    ],
    functionName: "handleOps"
  })
  const intrinsicGas = transactionIntrinsicGas(data)
  return {
    // Both injected overrides are required: the validator stub lets the
    // unsigned operation pass Kernel validation, and the static-call
    // forwarder makes snapshot reads state-mutating-proof.
    stateOverrides: {
      [sliceWalletKernelAddresses.webAuthnRootValidator]: {
        code: sliceWalletSimulationValidatorCode
      },
      [sliceWalletSimulationStaticCallProxy]: {
        code: sliceWalletSimulationStaticCallCode
      }
    } satisfies ProtocolRecord,
    transactions: [
      {
        call: {
          data,
          from: sliceWalletSimulationCaller,
          gas: toHex(maximumSimulationTransactionGas),
          to: sliceWalletEntryPoint.address
        } satisfies ProtocolRecord,
        executionGas: maximumSimulationTransactionGas - intrinsicGas,
        intrinsicGas,
        label: "wallet operation" as const
      }
    ]
  }
}

export const getSliceWalletUserOperationSimulationResult = (
  logs: readonly SimulatedLog[],
  account: Address
) => {
  for (const log of logs) {
    if (
      log.address.toLowerCase() !== sliceWalletEntryPoint.address.toLowerCase()
    ) {
      continue
    }
    try {
      const decoded = decodeEventLog({
        abi: sliceWalletEntryPoint.abi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]]
      })
      if (
        decoded.eventName === "UserOperationEvent" &&
        decoded.args.sender.toLowerCase() === account.toLowerCase()
      ) {
        return {
          gasCost: decoded.args.actualGasCost,
          gasUsed: decoded.args.actualGasUsed,
          success: decoded.args.success
        }
      }
    } catch {}
  }
  return null
}
