import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  type Hex,
  hexToBigInt,
  isAddressEqual,
  toHex,
  zeroAddress
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
import { assertRecoveryPermissionInitConfig } from "./recovery"
import type { BuildSliceWalletPermissionEnableTypedDataParameters } from "./types/permission"

const metaFactoryAbi = [
  {
    inputs: [
      { name: "factory", type: "address" },
      { name: "createData", type: "bytes" },
      { name: "salt", type: "bytes32" }
    ],
    name: "deployWithFactory",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const

const kernelInitializeAbi = [
  {
    inputs: [
      { name: "rootValidator", type: "bytes21" },
      { name: "hook", type: "address" },
      { name: "validatorData", type: "bytes" },
      { name: "hookData", type: "bytes" },
      { name: "initConfig", type: "bytes[]" }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const

const sliceWalletRootValidationId = concat([
  "0x01",
  sliceWalletKernelAddresses.webAuthnRootValidator
])

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
  client: _client,
  factory,
  factoryData
}: {
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  factory: Address
  factoryData: Hex
}) => {
  if (!isAddressEqual(factory, sliceWalletKernelAddresses.metaFactory)) {
    throw new Error("Wallet factory must be the pinned Kernel meta-factory.")
  }
  const deployment = decodeFunctionData({
    abi: metaFactoryAbi,
    data: factoryData
  })
  if (
    deployment.functionName !== "deployWithFactory" ||
    !isAddressEqual(deployment.args[0], sliceWalletKernelAddresses.factory)
  ) {
    throw new Error("Wallet deployment must use the pinned Kernel factory.")
  }
  const initialization = decodeFunctionData({
    abi: kernelInitializeAbi,
    data: deployment.args[1]
  })
  const [rootValidator, hook, validatorData, hookData, initConfig] =
    initialization.args
  if (
    rootValidator.toLowerCase() !== sliceWalletRootValidationId.toLowerCase() ||
    !isAddressEqual(hook, zeroAddress) ||
    validatorData === "0x" ||
    hookData !== "0x"
  ) {
    throw new Error(
      "Wallet factory data is not a canonical Slice root account."
    )
  }
  const [webAuthnData, credentialIdHash] = decodeAbiParameters(
    rootValidatorDataParameters,
    validatorData
  )
  const recovery = await assertRecoveryPermissionInitConfig({
    initConfig
  })
  const accountIndexValue = hexToBigInt(deployment.args[2])
  if (accountIndexValue > 31n) {
    throw new Error(
      "Wallet factory salt does not encode a supported account index."
    )
  }
  const accountIndex = Number(accountIndexValue)
  return {
    accountIndex,
    credentialIdHash,
    initConfig: [...initConfig],
    publicKey: concat([
      "0x04",
      toHex(webAuthnData.x, { size: 32 }),
      toHex(webAuthnData.y, { size: 32 })
    ]),
    recoveryPermissionId: recovery.permissionId,
    recoverySignerAddress: recovery.recoverySignerAddress
  }
}
