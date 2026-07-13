import { describe, expect, it, mock } from "bun:test"
import type { SliceWalletProtocolValue } from "../types"
import {
  openSliceWalletCeremonyChannel,
  resolveSliceWalletCeremonyMode,
  waitForSliceWalletCeremonyMessage
} from "./popup"

const createSurface = () => {
  let closed = false
  const source = Object.create(null) as WindowProxy
  const surface = {
    close: mock(() => {
      closed = true
    }),
    get closed() {
      return closed
    },
    postMessage: mock(() => undefined),
    source
  }

  return { close: surface.close, surface }
}

describe("waitForSliceWalletCeremonyMessage", () => {
  it("rejects immediately when the user closes the ceremony", async () => {
    const channel = new MessageChannel()
    const { close, surface } = createSurface()
    channel.port1.start()

    const result = waitForSliceWalletCeremonyMessage({
      parse: (value) => value,
      port: channel.port1,
      surface,
      timeoutMs: 5_000
    })

    close()

    await expect(result).rejects.toThrow("User rejected the request")
    channel.port2.close()
  })

  it("still resolves a valid ceremony response", async () => {
    const channel = new MessageChannel()
    const { close, surface } = createSurface()
    const response = {
      type: "slice-wallet:test",
      version: 1
    } satisfies SliceWalletProtocolValue
    channel.port1.start()

    const result = waitForSliceWalletCeremonyMessage({
      parse: (value) => value,
      port: channel.port1,
      surface,
      timeoutMs: 5_000
    })
    channel.port2.postMessage(response)

    await expect(result).resolves.toEqual(response)
    expect(close).toHaveBeenCalledTimes(1)
    channel.port2.close()
  })
})

describe("openSliceWalletCeremonyChannel", () => {
  it("opens recovery enrollment in its dedicated popup window", async () => {
    const popup = Object.assign(Object.create(null) as WindowProxy, {
      close: mock(() => undefined),
      closed: false,
      postMessage: mock(() => undefined)
    })
    const open = mock(() => popup)
    let onMessage:
      | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
      | null = null
    const window = Object.assign(Object.create(null) as Window, {
      addEventListener: ((_type: "message", listener: typeof onMessage) => {
        onMessage = listener
      }) as Window["addEventListener"],
      matchMedia: () => ({ matches: false }),
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" },
      open,
      removeEventListener: ((_type: "message", listener: typeof onMessage) => {
        if (onMessage === listener) onMessage = null
      }) as Window["removeEventListener"]
    })

    const channelPromise = openSliceWalletCeremonyChannel({
      idOrigin: "https://recovery.id.slice.so",
      nonce: `0x${"11".repeat(32)}`,
      path: "/enroll",
      popupName: "slice-wallet-recovery",
      readyTimeoutMs: 100,
      window
    })
    queueMicrotask(() => {
      const readyEvent = Object.assign(
        Object.create(null) as MessageEvent<SliceWalletProtocolValue>,
        {
          data: {
            type: "slice-wallet:ceremony-ready",
            version: 1
          } satisfies SliceWalletProtocolValue,
          origin: "https://recovery.id.slice.so",
          source: popup
        }
      )
      onMessage?.(readyEvent)
    })

    const channel = await channelPromise

    expect(open).toHaveBeenCalledWith(
      expect.any(URL),
      "slice-wallet-recovery",
      "popup,width=560,height=720"
    )
    channel.port.close()
    channel.surface.close()
  })
})

describe("resolveSliceWalletCeremonyMode", () => {
  it("uses the iframe tray on supported secure browsers", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: true,
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" }
    })

    expect(
      resolveSliceWalletCeremonyMode({
        document: Object.create(null) as Document,
        mode: "auto",
        window
      })
    ).toBe("iframe")
  })

  it("uses a top-level surface on Safari", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: true,
      navigator: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.5 Safari/605.1.15"
      }
    })

    expect(
      resolveSliceWalletCeremonyMode({
        document: Object.create(null) as Document,
        mode: "auto",
        window
      })
    ).toBe("popup")
  })
})
