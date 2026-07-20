import { describe, expect, it } from "bun:test"
import type {
  SliceWalletEip6963ProviderDetail,
  SliceWalletProvider
} from "../types"
import { announceSliceWalletProvider } from "./discovery"

describe("EIP-6963 discovery", () => {
  it("announces immediately and again on provider requests", () => {
    const details: SliceWalletEip6963ProviderDetail[] = []
    const eventTypes: string[] = []
    let requestListener: EventListener | null = null
    const browserWindow = Object.assign(Object.create(null) as Window, {
      addEventListener: (type: string, listener: EventListener) => {
        if (type === "eip6963:requestProvider") requestListener = listener
      },
      crypto: globalThis.crypto,
      dispatchEvent: (event: Event) => {
        eventTypes.push(event.type)
        if (event instanceof CustomEvent) {
          details.push(event.detail as SliceWalletEip6963ProviderDetail)
        }
        return true
      },
      removeEventListener: (type: string, listener: EventListener) => {
        if (
          type === "eip6963:requestProvider" &&
          requestListener === listener
        ) {
          requestListener = null
        }
      }
    })
    const provider: SliceWalletProvider = {
      cancelPendingCeremony: () => undefined,
      continueInPopup: async () => "0x",
      connectWithSession: async () => ({
        account: "0x0000000000000000000000000000000000000001"
      }),
      destroy: () => undefined,
      on: () => undefined,
      pendingCeremony: null,
      removeListener: () => undefined,
      request: async () => undefined,
      requestSession: async () => ({ status: "preparation_failed" }),
      switchAccount: async () => "0x0000000000000000000000000000000000000001"
    }

    const stop = announceSliceWalletProvider({
      provider,
      window: browserWindow
    })
    const listener = requestListener as EventListener | null
    listener?.(new Event("eip6963:requestProvider"))

    expect(details).toHaveLength(2)
    expect(eventTypes).toEqual([
      "eip6963:announceProvider",
      "eip6963:announceProvider"
    ])
    expect(details[0]?.provider).toBe(provider)
    expect(details[0]?.info).toMatchObject({
      name: "Slice Wallet",
      rdns: "so.slice.wallet"
    })
    stop()
    expect(requestListener).toBeNull()
  })
})
