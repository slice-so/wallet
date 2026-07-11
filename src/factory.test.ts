import { describe, expect, test } from "bun:test"
import {
  type Address,
  concat,
  encodeFunctionData,
  type Hex,
  zeroAddress
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
import { assertSliceWalletFactoryArgs } from "./factory"

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

const createFactoryData = ({
  factory = sliceWalletKernelAddresses.factory,
  hook = zeroAddress
}: {
  factory?: Address
  hook?: Address
} = {}) =>
  encodeFunctionData({
    abi: metaFactoryAbi,
    args: [
      factory,
      encodeFunctionData({
        abi: kernelInitializeAbi,
        args: [
          concat(["0x01", sliceWalletKernelAddresses.webAuthnRootValidator]),
          hook,
          "0x1234",
          "0x",
          []
        ],
        functionName: "initialize"
      }),
      `0x${"00".repeat(32)}` as Hex
    ],
    functionName: "deployWithFactory"
  })

describe("Slice Wallet counterfactual factory validation", () => {
  test("accepts only the pinned canonical Kernel root deployment", () => {
    expect(() =>
      assertSliceWalletFactoryArgs({
        factory: sliceWalletKernelAddresses.metaFactory,
        factoryData: createFactoryData()
      })
    ).not.toThrow()
  })

  test("rejects a foreign factory or nonzero hook", () => {
    const foreign = "0x0000000000000000000000000000000000000001" as Address
    expect(() =>
      assertSliceWalletFactoryArgs({
        factory: foreign,
        factoryData: createFactoryData()
      })
    ).toThrow("meta-factory")
    expect(() =>
      assertSliceWalletFactoryArgs({
        factory: sliceWalletKernelAddresses.metaFactory,
        factoryData: createFactoryData({ hook: foreign })
      })
    ).toThrow("canonical")
  })
})
