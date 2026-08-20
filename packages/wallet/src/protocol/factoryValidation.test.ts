import { describe, expect, test } from "bun:test"
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http
} from "viem"
import { anvil } from "viem/chains"
import { encodeSliceWalletRootValidatorData } from "./accountPrediction"
import { sliceWalletKernelAddresses } from "./constants"
import { assertSliceWalletFactoryArgs } from "./factoryValidation"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import type { SliceWalletRegisteredRootCredential } from "./types/account"

const kernelFactoryAbi = [
  {
    inputs: [
      {
        components: [
          { name: "moduleType", type: "uint256" },
          { name: "module", type: "address" },
          { name: "moduleData", type: "bytes" },
          { name: "internalData", type: "bytes" }
        ],
        name: "packages",
        type: "tuple[]"
      },
      { name: "nonce", type: "uint256" }
    ],
    name: "deploy",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "payable",
    type: "function"
  }
] as const

const credential = {
  credentialIdHash: `0x${"22".repeat(32)}`,
  publicKey: `0x04${"11".repeat(32)}${"33".repeat(32)}`
} as const satisfies SliceWalletRegisteredRootCredential
const client = createPublicClient({
  chain: anvil,
  transport: http("http://127.0.0.1:8545")
})
const recoverySigner =
  "0x0000000000000000000000000000000000000001" satisfies Address
const recovery = await buildRecoveryPermissionInitConfig({
  recoverySignerAddress: recoverySigner
})
const rootInstall = {
  internalData: "0x" as Hex,
  module: sliceWalletKernelAddresses.webAuthnRootValidator,
  moduleData: encodeSliceWalletRootValidatorData(credential),
  moduleType: 1n
}

const createFactoryData = ({
  accountIndex = 0,
  includeRecovery = true,
  rootModule = sliceWalletKernelAddresses.webAuthnRootValidator
}: {
  accountIndex?: number
  includeRecovery?: boolean
  rootModule?: Address
} = {}) =>
  encodeFunctionData({
    abi: kernelFactoryAbi,
    args: [
      [
        { ...rootInstall, module: rootModule },
        ...(includeRecovery ? recovery.initConfig : [])
      ],
      BigInt(accountIndex)
    ],
    functionName: "deploy"
  })

describe("Slice Wallet counterfactual factory validation", () => {
  test("accepts only pinned canonical KernelUUPS root deployments", async () => {
    for (const accountIndex of [0, 7, 31]) {
      const result = await assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.factory,
        factoryData: createFactoryData({ accountIndex })
      })
      expect(result).toMatchObject({
        accountIndex,
        credentialIdHash: credential.credentialIdHash,
        publicKey: credential.publicKey,
        recoveryPermissionId: recovery.permissionId,
        recoverySignerAddress: recoverySigner
      })
      expect(result.initConfig).toEqual([...recovery.initConfig])
    }
  })

  test("rejects foreign factories, roots, missing recovery, and high indexes", async () => {
    const foreign =
      "0x0000000000000000000000000000000000000002" satisfies Address
    await expect(
      assertSliceWalletFactoryArgs({
        chainId: 8453,
        client,
        factory: foreign,
        factoryData: createFactoryData()
      })
    ).rejects.toThrow("pinned KernelUUPS factory")
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.factory,
        factoryData: createFactoryData({ rootModule: foreign })
      })
    ).rejects.toThrow("canonical Slice root")
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.factory,
        factoryData: createFactoryData({ includeRecovery: false })
      })
    ).rejects.toThrow("recovery init config")
    await expect(
      assertSliceWalletFactoryArgs({
        client,
        factory: sliceWalletKernelAddresses.factory,
        factoryData: createFactoryData({ accountIndex: 32 })
      })
    ).rejects.toThrow("account index")
  })
})
