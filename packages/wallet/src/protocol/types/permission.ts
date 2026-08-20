import type { SliceWalletFrameSession } from "./frame"
import type { SliceKernelClient } from "./kernel"

export type BuildSliceWalletPermissionEnableTypedDataParameters = {
  address: `0x${string}`
  client: SliceKernelClient
  enableNonce?: bigint
  session: SliceWalletFrameSession
}
