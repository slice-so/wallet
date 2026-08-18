import { describe, expect, it } from "bun:test"
import { createPublicClient, custom, type Hex, zeroAddress } from "viem"
import {
  entryPoint09Abi,
  entryPoint09Address,
  toSmartAccount
} from "viem/account-abstraction"
import { base } from "viem/chains"
import { createSliceWalletAccountBundler } from "./accountBundler"
import { canonicalizeSliceWalletPaymasterContext } from "./paymasterContext"

describe("account bundler paymaster context", () => {
  it("keeps canonical context byte-identical through stub, final, and repricing", async () => {
    const methods: string[] = []
    const serializedContexts: string[] = []
    const paymaster = "0x0000000000000000000000000000000000000001"
    const paymasterTransport = custom({
      request: async ({ method, params }) => {
        methods.push(method)
        serializedContexts.push(JSON.stringify(params?.[3]))
        return method === "pm_getPaymasterStubData"
          ? {
              isFinal: false,
              paymaster,
              paymasterData: "0x1234",
              paymasterPostOpGasLimit: "0x1",
              paymasterVerificationGasLimit: "0x1"
            }
          : {
              paymaster,
              paymasterData: "0x5678",
              paymasterPostOpGasLimit: "0x1",
              paymasterVerificationGasLimit: "0x1"
            }
      }
    })
    const publicClient = createPublicClient({
      chain: base,
      transport: custom({
        request: async ({ method }) => {
          if (method === "eth_getCode") return "0x01"
          throw new Error(`Unexpected node RPC: ${method}`)
        }
      })
    })
    const account = await toSmartAccount({
      client: publicClient,
      encodeCalls: async () => "0x",
      entryPoint: {
        abi: entryPoint09Abi,
        address: entryPoint09Address,
        version: "0.9"
      },
      getAddress: async () => zeroAddress,
      getFactoryArgs: async () => ({}),
      getNonce: async () => 0n,
      getStubSignature: async () => "0x",
      signMessage: async () => "0x",
      signTypedData: async () => "0x",
      signUserOperation: async () => "0x"
    })
    const context = canonicalizeSliceWalletPaymasterContext({
      policy: { id: "checkout", version: 1 },
      tags: ["buyer", "portable"]
    })
    const bundler = createSliceWalletAccountBundler({
      account,
      bundlerUrl: "https://bundler.example",
      chain: base,
      client: publicClient,
      paymasterService: { context, url: "https://paymaster.example" },
      transportForUrl: (url) =>
        url === "https://paymaster.example"
          ? paymasterTransport
          : custom({
              request: async () => {
                throw new Error("Preparing the operation must not submit it.")
              }
            })
    })
    const prepare = (maxFeePerGas: bigint) =>
      bundler.prepareUserOperation({
        callData: "0x" as Hex,
        callGasLimit: 1n,
        maxFeePerGas,
        maxPriorityFeePerGas: 1n,
        nonce: 0n,
        preVerificationGas: 1n,
        signature: "0x",
        verificationGasLimit: 1n
      })

    await prepare(2n)
    await prepare(3n)

    expect(methods).toEqual([
      "pm_getPaymasterStubData",
      "pm_getPaymasterData",
      "pm_getPaymasterStubData",
      "pm_getPaymasterData"
    ])
    expect(new Set(serializedContexts)).toEqual(
      new Set([context.canonicalJson])
    )
    expect(Object.isFrozen(context.value)).toBe(true)
  })
})
