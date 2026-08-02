import { describe, expect, it } from "bun:test"
import {
  concatHex,
  createPublicClient,
  custom,
  decodeFunctionData,
  defineChain,
  getContractAddress,
  hexToBytes,
  keccak256,
  parseErc6492Signature
} from "viem"
import {
  predictSliceWalletKernelAccountAddress,
  sliceWalletKernelProxyInitCodeHash
} from "./accountPrediction"
import { sliceWalletKernelAddresses } from "./constants"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import { createSliceWalletRegisteredKernelAccount } from "./rootValidator"

const parameters = {
  chainId: 8453,
  credential: {
    credentialIdHash:
      "0x0102030400000000000000000000000000000000000000000000000000000000",
    publicKey:
      "0x04000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000001c8"
  },
  recoverySignerAddress: "0x0000000000000000000000000000000000000001"
} as const

// Captured from EntryPoint 0.7 getSenderAddress on a Base fork using the
// pinned Kernel 0.3.3 factories. The fork tier independently replays it.
const entryPointDerivedAddress =
  "0x2EAC7591EbE1Fe88f9C01ff4bb4AcD0DA699cDac" as const
const indexedAddressVectors = [
  [1n, "0xe2eD5057d825F09acd7BC55BDF142c1A9fbD7394"],
  [7n, "0x17E812B6D1482B78F55be326EB251BBAa52Ca143"],
  [31n, "0x256869b034257E59c32CA1b1604391C4A5Cf8E3f"]
] as const

describe("Slice wallet offline account prediction", () => {
  it("matches the permanent known-address vector without RPC", async () => {
    await expect(
      predictSliceWalletKernelAccountAddress(parameters)
    ).resolves.toBe(entryPointDerivedAddress)
    expect(sliceWalletKernelProxyInitCodeHash).toBe(
      "0xc452397f1e7518f8cea0566ac057e243bb1643f6298aba8eec8cdee78ee3b3dd"
    )
  })

  it("pins the full account-index salt derivation", async () => {
    for (const [index, address] of indexedAddressVectors) {
      await expect(
        predictSliceWalletKernelAccountAddress({ ...parameters, index })
      ).resolves.toBe(address)
    }
  })

  it("matches the pinned Kernel account constructor", async () => {
    const client = createPublicClient({
      chain: defineChain({
        id: parameters.chainId,
        name: "Offline Base",
        nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
        rpcUrls: { default: { http: ["http://127.0.0.1"] } }
      }),
      transport: custom({
        async request({ method }) {
          if (method === "eth_getCode") return "0x"
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })
    const recovery = await buildRecoveryPermissionInitConfig({
      client,
      recoverySignerAddress: parameters.recoverySignerAddress
    })
    const predicted = await predictSliceWalletKernelAccountAddress(parameters)
    const account = await createSliceWalletRegisteredKernelAccount({
      address: predicted,
      chainId: parameters.chainId,
      client,
      credential: parameters.credential,
      initConfig: recovery.initConfig
    })

    const factoryArgs = await account.getFactoryArgs()
    if (factoryArgs.factoryData === undefined) {
      throw new Error("Kernel account factory data is missing.")
    }
    const deployment = decodeFunctionData({
      abi: [
        {
          inputs: [
            { name: "factory", type: "address" },
            { name: "createData", type: "bytes" },
            { name: "salt", type: "bytes32" }
          ],
          name: "deployWithFactory",
          outputs: [{ name: "account", type: "address" }],
          stateMutability: "payable",
          type: "function"
        }
      ] as const,
      data: factoryArgs.factoryData
    })
    const [factory, initializationData, index] = deployment.args
    const actual = getContractAddress({
      bytecodeHash: sliceWalletKernelProxyInitCodeHash,
      from: factory,
      opcode: "CREATE2",
      salt: keccak256(concatHex([initializationData, index]))
    })

    expect(account.address).toBe(predicted)
    expect(actual).toBe(predicted)
  })

  it("keeps UserOperation deployment canonical while compacting recovery proofs", async () => {
    const chainId = 31337
    const client = createPublicClient({
      chain: defineChain({
        id: chainId,
        name: "Offline Anvil",
        nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
        rpcUrls: { default: { http: ["http://127.0.0.1"] } }
      }),
      transport: custom({
        async request({ method }) {
          if (method === "eth_getCode") return "0x"
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })
    const recovery = await buildRecoveryPermissionInitConfig({
      client,
      recoverySignerAddress: parameters.recoverySignerAddress
    })
    const predicted = await predictSliceWalletKernelAccountAddress({
      ...parameters,
      chainId
    })
    const account = await createSliceWalletRegisteredKernelAccount({
      address: predicted,
      chainId,
      client,
      credential: parameters.credential,
      initConfig: recovery.initConfig,
      rootSigner: async () => `0x${"22".repeat(512)}`
    })

    const factoryArgs = await account.getFactoryArgs()
    const signature = await account.signMessage({ message: "compact proof" })
    const parsed = parseErc6492Signature(signature)

    expect(factoryArgs.factory).toBe(sliceWalletKernelAddresses.metaFactory)
    expect(hexToBytes(factoryArgs.factoryData ?? "0x").length).toBeGreaterThan(
      2_000
    )
    expect(parsed.address).toBe(
      sliceWalletKernelAddresses.erc6492BootstrapFactory
    )
    expect(hexToBytes(signature).length).toBeLessThan(1_600)
  })
})
