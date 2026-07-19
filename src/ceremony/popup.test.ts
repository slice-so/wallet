import { describe, expect, it, mock } from "bun:test"
import {
  sliceWalletBrokerRequiredDialogRoutes,
  sliceWalletDialogCeremonyRoutes
} from "../ceremonyRoutes"
import type { SliceWalletProtocolValue } from "../types"
import { SliceWalletUserGestureRequiredError } from "./broker"
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

  it("waits without a deadline when timeoutMs is omitted", async () => {
    const channel = new MessageChannel()
    const { surface } = createSurface()
    const response = {
      type: "slice-wallet:no-timeout",
      version: 1
    } satisfies SliceWalletProtocolValue
    channel.port1.start()

    const result = waitForSliceWalletCeremonyMessage({
      parse: (value) => value,
      port: channel.port1,
      surface
    })
    channel.port2.postMessage(response)

    await expect(result).resolves.toEqual(response)
    channel.port2.close()
  })
})

describe("openSliceWalletCeremonyChannel", () => {
  it("keeps the direct public opener enforcing broker-required routes", async () => {
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
      isSecureContext: true,
      location: { hostname: "shop.slice.so", protocol: "https:" },
      matchMedia: () => ({ matches: false }),
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" },
      open,
      removeEventListener: ((_type: "message", listener: typeof onMessage) => {
        if (onMessage === listener) onMessage = null
      }) as Window["removeEventListener"]
    })

    const channelPromise = openSliceWalletCeremonyChannel({
      document: Object.create(null) as Document,
      idOrigin: "https://id.slice.so",
      mode: "iframe",
      nonce: `0x${"11".repeat(32)}`,
      path: "/ceremony/connect",
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
          origin: "https://id.slice.so",
          source: popup
        }
      )
      onMessage?.(readyEvent)
    })

    const channel = await channelPromise

    expect(open).toHaveBeenCalledWith(
      expect.any(URL),
      "slice-wallet-ceremony",
      "popup,width=560,height=720"
    )
    channel.port.close()
    channel.surface.close()
  })

  it("creates the iframe surface with the complete capability boundary", async () => {
    const source = Object.assign(Object.create(null) as WindowProxy, {
      postMessage: mock(() => undefined)
    })
    const sandboxTokens: string[] = []
    const iframe = Object.assign(Object.create(null) as HTMLIFrameElement, {
      allow: "",
      contentWindow: source,
      referrerPolicy: "",
      sandbox: {
        add: (...tokens: string[]) => sandboxTokens.push(...tokens)
      },
      src: "",
      style: {},
      title: ""
    })
    const dialog = Object.assign(Object.create(null) as HTMLDivElement, {
      appendChild: mock(() => iframe),
      dataset: {},
      remove: mock(() => undefined),
      setAttribute: mock(() => undefined),
      style: {}
    })
    const appendChild = mock(() => dialog)
    const document = Object.assign(Object.create(null) as Document, {
      body: { appendChild },
      createElement: ((tagName: string) =>
        tagName === "iframe" ? iframe : dialog) as Document["createElement"]
    })
    let onMessage:
      | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
      | null = null
    const window = Object.assign(Object.create(null) as Window, {
      addEventListener: ((type: string, listener: EventListener) => {
        if (type === "message") {
          onMessage = listener as (
            event: MessageEvent<SliceWalletProtocolValue>
          ) => void
        }
      }) as Window["addEventListener"],
      isSecureContext: true,
      location: { hostname: "shop.slice.so", protocol: "https:" },
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" },
      removeEventListener: mock(() => undefined)
    })
    const nonce = `0x${"22".repeat(32)}` as const

    const channelPromise = openSliceWalletCeremonyChannel({
      document,
      idOrigin: "https://id.slice.so",
      mode: "iframe",
      nonce,
      path: "/ceremony/grant",
      readyTimeoutMs: 100,
      window
    })
    queueMicrotask(() =>
      onMessage?.(
        Object.assign(
          Object.create(null) as MessageEvent<SliceWalletProtocolValue>,
          {
            data: {
              type: "slice-wallet:ceremony-ready",
              version: 1
            } satisfies SliceWalletProtocolValue,
            origin: "https://id.slice.so",
            source
          }
        )
      )
    )

    const channel = await channelPromise

    expect(sandboxTokens).toEqual([
      "allow-downloads",
      "allow-forms",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-same-origin",
      "allow-scripts"
    ])
    expect(iframe.referrerPolicy).toBe("no-referrer")
    expect(iframe.allow).toBe(
      "publickey-credentials-create https://id.slice.so; publickey-credentials-get https://id.slice.so"
    )
    expect(iframe.src).toContain("/dialog/grant")
    expect(dialog.style.pointerEvents).toBe("auto")
    expect(iframe.style.pointerEvents).toBe("auto")
    expect(dialog.style.zIndex).toBe("2147483647")
    expect(appendChild).toHaveBeenCalledTimes(1)
    channel.port.close()
    channel.surface.close()
  })

  it("classifies only iframe readiness timeouts as unstable visibility", async () => {
    const popup = Object.assign(Object.create(null) as WindowProxy, {
      close: mock(() => undefined),
      closed: false,
      postMessage: mock(() => undefined)
    })
    const popupWindow = Object.assign(Object.create(null) as Window, {
      addEventListener: mock(() => undefined),
      matchMedia: () => ({ matches: false }),
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" },
      open: () => popup,
      removeEventListener: mock(() => undefined)
    })
    await expect(
      openSliceWalletCeremonyChannel({
        idOrigin: "https://id.slice.so",
        nonce: `0x${"33".repeat(32)}`,
        path: "/ceremony/root",
        readyTimeoutMs: 1,
        window: popupWindow
      })
    ).rejects.toThrow("bridge timed out")

    const iframe = Object.assign(Object.create(null) as HTMLIFrameElement, {
      contentWindow: Object.create(null) as WindowProxy,
      sandbox: { add: () => undefined },
      style: {}
    })
    const dialog = Object.assign(Object.create(null) as HTMLDivElement, {
      appendChild: () => iframe,
      dataset: {},
      remove: () => undefined,
      setAttribute: () => undefined,
      style: {}
    })
    const document = Object.assign(Object.create(null) as Document, {
      body: { appendChild: () => dialog },
      createElement: ((tagName: string) =>
        tagName === "iframe" ? iframe : dialog) as Document["createElement"]
    })
    const iframeWindow = Object.assign(Object.create(null) as Window, {
      addEventListener: mock(() => undefined),
      isSecureContext: true,
      location: { hostname: "shop.slice.so", protocol: "https:" },
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" },
      removeEventListener: mock(() => undefined)
    })
    const error = await openSliceWalletCeremonyChannel({
      document,
      idOrigin: "https://id.slice.so",
      mode: "iframe",
      nonce: `0x${"44".repeat(32)}`,
      path: "/ceremony/root",
      readyTimeoutMs: 1,
      window: iframeWindow
    }).catch((error: Error) => error)
    expect(error).toBeInstanceOf(SliceWalletUserGestureRequiredError)
    expect((error as SliceWalletUserGestureRequiredError).reason).toBe(
      "visibility_unstable"
    )
  })
})

