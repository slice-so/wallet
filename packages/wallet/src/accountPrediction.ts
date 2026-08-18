import {
  assertSliceWalletAccountIndex,
  predictSliceWalletKernelAccountAddressFromInitConfig
} from "@slicekit/wallet-protocol/server"
import { createPublicClient, custom, defineChain } from "viem"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import type { PredictSliceWalletKernelAccountAddressParameters } from "./types/recovery"

export {
  predictSliceWalletKernelAccountAddressFromInitConfig,
  sliceWalletKernelProxyInitCodeHash
} from "@slicekit/wallet-protocol/server"

const createOfflineClient = (chainId: number) =>
  createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `Slice wallet chain ${chainId}`,
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: ["http://127.0.0.1"] } }
    }),
    transport: custom({
      async request({ method }) {
        throw new Error(
          `Offline wallet derivation attempted RPC method ${method}.`
        )
      }
    })
  })

export const deriveSliceWalletRecoveryBootstrap = async ({
  chainId,
  credential,
  index = 0n,
  recoverySignerAddress
}: PredictSliceWalletKernelAccountAddressParameters) => {
  assertSliceWalletAccountIndex(Number(index))
  const client = createOfflineClient(chainId)
  const recovery = await buildRecoveryPermissionInitConfig({
    client,
    recoverySignerAddress
  })
  return {
    account: predictSliceWalletKernelAccountAddressFromInitConfig({
      credential,
      index,
      initConfig: recovery.initConfig
    }),
    permissionId: recovery.permissionId
  }
}

export const predictSliceWalletKernelAccountAddress = async (
  parameters: PredictSliceWalletKernelAccountAddressParameters
) => (await deriveSliceWalletRecoveryBootstrap(parameters)).account
