import { resolveCanonicalSliceWalletConfig } from "./provider/canonicalConfig"
import { sliceWalletConnector } from "./provider/connector"
import type { SliceWalletParameters } from "./types"

export const sliceWalletConnectorId = "slice-wallet"

export const sliceWallet = (parameters: SliceWalletParameters = {}) =>
  sliceWalletConnector(
    resolveCanonicalSliceWalletConfig({ announce: false, ...parameters })
  )

export * from "./wagmi/permissionActions"
