import {
  type Address,
  concat,
  decodeFunctionData,
  type Hex,
  isAddressEqual,
  zeroAddress
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"

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

export const assertSliceWalletFactoryArgs = ({
  factory,
  factoryData
}: {
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
    hookData !== "0x" ||
    initConfig.length !== 0
  ) {
    throw new Error(
      "Wallet factory data is not a canonical Slice root account."
    )
  }
}
