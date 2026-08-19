import { describe, expect, test } from "bun:test"
import {
  type Address,
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  http,
  toHex,
  zeroAddress
} from "viem"
import { anvil } from "viem/chains"
import { sliceWalletKernelAddresses } from "./constants"
import { assertSliceWalletFactoryArgs } from "./factoryValidation"
import { buildRecoveryPermissionInitConfig } from "./recovery"

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

const credentialIdHash = `0x${"22".repeat(32)}` as Hex
const rootPublicKey = `0x04${"11".repeat(32)}${"33".repeat(32)}` as Hex
const rootValidatorData = encodeAbiParameters(
  [
    {
      components: [
        { name: "x", type: "uint256" },
        { name: "y", type: "uint256" }
      ],
      name: "webAuthnData",
      type: "tuple"
    },
    { name: "authenticatorIdHash", type: "bytes32" }
  ],
  [
    {
      x: BigInt(`0x${"11".repeat(32)}`),
      y: BigInt(`0x${"33".repeat(32)}`)
    },
    credentialIdHash
  ]
)
const recoverySigner = "0x0000000000000000000000000000000000000001" as Address
const client = createPublicClient({
  chain: anvil,
  transport: http("http://127.0.0.1:8545")
})
const recovery = buildRecoveryPermissionInitConfig({
  recoverySignerAddress: recoverySigner
})

const createFactoryData = ({
  accountIndex = 0,
  factory = sliceWalletKernelAddresses.factory,
  hook = zeroAddress,
  initConfig = recovery.initConfig
}: {
  accountIndex?: number
  factory?: Address
  hook?: Address
  initConfig?: Hex[]
} = {}) => {
  const initializationData = encodeFunctionData({
    abi: kernelInitializeAbi,
    args: [
      concat(["0x01", sliceWalletKernelAddresses.webAuthnRootValidator]),
      hook,
      rootValidatorData,
      "0x",
      initConfig
    ],
    functionName: "initialize"
  })
  return encodeFunctionData({
    abi: metaFactoryAbi,
    args: [
      factory,
      initializationData,
      toHex(BigInt(accountIndex), { size: 32 })
    ],
    functionName: "deployWithFactory"
  })
}

describe("Slice Wallet counterfactual factory validation", () => {
  test("accepts only pinned canonical Kernel root deployments", async () => {
    for (const accountIndex of [0, 7, 31]) {
      const result = await assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.metaFactory,
        factoryData: createFactoryData({ accountIndex })
      })
      expect(result).toMatchObject({
        accountIndex,
        credentialIdHash,
        publicKey: rootPublicKey,
        recoveryPermissionId: recovery.permissionId,
        recoverySignerAddress: recoverySigner
      })
      expect(result.initConfig.map((call) => call.toLowerCase())).toEqual(
        recovery.initConfig.map((call) => call.toLowerCase())
      )
    }
  })

  test("rejects a foreign factory, nonzero hook, or missing recovery", async () => {
    const foreign = "0x0000000000000000000000000000000000000001" as Address
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: foreign,
        factoryData: createFactoryData()
      })
    ).rejects.toThrow("meta-factory")
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.metaFactory,
        factoryData: createFactoryData({ hook: foreign })
      })
    ).rejects.toThrow("canonical")
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.metaFactory,
        factoryData: createFactoryData({ initConfig: [] })
      })
    ).rejects.toThrow("recovery init config")
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.metaFactory,
        factoryData: createFactoryData({ accountIndex: 32 })
      })
    ).rejects.toThrow("account index")
  })
})
