import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import { type Address, type Hex, zeroAddress } from "viem"
import { getCode, multicall } from "viem/actions"
import { getAction } from "viem/utils"

const kernelValidationNonceAbi = [
  {
    inputs: [],
    name: "currentNonce",
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "vId", type: "bytes21" }],
    name: "validationConfig",
    outputs: [
      {
        components: [
          { name: "nonce", type: "uint32" },
          { name: "hook", type: "address" }
        ],
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

export const resolveSliceWalletValidationInstallConfig = ({
  currentNonce,
  validationNonce
}: {
  currentNonce: number
  validationNonce: number
}) => ({
  hook: zeroAddress,
  nonce:
    validationNonce > 0
      ? validationNonce
      : validationNonce === currentNonce
        ? currentNonce + 1
        : currentNonce
})

export const getSliceWalletValidationInstallConfig = async ({
  account,
  client,
  validationId
}: {
  account: Address
  client: KernelSmartAccountImplementation["client"]
  validationId: Hex
}) => {
  let currentNonce: number
  let validationNonce: number
  try {
    const [current, validation] = await getAction(
      client,
      multicall,
      "multicall"
    )({
      allowFailure: false,
      contracts: [
        {
          abi: kernelValidationNonceAbi,
          address: account,
          functionName: "currentNonce"
        },
        {
          abi: kernelValidationNonceAbi,
          address: account,
          args: [validationId],
          functionName: "validationConfig"
        }
      ]
    })
    currentNonce = current
    validationNonce = validation.nonce
  } catch (error) {
    const code = await getAction(
      client,
      getCode,
      "getCode"
    )({ address: account })
    if (code !== undefined && code !== "0x") throw error
    currentNonce = 1
    validationNonce = 0
  }
  return resolveSliceWalletValidationInstallConfig({
    currentNonce,
    validationNonce
  })
}
