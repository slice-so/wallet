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
    const parseChainId = (value: SliceWalletProviderValue | undefined) => {
      if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
        throw new Error("Slice Wallet returned an invalid chain id.")
      }
      const chainId = BigInt(value)
      if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Slice Wallet returned an invalid chain id.")
      }
      return Number(chainId)
    }

    return {
      icon: sliceWalletProviderIcon,
      id: "slice-wallet",
      name: "Slice ID",
      rdns: "so.slice.wallet",
      // Embedded wallets report as injected so wallet-list UIs invoke connect()
      // instead of treating them as unavailable browser extensions.
      type: "injected",
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
      async connect({ chainId, isReconnecting, withCapabilities } = {}) {
        let switchPromise:
          | Promise<SliceWalletProviderValue | undefined>
          | undefined
        if (chainId !== undefined) {
          switchPromise = getProvider().request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${chainId.toString(16)}` }]
          })
        }
        const sessionPromise =
          parameters.session === undefined || isReconnecting === true
            ? null
            : getProvider().connectWithSession({
                audience: parameters.session.audience,
                prepare: parameters.session.prepare,
                ...(parameters.session.scopes === undefined
                  ? {}
                  : { scopes: parameters.session.scopes }),
                ...(parameters.session.ttlSeconds === undefined
                  ? {}
                  : { ttlSeconds: parameters.session.ttlSeconds })
              })
        await switchPromise
        const sessionResult = await sessionPromise
        if (sessionResult !== null) {
          await parameters.session?.onSession?.(sessionResult.session)
        }
        const accounts =
          sessionResult === null
            ? parseAccounts(
                await getProvider().request({
                  method:
                    isReconnecting === true
                      ? "eth_accounts"
                      : "eth_requestAccounts"
                })
              )
            : [sessionResult.account]
        if (accounts.length === 0) {
          throw new Error("Slice Wallet is not connected.")
        }
        return {
          accounts: (withCapabilities
            ? accounts.map((address) => ({
                address,
                capabilities: {
                  atomic: { status: "supported" }
                }
              }))
            : accounts) as never,
          chainId: parseChainId(
            await getProvider().request({ method: "eth_chainId" })
          )
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
        return parseChainId(
          await getProvider().request({ method: "eth_chainId" })
        )
      },
      async getProvider() {
        return getProvider()
      },
      async isAuthorized() {
        return (await this.getAccounts()).length > 0
      },
      async switchAccount() {
        return getProvider().switchAccount()
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find(
          (candidate) => candidate.id === chainId
        )
        if (
          chain === undefined ||
          !parameters.chains.some((candidate) => candidate.chain.id === chainId)
        ) {
          throw new Error("Slice Wallet is not configured for that chain.")
        }
        await getProvider().request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${chainId.toString(16)}` }]
        })
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