describe("resolveSliceWalletCeremonyMode", () => {
  it("uses the shared route contract and rejects unknown or handoff routes", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: true,
      location: { hostname: "shop.slice.so", protocol: "https:" },
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" }
    })
    const brokerRequired = new Set<string>(
      sliceWalletBrokerRequiredDialogRoutes
    )
    for (const route of sliceWalletDialogCeremonyRoutes) {
      expect(
        resolveSliceWalletCeremonyMode({
          brokerAvailable: true,
          document: Object.create(null) as Document,
          mode: "iframe",
          path: `/ceremony/${route}`,
          window
        })
      ).toBe("iframe")
      if (brokerRequired.has(route)) {
        expect(
          resolveSliceWalletCeremonyMode({
            document: Object.create(null) as Document,
            mode: "iframe",
            path: `/ceremony/${route}`,
            window
          })
        ).toBe("popup")
      }
    }
    for (const route of ["device-handoff", "unknown"]) {
      expect(
        resolveSliceWalletCeremonyMode({
          brokerAvailable: true,
          document: Object.create(null) as Document,
          mode: "iframe",
          path: `/ceremony/${route}`,
          window
        })
      ).toBe("popup")
    }
  })

  it("never embeds without a document and lets explicit iframe override Safari", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: false,
      location: { hostname: "shop.slice.so", protocol: "https:" },
      navigator: {
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.5 Safari/605.1.15"
      }
    })
    expect(
      resolveSliceWalletCeremonyMode({
        brokerAvailable: true,
        mode: "iframe",
        path: "/ceremony/connect",
        window
      })
    ).toBe("popup")
    expect(
      resolveSliceWalletCeremonyMode({
        brokerAvailable: true,
        document: Object.create(null) as Document,
        mode: "iframe",
        path: "/ceremony/connect",
        window
      })
    ).toBe("iframe")
  })

  it("allows contracted non-grant routes in the iframe tray", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: true,
      location: { hostname: "shop.slice.so", protocol: "https:" },
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" }
    })

    expect(
      resolveSliceWalletCeremonyMode({
        document: Object.create(null) as Document,
        mode: "iframe",
        path: "/ceremony/root",
        window
      })
    ).toBe("iframe")
  })

  it("uses the iframe tray on supported secure browsers", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: true,
      location: { hostname: "shop.slice.so", protocol: "https:" },
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
      location: { hostname: "shop.slice.so", protocol: "https:" },
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

  it("uses a top-level surface on non-loopback HTTP origins", () => {
    const window = Object.assign(Object.create(null) as Window, {
      isSecureContext: false,
      location: { hostname: "shop.example", protocol: "http:" },
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" }
    })

    expect(
      resolveSliceWalletCeremonyMode({
        document: Object.create(null) as Document,
        mode: "iframe",
        path: "/ceremony/grant",
        window
      })
    ).toBe("popup")
  })

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "permits the iframe tray on HTTP loopback host %s",
    (hostname) => {
      const window = Object.assign(Object.create(null) as Window, {
        isSecureContext: true,
        location: { hostname, protocol: "http:" },
        navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" }
      })

      expect(
        resolveSliceWalletCeremonyMode({
          document: Object.create(null) as Document,
          mode: "auto",
          path: "/ceremony/grant",
          window
        })
      ).toBe("iframe")
    }
  )
})
