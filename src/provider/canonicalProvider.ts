import type { SliceWalletParameters, SliceWalletProvider } from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"
import { announceSliceWalletProvider } from "./discovery"
import { createSliceWalletProviderInternal } from "./provider"

export const createSliceWalletProvider = (
  parameters?: SliceWalletParameters
): SliceWalletProvider => {
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
