import { type Address, concat, type Hex, pad, slice, toHex } from "viem"
import { readContract } from "viem/actions"
import type { SliceKernelClient } from "../types/kernel"
import { kernelEntryPointNonceAbi } from "./abi"
import { kernelEntryPoint, kernelValidationType } from "./constants"

export const getKernelRootNonceKey = (customKey = 0n) => {
  assertKernelCustomKey(customKey)
  return customKey
}

export const getKernelValidatorNonceKey = ({
  customKey = 0n,
  enable = false,
  validator
}: {
  customKey?: bigint
  enable?: boolean
  validator: Address
}) => {
  assertKernelCustomKey(customKey)
  return toKernelNonceKey(
    concat([
      toHex(enable ? 0x08 : 0x00, { size: 1 }),
      toHex(kernelValidationType.validator, { size: 1 }),
      validator,
      toHex(customKey, { size: 2 })
    ])
  )
}

export const getKernelPermissionNonceKey = ({
  customKey = 0n,
  enable = false,
  permissionId
}: {
  customKey?: bigint
  enable?: boolean
  permissionId: Hex
}) => {
  assertKernelCustomKey(customKey)
  if (sizePermissionId(permissionId) !== 4) {
    throw new Error("Kernel permission id must be four bytes.")
  }
  return toKernelNonceKey(
    concat([
      toHex(enable ? 0x08 : 0x00, { size: 1 }),
      toHex(kernelValidationType.permission, { size: 1 }),
      pad(permissionId, { dir: "right", size: 20 }),
      toHex(customKey, { size: 2 })
    ])
  )
}

const sizePermissionId = (value: Hex) => (value.length - 2) / 2

const assertKernelCustomKey = (customKey: bigint) => {
  if (customKey < 0n || customKey > 65_535n) {
    throw new Error("Kernel custom nonce key must fit in two bytes.")
  }
}

const toKernelNonceKey = (key: Hex) => BigInt(key)

export const decodeKernelNonce = (nonce: bigint) => {
  const encoded = toHex(nonce, { size: 32 })
  const validationMode = Number(BigInt(slice(encoded, 0, 1)))
  const validationType = Number(BigInt(slice(encoded, 1, 2)))
  return {
    customKey: BigInt(slice(encoded, 22, 24)),
    permissionId:
      validationType === kernelValidationType.permission
        ? slice(encoded, 2, 6)
        : undefined,
    sequence: BigInt(slice(encoded, 24, 32)),
    validationMode,
    validationType,
    validator:
      validationType === kernelValidationType.validator
        ? (slice(encoded, 2, 22) as Address)
        : undefined
  }
}

export const getKernelEntryPointNonce = ({
  account,
  client,
  key
}: {
  account: Address
  client: SliceKernelClient
  key: bigint
}) =>
  readContract(client, {
    abi: kernelEntryPointNonceAbi,
    address: kernelEntryPoint.address,
    args: [account, key],
    functionName: "getNonce"
  })
