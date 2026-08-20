import type { Address } from "viem"
import type {
  SliceKernelInstall,
  SliceKernelInstallTypedData
} from "../types/kernel"
import { kernelVersion } from "./constants"

const kernelInstallTypes = {
  Install: [
    { name: "moduleType", type: "uint256" },
    { name: "module", type: "address" },
    { name: "moduleData", type: "bytes" },
    { name: "internalData", type: "bytes" }
  ],
  InstallPackages: [
    { name: "nonce", type: "uint256" },
    { name: "packages", type: "Install[]" }
  ]
} as const

export const getKernelDomain = ({
  account,
  chainId
}: {
  account: Address
  chainId: number
}) => ({
  chainId,
  name: "Kernel" as const,
  verifyingContract: account,
  version: kernelVersion
})

export const buildKernelInstallTypedData = ({
  account,
  chainId,
  nonce,
  packages
}: {
  account: Address
  chainId: number
  nonce: bigint
  packages: readonly SliceKernelInstall[]
}): SliceKernelInstallTypedData => ({
  domain: getKernelDomain({ account, chainId }),
  message: { nonce, packages },
  primaryType: "InstallPackages",
  types: kernelInstallTypes
})

export const kernelInstallTypedDataTypes = kernelInstallTypes
