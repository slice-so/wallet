import { sliceWalletChainManifests } from "@slicekit/wallet-primitives/server"
import { createConnector } from "@wagmi/core"
import { type Address, isAddress } from "viem"
import { anvil } from "viem/chains"
import type {
  SliceWalletEip1193Provider,
  SliceWalletParameters,
  SliceWalletProviderValue
} from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"
import {
  announceSliceWalletProvider,
  sliceWalletProviderIcon
} from "./discovery"
import { createSliceWalletProviderInternal } from "./provider"

type SliceWalletConnectorRuntime = Pick<
  SliceWalletProviderConfig,
  "document" | "fetch" | "requireAdmittedChain" | "storage" | "window"
>

export const sliceWalletConnector = (
  parameters: SliceWalletParameters,
  runtime: SliceWalletConnectorRuntime = {}
) =>
  createConnector<SliceWalletEip1193Provider>((config) => {
    let provider: SliceWalletEip1193Provider | null = null
    let stopAnnouncement: (() => void) | null = null
    const inheritedChainIds = config.chains
      .map((chain) => chain.id)
      .filter(
        (chainId) =>
          chainId !== anvil.id &&
          sliceWalletChainManifests[chainId]?.admitted === true
      )
    const providerConfig = {
      ...resolveCanonicalSliceWalletConfig({
        ...parameters,
        chainIds: parameters.chainIds ?? inheritedChainIds
      }),
      ...runtime
    }
    const onAccountsChanged = (accounts: readonly string[]) => {
      if (accounts.length === 0) {
        config.emitter.emit("disconnect")
        return
      }
      config.emitter.emit("change", {
        accounts: accounts.filter((account) =>
          isAddress(account)
        ) as readonly Address[]
      })
    }
    const onChainChanged = (chainId: string) => {
      config.emitter.emit("change", { chainId: Number(chainId) })
    }
    const onDisconnect = () => {
      config.emitter.emit("disconnect")
    }
    const destroyProvider = () => {
      if (provider === null) return
      provider.removeListener("accountsChanged", onAccountsChanged)
      provider.removeListener("chainChanged", onChainChanged)
      provider.removeListener("disconnect", onDisconnect)
      stopAnnouncement?.()
      stopAnnouncement = null
      provider.destroy()
      provider = null
    }
    const getProvider = () => {
      if (provider !== null) return provider
      provider = createSliceWalletProviderInternal(providerConfig)
      provider.on("accountsChanged", onAccountsChanged)
      provider.on("chainChanged", onChainChanged)
      provider.on("disconnect", onDisconnect)
      if (providerConfig.announce === true) {
        stopAnnouncement = announceSliceWalletProvider({
          provider,
          ...(providerConfig.window === undefined
            ? {}
            : { window: providerConfig.window })
        })
      }
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
    const parseConnectResult = (
      value: SliceWalletProviderValue | undefined
    ) => {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !Array.isArray(Reflect.get(value, "accounts")) ||
        Reflect.get(value, "accounts").length !== 1
      ) {
        throw new Error("Slice Wallet returned an invalid connection result.")
      }
      const connected = Reflect.get(value, "accounts")[0] as
        | SliceWalletProviderValue
        | undefined
      if (
        typeof connected !== "object" ||
        connected === null ||
        Array.isArray(connected)
      ) {
        throw new Error("Slice Wallet returned an invalid connected account.")
      }
      const connectedRecord = connected as {
        readonly [key: string]: SliceWalletProviderValue | undefined
      }
      if (
        typeof connectedRecord.address !== "string" ||
        !isAddress(connectedRecord.address) ||
        typeof connectedRecord.capabilities !== "object" ||
        connectedRecord.capabilities === null ||
        Array.isArray(connectedRecord.capabilities)
      ) {
        throw new Error("Slice Wallet returned an invalid connected account.")
      }
      return {
        account: connectedRecord.address,
        capabilities: connectedRecord.capabilities as {
          readonly [key: string]: SliceWalletProviderValue | undefined
        }
      }
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
        getProvider()
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
        await switchPromise
        const sessionPromise =
          providerConfig.session === undefined || isReconnecting === true
            ? null
            : getProvider().connectWithSession({
                prepare: providerConfig.session.prepare
              })
        const sessionResult = await sessionPromise
        if (sessionResult !== null) {
          await providerConfig.session?.onSession?.(sessionResult.session)
        }
        let grantedPermission: SliceWalletProviderValue | undefined
        let accounts: readonly Address[]
        if (
          sessionResult === null &&
          isReconnecting !== true &&
          providerConfig.grantPermissions !== undefined
        ) {
          const { account, capabilities } = parseConnectResult(
            await getProvider().request({
              method: "wallet_connect",
              params: [
                {
                  capabilities: {
                    grantPermissions: providerConfig.grantPermissions
                  },
                  version: "1"
                }
              ]
            })
          )
          accounts = [account]
          grantedPermission = capabilities.grantPermissions
        } else {
          accounts =
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
          if (
            sessionResult !== null &&
            providerConfig.grantPermissions !== undefined
          ) {
            try {
              grantedPermission = await getProvider().request({
                method: "wallet_grantPermissions",
                params: [
                  {
                    expiry: providerConfig.grantPermissions.expiry,
                    permissions: providerConfig.grantPermissions.permissions
                  }
                ]
              })
            } catch (error) {
              if (providerConfig.grantPermissions.optional !== true) {
                await getProvider()
                  .request({ method: "wallet_disconnect" })
                  .catch(() => undefined)
                throw error
              }
            }
          }
        }
        if (accounts.length === 0) {
          throw new Error("Slice Wallet is not connected.")
        }
        return {
          accounts: (withCapabilities
            ? accounts.map((address) => ({
                address,
                capabilities: {
                  atomic: { status: "supported" },
                  ...(grantedPermission === undefined
                    ? {}
                    : { grantPermissions: grantedPermission })
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
        destroyProvider()
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
          !providerConfig.chains.some(
            (candidate) => candidate.chain.id === chainId
          )
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
        onAccountsChanged(accounts)
      },
      onChainChanged(chainId) {
        onChainChanged(chainId)
      },
      onConnect(connectInfo) {
        config.emitter.emit("connect", {
          accounts: [],
          chainId: Number(connectInfo.chainId)
        })
      },
      onDisconnect() {
        onDisconnect()
      }
    }
  })
