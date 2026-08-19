import { describe, expect, it } from "bun:test"
import { sliceWalletKernelAddresses } from "@slicekit/wallet-primitives/server"
import * as Base64 from "ox/Base64"
import {
  concatHex,
  createPublicClient,
  custom,
  decodeFunctionData,
  defineChain,
  getContractAddress,
  hexToBytes,
  keccak256,
  parseErc6492Signature,
  toHex
} from "viem"
import { createSliceWalletKernelAccount } from "./account"
import {
  predictSliceWalletKernelAccountAddress,
  sliceWalletKernelProxyInitCodeHash
} from "./accountPrediction"
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
  "0x614d09f18A013734E56584F157E48c6508d6Db5d" as const
const indexedAddressVectors = [
  [1n, "0xa3D8B1c04629A122E277Df609b375dd01765f4Ab"],
  [7n, "0x520B1B81FCa0822C222292F5cAcF3e60B3D447D5"],
  [31n, "0x1dC61fbcC9FFd59029174D677cf3f310882Af87b"]
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

  it("keeps passkey account deployment byte-compatible", async () => {
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
    const credential = {
      id: Base64.fromBytes(new Uint8Array([1, 2, 3, 4]), {
        pad: false,
        url: true
      }),
      publicKey: parameters.credential.publicKey
    }
    const registeredCredential = {
      credentialIdHash: keccak256(toHex(Base64.toBytes(credential.id))),
      publicKey: credential.publicKey
    }
    const [passkeyAccount, registeredAccount] = await Promise.all([
      createSliceWalletKernelAccount({
        address: entryPointDerivedAddress,
        client,
        credential
      }),
      createSliceWalletRegisteredKernelAccount({
        address: entryPointDerivedAddress,
        chainId: parameters.chainId,
        client,
        credential: registeredCredential
      })
    ])

    expect(await passkeyAccount.getFactoryArgs()).toEqual(
      await registeredAccount.getFactoryArgs()
    )
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
