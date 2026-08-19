import type {
  SliceWalletEip1193Provider,
  SliceWalletParameters
} from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"
import { announceSliceWalletProvider } from "./discovery"
import { createSliceWalletProviderInternal } from "./provider"

export const createSliceWalletProvider = (
  parameters?: SliceWalletParameters
): SliceWalletEip1193Provider => {
  const config = resolveCanonicalSliceWalletConfig(parameters)
  const provider = createSliceWalletProviderInternal(config)
  const stopAnnouncement =
    config.announce === true
      ? announceSliceWalletProvider({ provider })
      : () => {}

  return {
    ...provider,
    destroy: () => {
      stopAnnouncement()
      provider.destroy()
    }
  }
}
