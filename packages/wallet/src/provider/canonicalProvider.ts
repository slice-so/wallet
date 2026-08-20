import type {
  SliceWalletEip1193Provider,
  SliceWalletParameters
} from "../types"
import { resolveCanonicalSliceWalletConfig } from "./canonicalConfig"
import { createSliceWalletProviderInternal } from "./provider"

export const createSliceWalletProvider = (
  parameters?: SliceWalletParameters
): SliceWalletEip1193Provider => {
  const config = resolveCanonicalSliceWalletConfig(parameters)
  const provider = createSliceWalletProviderInternal(config)

  return {
    cancelPendingCeremony: provider.cancelPendingCeremony,
    connectWithExtension: provider.connectWithExtension,
    continueInPopup: provider.continueInPopup,
    destroy: provider.destroy,
    get pendingCeremony() {
      return provider.pendingCeremony
    },
    on: provider.on,
    removeListener: provider.removeListener,
    request: provider.request,
    requestExtension: provider.requestExtension,
    subscribePendingCeremony: provider.subscribePendingCeremony,
    switchAccount: provider.switchAccount
  }
}
