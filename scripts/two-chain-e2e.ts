#!/usr/bin/env bun

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http
} from "viem"
import { createBundlerClient, entryPoint07Abi } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { createSliceWalletKernelAccount } from "../src/account"
import { sliceWalletEntryPoint } from "../src/constants"
import { generateSliceWalletP256KeyPair } from "../src/p256"
import {
  createNativeTransferCallRule,
  getWalletPermissionId
} from "../src/policy"
import { canaryCredential, canaryGetFn, canaryRpId } from "./lib/canaryWebAuthn"

const broadcaster = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
)
const recipient = "0x0000000000000000000000000000000000008128" as const
const depositValue = 20_000_000_000_000_000n

const configurations = [
  {
    bundlerUrl: process.argv[4] ?? "http://127.0.0.1:4337",
    chainId: 31_337,
    rpcUrl: process.argv[2] ?? "http://127.0.0.1:8545"
  },
  {
    bundlerUrl: process.argv[5] ?? "http://127.0.0.1:4338",
    chainId: 31_338,
    rpcUrl: process.argv[3] ?? "http://127.0.0.1:8546"
  }
] as const

const results = await Promise.all(
  configurations.map(async ({ bundlerUrl, chainId, rpcUrl }) => {
    const chain = defineChain({
      id: chainId,
      name: `Slice Wallet Anvil ${chainId}`,
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } }
    })
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    if ((await publicClient.getChainId()) !== chainId) {
      throw new Error(`Wallet e2e RPC ${rpcUrl} returned the wrong chain.`)
    }
    const account = await createSliceWalletKernelAccount({
      client: publicClient,
      credential: canaryCredential,
      getFn: canaryGetFn,
      rpId: canaryRpId
    })
    const sessionKey = await generateSliceWalletP256KeyPair()
    const validUntil = Math.floor(Date.now() / 1_000) + 3_600
    const policy = {
      account: account.address,
      calls: [createNativeTransferCallRule({ maximumValue: 0n, recipient })],
      chainId,
      grantKind: "generic",
      validAfter: 0,
      validUntil,
      version: 1
    } as const
    const permissionId = getWalletPermissionId(policy, sessionKey.signerId)
    const walletClient = createWalletClient({
      account: broadcaster,
      chain,
      transport: http(rpcUrl)
    })
    const depositHash = await walletClient.writeContract({
      abi: entryPoint07Abi,
      address: sliceWalletEntryPoint.address,
      args: [account.address],
      functionName: "depositTo",
      value: depositValue
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })

    const bundlerClient = createBundlerClient({
      account,
      chain,
      client: publicClient,
      transport: http(bundlerUrl)
    })
    const fees = await publicClient.estimateFeesPerGas()
    const userOperationHash = await bundlerClient.sendUserOperation({
      callGasLimit: 500_000n,
      calls: [{ data: "0x", to: recipient, value: 0n }],
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      preVerificationGas: 120_000n,
      verificationGasLimit: 2_500_000n
    })
    const receipt = await bundlerClient.waitForUserOperationReceipt({
      hash: userOperationHash
    })
    if (!receipt.success) {
      throw new Error(`Wallet e2e user operation failed on chain ${chainId}.`)
    }
    const code = await publicClient.getCode({ address: account.address })
    if (code === undefined || code === "0x") {
      throw new Error(
        `Wallet e2e account was not deployed on chain ${chainId}.`
      )
    }
    return {
      account: getAddress(account.address),
      chainId,
      permissionId,
      signerId: sessionKey.signerId,
      userOperationHash
    }
  })
)

if (results[0]?.account !== results[1]?.account) {
  throw new Error("Counterfactual wallet address differs across local chains.")
}
if (
  results[0]?.signerId === results[1]?.signerId ||
  results[0]?.permissionId === results[1]?.permissionId
) {
  throw new Error("Local chains reused the same execution key.")
}

console.log(JSON.stringify(results, null, 2))
