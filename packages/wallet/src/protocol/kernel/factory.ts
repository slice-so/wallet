import {
  type Address,
  concat,
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  type Hex,
  keccak256,
  pad,
  toHex
} from "viem"
import type { SliceKernelInstall } from "../types/kernel"
import { kernelFactoryAbi, kernelInstallAbiParameter } from "./abi"

const kernelErc1967ProxyPrefix = "0x603d3d8160223d3973" as const
const kernelErc1967ProxySuffix =
  "0x60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3" as const

export const encodeKernelInstall = (install: SliceKernelInstall) =>
  encodeAbiParameters(
    [{ ...kernelInstallAbiParameter, name: "install", type: "tuple" }],
    [install]
  )

export const decodeKernelInstall = (encoded: Hex): SliceKernelInstall => {
  const [install] = decodeAbiParameters(
    [{ ...kernelInstallAbiParameter, name: "install", type: "tuple" }],
    encoded
  )
  return {
    internalData: install.internalData,
    module: install.module,
    moduleData: install.moduleData,
    moduleType: install.moduleType
  }
}

export const getKernelProxyInitCode = (implementation: Address) =>
  concatHex([
    kernelErc1967ProxyPrefix,
    implementation,
    kernelErc1967ProxySuffix
  ])

export const getKernelProxyInitCodeHash = (implementation: Address) =>
  keccak256(getKernelProxyInitCode(implementation))

export const getKernelDeploymentSalt = (
  packages: readonly SliceKernelInstall[],
  nonce: bigint
) => {
  const packageHashes = packages.map((install) =>
    keccak256(
      concat([
        toHex(install.moduleType, { size: 32 }),
        pad(install.module, { size: 32 }),
        keccak256(install.moduleData),
        keccak256(install.internalData)
      ])
    )
  )
  return keccak256(concat([toHex(nonce, { size: 32 }), ...packageHashes]))
}

export const predictKernelAddress = ({
  factory,
  implementation,
  nonce,
  packages
}: {
  factory: Address
  implementation: Address
  nonce: bigint
  packages: readonly SliceKernelInstall[]
}) =>
  getContractAddress({
    bytecodeHash: getKernelProxyInitCodeHash(implementation),
    from: factory,
    opcode: "CREATE2",
    salt: getKernelDeploymentSalt(packages, nonce)
  })

export const getKernelFactoryArgs = ({
  factory,
  nonce,
  packages
}: {
  factory: Address
  nonce: bigint
  packages: readonly SliceKernelInstall[]
}) => ({
  factory,
  factoryData: encodeFunctionData({
    abi: kernelFactoryAbi,
    args: [packages, nonce],
    functionName: "deploy"
  })
})
