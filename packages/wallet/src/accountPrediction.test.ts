import { describe, expect, test } from "bun:test"
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  defineChain,
  hexToBytes,
  parseErc6492Signature,
  serializeErc6492Signature
} from "viem"
import {
  buildRecoveryPermissionInitConfig,
  predictSliceWalletKernelAccountAddress,
  sliceWalletKernelAddresses,
  sliceWalletKernelProxyInitCodeHash
} from "./protocol/index"
import { kernelFactoryAbi } from "./protocol/kernel"
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

const vectors = [
  [0n, "0xC5A8dFe2e816F248872Fba4C54cD14C9Dd97De87"],
  [1n, "0x3D68B7B7550C3bF65f4DA046ebe6fbD24BC1f37a"],
  [7n, "0x34623E7ecA87C5b6E6968a49d2ecd3AD6cee5BA1"],
  [31n, "0x18340ea1474E222305a84ed8f684D50ff76C6294"]
] as const

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

const developmentClient = createPublicClient({
  chain: defineChain({
    id: 31337,
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

describe("KernelUUPS v4 account prediction", () => {
  test("matches pinned release factory vectors", async () => {
    expect(sliceWalletKernelProxyInitCodeHash).toBe(
      "0x95b9b5003472f9fd900f2a6ac4b9afdfa2c4188e6bcc115d2fc87bf420846ed8"
    )
    for (const [index, address] of vectors) {
      expect(
        await predictSliceWalletKernelAccountAddress({ ...parameters, index })
      ).toBe(address)
    }
  })

  test("returns official KernelFactory deploy calldata", async () => {
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: parameters.recoverySignerAddress
    })
    const account = await createSliceWalletRegisteredKernelAccount({
      chainId: parameters.chainId,
      client,
      credential: parameters.credential,
      index: 7n,
      initConfig: recovery.initConfig
    })
    const factoryArgs = await account.getFactoryArgs()
    expect(factoryArgs.factory).toBe(sliceWalletKernelAddresses.factory)
    const decoded = decodeFunctionData({
      abi: kernelFactoryAbi,
      data: factoryArgs.factoryData ?? "0x"
    })
    expect(decoded.functionName).toBe("deploy")
    expect(decoded.args[1]).toBe(7n)
    expect(decoded.args[0]).toHaveLength(4)
    expect(account.address).toBe(vectors[2][1])
  })

  test("derives identical identity and factory calldata for every r1 selector", async () => {
    const results = await Promise.all(
      [undefined, "0.4.0", "Kernel 0.4.0", "slice-kernel-v4-ep09-r1"].map(
        async (factoryVersion) => {
          const recovery = await buildRecoveryPermissionInitConfig({
            chainId: parameters.chainId,
            ...(factoryVersion === undefined ? {} : { factoryVersion }),
            recoverySignerAddress: parameters.recoverySignerAddress
          })
          const account = await createSliceWalletRegisteredKernelAccount({
            chainId: parameters.chainId,
            client,
            credential: parameters.credential,
            ...(factoryVersion === undefined ? {} : { factoryVersion }),
            index: 7n,
            initConfig: recovery.initConfig
          })
          return {
            address: account.address,
            factoryArgs: await account.getFactoryArgs()
          }
        }
      )
    )
    expect(results).toEqual(results.map(() => results[0]))
  })

  test("rejects an unknown persisted selector before account construction", async () => {
    await expect(
      createSliceWalletRegisteredKernelAccount({
        chainId: parameters.chainId,
        client,
        credential: parameters.credential,
        factoryVersion: "4.0"
      })
    ).rejects.toThrow("Unknown Slice Wallet deployment profile")
  })

  test("uses viem's standard ERC-6492 wrapper for undeployed accounts", async () => {
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: parameters.recoverySignerAddress
    })
    const account = await createSliceWalletRegisteredKernelAccount({
      chainId: parameters.chainId,
      client,
      credential: parameters.credential,
      initConfig: recovery.initConfig,
      rootSigner: async () => `0x${"22".repeat(64)}`
    })
    const parsed = parseErc6492Signature(
      await account.signMessage({ message: "Kernel v4" })
    )
    expect(parsed.address?.toLowerCase()).toBe(
      sliceWalletKernelAddresses.factory.toLowerCase()
    )
    if (parsed.data === undefined) {
      throw new Error("Expected an ERC-6492 deployment payload.")
    }
    expect(
      decodeFunctionData({ abi: kernelFactoryAbi, data: parsed.data })
        .functionName
    ).toBe("deploy")
  })

  test("reduces a real Kernel v4 counterfactual signature on development chains", async () => {
    const recovery = await buildRecoveryPermissionInitConfig({
      chainId: 31337,
      recoverySignerAddress: parameters.recoverySignerAddress
    })
    const account = await createSliceWalletRegisteredKernelAccount({
      chainId: 31337,
      client: developmentClient,
      credential: parameters.credential,
      initConfig: recovery.initConfig,
      rootSigner: async () => `0x${"22".repeat(64)}`
    })
    const compactSignature = await account.signMessage({
      message: "Kernel v4 compact ERC-6492"
    })
    const factoryArgs = await account.getFactoryArgs()
    const compactProof = parseErc6492Signature(compactSignature)
    if (compactProof.address === undefined || compactProof.data === undefined) {
      throw new Error("Expected a compact ERC-6492 deployment payload.")
    }
    if (
      factoryArgs.factory === undefined ||
      factoryArgs.factoryData === undefined
    ) {
      throw new Error("Expected Kernel v4 factory arguments.")
    }
    const standardSignature = serializeErc6492Signature({
      address: factoryArgs.factory,
      data: factoryArgs.factoryData,
      signature: compactProof.signature
    })

    expect(compactProof.address).toBe(
      sliceWalletKernelAddresses.erc6492BootstrapFactory
    )
    expect(factoryArgs.factory).toBe(sliceWalletKernelAddresses.factory)
    expect(hexToBytes(standardSignature).length).toBe(2_464)
    expect(hexToBytes(compactSignature).length).toBe(608)
  })
})
