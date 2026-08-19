#!/usr/bin/env bun

import type { SliceWalletFrameSession } from "@slicekit/wallet-primitives/server"
import {
  createNativeTransferCallRule,
  getWalletPermissionId,
  getWalletPermissionValidAfter,
  sliceWalletEntryPoint
} from "@slicekit/wallet-primitives/server"
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  hashTypedData,
  http
} from "viem"
import {
  createBundlerClient,
  entryPoint07Abi,
  getUserOperationHash
} from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import {
  encodeSliceWalletSyntheticWebAuthnSignature,
  generateSliceWalletP256KeyPair
} from "../src/p256"
import {
  buildSliceWalletPermissionEnableTypedData,
  createSliceWalletPermissionAccount
} from "../src/permissionAccount"
import { buildRecoveryPermissionInitConfig } from "../src/recovery"
import { createSliceWalletRegisteredKernelAccount } from "../src/rootValidator"
import type { SliceWalletSignerFrameClient } from "../src/types/frame"

const broadcaster = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
)
const recipient = "0x0000000000000000000000000000000000008128" as const
const depositValue = 20_000_000_000_000_000n
const rootKey = await generateSliceWalletP256KeyPair()
const registeredRootCredential = {
  credentialIdHash:
    "0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5" as const,
  publicKey: rootKey.publicKeyHex
}

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
    const recovery = await buildRecoveryPermissionInitConfig({
      client: publicClient,
      recoverySignerAddress: broadcaster.address
    })
    const account = await createSliceWalletRegisteredKernelAccount({
      chainId,
      client: publicClient,
      credential: registeredRootCredential,
      initConfig: recovery.initConfig,
      rootSigner: (challenge) =>
        encodeSliceWalletSyntheticWebAuthnSignature({
          chainId,
          challenge,
          key: rootKey.privateKey,
          origin: "http://localhost",
          rpId: "localhost",
          usePrecompiled: false
        })
    })
    const sessionKey = await generateSliceWalletP256KeyPair()
    const validUntil = Math.floor(Date.now() / 1_000) + 3_600
    const policy = {
      account: account.address,
      calls: [createNativeTransferCallRule({ maximumValue: 1n, recipient })],
      chainId,
      grantKind: "generic",
      rateLimit: { count: 1, intervalSec: 3_600 },
      validAfter: getWalletPermissionValidAfter(),
      validUntil,
      version: 1
    } as const
    const session = {
      account: account.address,
      chainId,
      expiresAt: validUntil,
      grantKind: "generic",
      permissionId: getWalletPermissionId(policy, sessionKey.signerId),
      policy,
      publicKey: sessionKey.publicKeyHex,
      signerId: sessionKey.signerId
    } satisfies SliceWalletFrameSession
    const frameClient: SliceWalletSignerFrameClient = {
      destroy: () => {},
      request: async (request) => {
        if (request.method !== "signScopedUserOperation") {
          throw new Error(
            "The two-chain drill received an unexpected frame request."
          )
        }
        const userOperationHash = getUserOperationHash({
          chainId,
          entryPointAddress: sliceWalletEntryPoint.address,
          entryPointVersion: "0.7",
          userOperation: {
            ...request.params.userOperation,
            signature: "0x"
          }
        })
        return {
          proposalHash: `0x${"00".repeat(32)}`,
          signature: await encodeSliceWalletSyntheticWebAuthnSignature({
            chainId,
            challenge: userOperationHash,
            key: sessionKey.privateKey,
            origin: "http://localhost",
            rpId: "localhost",
            usePrecompiled: false
          }),
          userOperationHash
        }
      }
    }
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

    const rootBundlerClient = createBundlerClient({
      account,
      chain,
      client: publicClient,
      transport: http(bundlerUrl)
    })
    const deploymentHash = await rootBundlerClient.sendUserOperation({
      calls: [{ data: "0x", to: recipient, value: 0n }]
    })
    const deploymentReceipt =
      await rootBundlerClient.waitForUserOperationReceipt({
        hash: deploymentHash
      })
    if (!deploymentReceipt.success) {
      throw new Error(`Wallet e2e deployment failed on chain ${chainId}.`)
    }
    const enableTypedData = await buildSliceWalletPermissionEnableTypedData({
      accountIndex: 0n,
      address: account.address,
      client: publicClient,
      credential: registeredRootCredential,
      session
    })
    const enableSignature = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId,
      challenge: hashTypedData(enableTypedData),
      key: rootKey.privateKey,
      origin: "http://localhost",
      rpId: "localhost",
      usePrecompiled: false
    })

    const permissionAccount = await createSliceWalletPermissionAccount({
      accountIndex: 0n,
      address: account.address,
      client: publicClient,
      credential: registeredRootCredential,
      enableSignature,
      frameClient,
      mode: "generic",
      session
    })
    const sessionBundlerClient = createBundlerClient({
      account: permissionAccount,
      chain,
      client: publicClient,
      transport: http(bundlerUrl)
    })
    const userOperationHash = await sessionBundlerClient.sendUserOperation({
      calls: [{ data: "0x", to: recipient, value: 0n }]
    })
    const receipt = await sessionBundlerClient.waitForUserOperationReceipt({
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
      permissionId: session.permissionId,
      signerId: session.signerId,
      userOperationHash
    }
  })
)

if (results[0]?.account !== results[1]?.account) {
  throw new Error("Counterfactual wallet address differs across local chains.")
}
console.log(JSON.stringify(results, null, 2))
