import { afterAll, describe, expect, mock, test } from "bun:test"
import { anvil } from "viem/chains"
import { createSliceWalletCeremonyBroker } from "../ceremony/broker"
import type { SliceWalletEip1193Provider } from "../types"

const account = "0x1000000000000000000000000000000000000001" as const
const broker = createSliceWalletCeremonyBroker()
const destroy = mock(() => broker.cancel())
const on: SliceWalletEip1193Provider["on"] = () => undefined
const removeListener: SliceWalletEip1193Provider["removeListener"] = () =>
  undefined
const internalProvider = {
  cancelPendingCeremony: broker.cancel,
  connectWithSession: async () => ({ account }),
  continueInPopup: broker.continueInPopup,
  destroy,
  on,
  get pendingCeremony() {
    return broker.getPending()
  },
  removeListener,
  request: async () => undefined,
  requestSession: async () => ({ status: "preparation_failed" as const }),
  subscribePendingCeremony: broker.subscribe,
  switchAccount: async () => account
} satisfies SliceWalletEip1193Provider
const createSliceWalletProviderInternal = mock(() => internalProvider)

mock.module("./provider", () => ({ createSliceWalletProviderInternal }))

const { createSliceWalletProvider } = await import("./canonicalProvider")

afterAll(() => mock.restore())

describe("canonical Slice Wallet provider", () => {
  test("tracks the internal pending ceremony without changing forwarded identities", async () => {
    const provider = createSliceWalletProvider({
      announce: false,
      chainIds: [anvil.id],
      defaultChainId: anvil.id,
      idOrigin: "http://localhost:3003",
      transports: {
        [anvil.id]: {
          bundlerUrl: "http://localhost:3001/api/bundler",
          rpcUrl: "http://localhost:8545"
        }
      }
    })
    const pending = broker
      .defer({
        kind: "connect",
        reason: "popup_blocked",
        resume: async () => `0x${"11".repeat(32)}` as const
      })
      .catch(() => null)

    expect(provider.pendingCeremony).toMatchObject({
      kind: "connect",
      reason: "popup_blocked"
    })
    expect(provider.cancelPendingCeremony).toBe(
      internalProvider.cancelPendingCeremony
    )
    expect(provider.connectWithSession).toBe(
      internalProvider.connectWithSession
    )
    expect(provider.continueInPopup).toBe(internalProvider.continueInPopup)
    expect(provider.on).toBe(internalProvider.on)
    expect(provider.removeListener).toBe(internalProvider.removeListener)
    expect(provider.request).toBe(internalProvider.request)
    expect(provider.requestSession).toBe(internalProvider.requestSession)
    expect(provider.subscribePendingCeremony).toBe(
      internalProvider.subscribePendingCeremony
    )
    expect(provider.switchAccount).toBe(internalProvider.switchAccount)

    provider.destroy()
    await pending

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(provider.pendingCeremony).toBeNull()
  })
})
