import { createConnector } from "@wagmi/core"
import { type Address, isAddress } from "viem"
import type { SliceWalletProvider, SliceWalletProviderValue } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import {
  announceSliceWalletProvider,
  sliceWalletProviderIcon
} from "./discovery"
import { createSliceWalletProviderInternal } from "./provider"

export const sliceWalletConnector = (parameters: SliceWalletProviderConfig) => {
  let provider: SliceWalletProvider | null = null
  let stopAnnouncement: (() => void) | null = null

  return createConnector<SliceWalletProvider>((config) => {
    const getProvider = () => {
      provider ??= createSliceWalletProviderInternal(parameters)
      return provider
    }

    const parseAccounts = (value: SliceWalletProviderValue | undefined) => {
      if (!Array.isArray(value) || value.some((item) => !isAddress(item))) {
        throw new Error("Slice Wallet returned an invalid account list.")
      }
      return value as readonly Address[]
    }

    return {
      icon: sliceWalletProviderIcon,
      id: "slice-wallet",
      name: "Slice Wallet",
      rdns: "so.slice.wallet",
      type: "slice-wallet",
      async setup() {
        const walletProvider = getProvider()
        if (parameters.announce === true && stopAnnouncement === null) {
          stopAnnouncement = announceSliceWalletProvider({
            provider: walletProvider,
            ...(parameters.window === undefined
              ? {}
              : { window: parameters.window })
          })
        }
        walletProvider.on("accountsChanged", (accounts) =>
          this.onAccountsChanged([...accounts])
        )
        walletProvider.on("chainChanged", (chainId) =>
          this.onChainChanged(chainId)
        )
        walletProvider.on("disconnect", (error) =>
          this.onDisconnect(new Error(error.message))
        )
      },
      async connect({ chainId, withCapabilities } = {}) {
        if (chainId !== undefined && chainId !== parameters.chain.id) {
          throw new Error("Slice Wallet is not configured for that chain.")
        }
        const accounts = parseAccounts(
          await getProvider().request({ method: "eth_requestAccounts" })
        )
        return {
          accounts: (withCapabilities
            ? accounts.map((address) => ({
                address,
                capabilities: {
                  atomic: { status: "supported" }
                }
              }))
            : accounts) as never,
          chainId: parameters.chain.id
        }
      },
      async disconnect() {
        await getProvider().request({ method: "wallet_disconnect" })
      },
      async getAccounts() {
        return parseAccounts(
          await getProvider().request({ method: "eth_accounts" })
        )
      },
      async getChainId() {
        return parameters.chain.id
      },
      async getProvider() {
        return getProvider()
      },
      async isAuthorized() {
        return (await this.getAccounts()).length > 0
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find(
          (candidate) => candidate.id === chainId
        )
        if (chain === undefined || chainId !== parameters.chain.id) {
          throw new Error("Slice Wallet is not configured for that chain.")
        }
        return chain
      },
      onAccountsChanged(accounts) {
        if (accounts.length === 0) {
          config.emitter.emit("disconnect")
          return
        }
        config.emitter.emit("change", {
          accounts: accounts.filter((account) =>
            isAddress(account)
          ) as readonly Address[]
        })
      },
      onChainChanged(chainId) {
        config.emitter.emit("change", { chainId: Number(chainId) })
      },
      onConnect(connectInfo) {
        config.emitter.emit("connect", {
          accounts: [],
          chainId: Number(connectInfo.chainId)
        })
      },
      onDisconnect() {
        config.emitter.emit("disconnect")
      }
    }
  })
}
