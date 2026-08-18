import type { CreateConnectorFn } from "@wagmi/core"
import { sliceWalletConnector } from "./provider/connector"
import type { SliceWalletEip1193Provider, SliceWalletParameters } from "./types"

export const sliceWalletConnectorId = "slice-wallet"

export const sliceWallet = (
  parameters: SliceWalletParameters = {}
): CreateConnectorFn<SliceWalletEip1193Provider> =>
  sliceWalletConnector({ announce: false, ...parameters })

export * from "./wagmi/permissionActions"
