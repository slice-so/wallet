import type { Config, Connector } from "@wagmi/core"
import type { SliceWalletGrantPermissionsRequest } from "./provider"

export type SliceWalletWagmiPermissionParameters<
  config extends Config = Config
> = {
  config: config
  connector?: Connector
}

export type SliceWalletWagmiGrantPermissionParameters<
  config extends Config = Config
> = SliceWalletWagmiPermissionParameters<config> & {
  request: SliceWalletGrantPermissionsRequest
}

export type SliceWalletWagmiPermissionHookParameters<
  config extends Config = Config
> = SliceWalletWagmiPermissionParameters<config> & {
  origin: string
}
