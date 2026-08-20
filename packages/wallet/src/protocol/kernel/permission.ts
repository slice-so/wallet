import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  pad,
  size,
  zeroAddress
} from "viem"
import type {
  SliceKernelInstall,
  SliceKernelPermissionData
} from "../types/kernel"
import { kernelAccountAbi, kernelInstallAbiParameter } from "./abi"
import { kernelModuleType } from "./constants"

const kernelExecuteSelector = "0xe9ae5c53" as const

const assertPermissionId = (permissionId: Hex) => {
  if (size(permissionId) !== 4) {
    throw new Error("Kernel permission id must be four bytes.")
  }
}

const toPermissionModuleData = (permissionId: Hex, data: Hex) =>
  concat([pad(permissionId, { dir: "right", size: 32 }), data])

export const getKernelPermissionInstalls = (
  permission: SliceKernelPermissionData
): readonly SliceKernelInstall[] => {
  assertPermissionId(permission.id)
  return [
    ...permission.policies.map((policy) => ({
      internalData: permission.id,
      module: policy.address,
      moduleData: toPermissionModuleData(permission.id, policy.data),
      moduleType: kernelModuleType.policy
    })),
    {
      internalData: concat([permission.id, zeroAddress, kernelExecuteSelector]),
      module: permission.signer.address,
      moduleData: toPermissionModuleData(permission.id, permission.signer.data),
      moduleType: kernelModuleType.signer
    }
  ]
}

export const encodeKernelPermissionSignature = ({
  policySignatures,
  signerSignature
}: {
  policySignatures: readonly Hex[]
  signerSignature: Hex
}) =>
  encodeAbiParameters(
    [{ name: "signatures", type: "bytes[]" }],
    [[...policySignatures, signerSignature]]
  )

export const encodeKernelEnableSignature = ({
  enableSignature,
  installNonce,
  packages,
  userOperationSignature
}: {
  enableSignature: Hex
  installNonce: bigint
  packages: readonly SliceKernelInstall[]
  userOperationSignature: Hex
}) =>
  encodeAbiParameters(
    [
      { name: "nonce", type: "uint256" },
      kernelInstallAbiParameter,
      { name: "enableSignature", type: "bytes" },
      { name: "userOpSignature", type: "bytes" }
    ],
    [installNonce, packages, enableSignature, userOperationSignature]
  )

export const encodeKernelInstallPackagesCall = (
  packages: readonly SliceKernelInstall[]
) =>
  encodeFunctionData({
    abi: kernelAccountAbi,
    args: [packages],
    functionName: "installModule"
  })

const encodeKernelUninstallData = (install: SliceKernelInstall) =>
  encodeAbiParameters(
    [
      { name: "installData", type: "bytes" },
      { name: "internalData", type: "bytes" }
    ],
    [install.moduleData, install.internalData]
  )

export const encodeKernelPermissionUninstallCalls = (
  account: `0x${string}`,
  permission: SliceKernelPermissionData
) => {
  const installs = getKernelPermissionInstalls(permission)
  const signer = installs.at(-1)
  if (signer === undefined) {
    throw new Error("Kernel permission signer install is missing.")
  }
  const uninstallOrder = [...installs.slice(0, -1).reverse(), signer]
  return uninstallOrder.map((install) => ({
    data: encodeFunctionData({
      abi: kernelAccountAbi,
      args: [
        install.moduleType,
        install.module,
        encodeKernelUninstallData(install)
      ],
      functionName: "uninstallModule"
    }),
    to: account,
    value: 0n
  }))
}

export const kernelPermissionExecuteSelector = kernelExecuteSelector
