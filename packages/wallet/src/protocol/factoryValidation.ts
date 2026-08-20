import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  type Hex,
  isAddressEqual,
  toHex
} from "viem"
import { kernelFactoryAbi } from "./kernel/abi"
import { resolveSliceWalletDeployment } from "./kernel/deploymentProfiles"
import { assertRecoveryPermissionInitConfig } from "./recovery"
import type { BuildSliceWalletPermissionEnableTypedDataParameters } from "./types/permission"

const rootValidatorDataParameters = [
  {
    components: [
      { name: "x", type: "uint256" },
      { name: "y", type: "uint256" }
    ],
    name: "webAuthnData",
    type: "tuple"
  },
  { name: "authenticatorIdHash", type: "bytes32" }
] as const

export const assertSliceWalletFactoryArgs = async ({
  client,
  chainId,
  factory,
  factoryData
}: {
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  chainId?: number
  factory: Address
  factoryData: Hex
}) => {
  const walletDeployment = resolveSliceWalletDeployment({
    chainId: chainId ?? client.chain?.id ?? 8453
  })
  if (!isAddressEqual(factory, walletDeployment.factory)) {
    throw new Error("Wallet factory must be the pinned KernelUUPS factory.")
  }
  const deployment = decodeFunctionData({
    abi: kernelFactoryAbi,
    data: factoryData
  })
  const [packages, nonce] = deployment.args
  const root = packages[0]
  if (
    root === undefined ||
    root.moduleType !== 1n ||
    !isAddressEqual(root.module, walletDeployment.rootValidator) ||
    root.internalData !== "0x"
  ) {
    throw new Error(
      "Wallet factory data is not a canonical Slice root account."
    )
  }
  const [webAuthnData, credentialIdHash] = decodeAbiParameters(
    rootValidatorDataParameters,
    root.moduleData
  )
  const initConfig = packages.slice(1).map((install) => ({ ...install }))
  const recovery = await assertRecoveryPermissionInitConfig({
    chainId: chainId ?? client.chain?.id ?? 8453,
    client,
    factoryVersion: walletDeployment.profile.id,
    initConfig
  })
  if (nonce > 31n) {
    throw new Error("Wallet factory nonce is not a supported account index.")
  }
  return {
    accountIndex: Number(nonce),
    credentialIdHash,
    factoryVersion: walletDeployment.profile.id,
    initConfig,
    publicKey: concat([
      "0x04",
      toHex(webAuthnData.x, { size: 32 }),
      toHex(webAuthnData.y, { size: 32 })
    ]),
    recoveryPermissionId: recovery.permissionId,
    recoverySignerAddress: recovery.recoverySignerAddress
  }
}
