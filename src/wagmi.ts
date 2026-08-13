import type { CreateConnectorFn } from "@wagmi/core"
import { sliceWalletConnector } from "./provider/connector"
import type { SliceWalletParameters, SliceWalletProvider } from "./types"

export const sliceWalletConnectorId = "slice-wallet"

export const sliceWallet = (
  parameters: SliceWalletParameters = {}
): CreateConnectorFn<SliceWalletProvider> =>
  sliceWalletConnector({ announce: false, ...parameters })

export * from "./wagmi/permissionActions"
