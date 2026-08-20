import type { Address, ContractFunctionParameters } from "viem"
import { getCode, multicall } from "viem/actions"
import { getAction } from "viem/utils"
import type {
  SliceKernelClient,
  SliceKernelPermissionData
} from "../types/kernel"
import { kernelAccountAbi } from "./abi"
import { getKernelPermissionInstalls } from "./permission"

export const getKernelPermissionInstallState = async ({
  account,
  blockNumber,
  client,
  permission
}: {
  account: Address
  blockNumber?: bigint
  client: SliceKernelClient
  permission: SliceKernelPermissionData
}) => {
  const code = await getAction(
    client,
    getCode,
    "getCode"
  )({
    address: account,
    ...(blockNumber === undefined ? {} : { blockNumber })
  })
  if (code === undefined || code === "0x") {
    return { installNonce: 0n, installed: false }
  }

  const packages = getKernelPermissionInstalls(permission)
  const contracts: readonly ContractFunctionParameters[] = [
    {
      abi: kernelAccountAbi,
      address: account,
      args: [0n],
      functionName: "nonce"
    },
    ...packages.map((install) => ({
      abi: kernelAccountAbi,
      address: account,
      args: [install.moduleType, install.module, permission.id] as const,
      functionName: "isModuleInstalled" as const
    }))
  ]
  const [installNonce, ...moduleStates] = await getAction(
    client,
    multicall,
    "multicall"
  )({
    allowFailure: false,
    ...(blockNumber === undefined ? {} : { blockNumber }),
    contracts
  })
  if (typeof installNonce !== "bigint") {
    throw new Error("Kernel permission install nonce response is invalid.")
  }
  return {
    installNonce,
    installed:
      moduleStates.length === packages.length &&
      moduleStates.every((installed) => installed === true)
  }
}
