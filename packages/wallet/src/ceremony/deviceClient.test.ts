import { describe, expect, it, mock } from "bun:test"
import type { Address, Hex } from "viem"
import { createSliceWalletCeremonyBroker } from "./broker"
import { addSliceWalletDevice } from "./deviceClient"

const account = "0x8100000000000000000000000000000000000001" as Address

describe("device ceremony continuation", () => {
  it("defers a handoff enrollment and resumes the exact request", async () => {
    const broker = createSliceWalletCeremonyBroker()
    let onMessage: ((event: MessageEvent) => void) | null = null
    const popup = Object.assign(Object.create(null) as WindowProxy, {
      close: mock(() => undefined),
      closed: false,
      postMessage: mock(
        (message: { nonce?: Hex; type?: string }, _origin, transfer) => {
          if (message.type !== "slice-wallet:ceremony-connect") return
          const port = transfer[0] as MessagePort
          port.start()
          port.postMessage({
            account,
            action: "add",
            chainId: 8453,
            credentialIdHash: `0x${"22".repeat(32)}`,
            nonce: message.nonce,
            permissionId: "0x12345678",
            type: "slice-wallet:ceremony-device",
            userOperationHash: null,
            version: 1
          })
        }
      )
    })
    const window = Object.assign(Object.create(null) as Window, {
      addEventListener: ((
        _type: string,
        listener: (event: MessageEvent) => void
      ) => {
        onMessage = listener
      }) as Window["addEventListener"],
      crypto: globalThis.crypto,
      matchMedia: () => ({ matches: false }),
      navigator: {
        userActivation: { hasBeenActive: true, isActive: false },
        userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36"
      },
      open: () => {
        queueMicrotask(() =>
          onMessage?.(
            Object.assign(Object.create(null) as MessageEvent, {
              data: { type: "slice-wallet:ceremony-ready", version: 1 },
              origin: "https://id.slice.so",
              source: popup
            })
          )
        )
        return popup
      },
      removeEventListener: mock(() => undefined)
    })

    const original = addSliceWalletDevice({
      account,
      ceremonyBroker: broker,
      chainId: 8453,
      idOrigin: "https://id.slice.so",
      window
    })
    await Promise.resolve()
    expect(broker.getPending()?.kind).toBe("device_handoff")
    await expect(broker.continueInPopup()).resolves.toMatchObject({
      account,
      action: "add",
      chainId: 8453
    })
    await expect(original).resolves.toMatchObject({ action: "add" })
  })
})
