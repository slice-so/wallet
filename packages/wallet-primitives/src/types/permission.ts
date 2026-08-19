import type { Chain, Client, Transport } from "viem"
import type { SliceWalletFrameSession } from "./frame"

export type SliceWalletProtocolClient = Client<Transport, Chain | undefined>

export type BuildSliceWalletPermissionEnableTypedDataParameters = {
  address: `0x${string}`
  client: SliceWalletProtocolClient
  session: SliceWalletFrameSession
}
