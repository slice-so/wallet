import { describe, expect, it } from "bun:test"
import type { SliceWalletProtocolValue } from "@slicekit/wallet-primitives"
import {
  acquireSliceWalletSignerFrame,
  connectSliceWalletSignerFrame
} from "./client"

class FixtureMessagePort extends EventTarget {
  peer: FixtureMessagePort | null = null

  close() {}

  postMessage(message: SliceWalletProtocolValue) {
    queueMicrotask(() => {
      this.peer?.dispatchEvent(new MessageEvent("message", { data: message }))
    })
  }

  start() {}
}

class FixtureMessageChannel {
  readonly port1: FixtureMessagePort
  readonly port2: FixtureMessagePort

  constructor() {
    this.port1 = new FixtureMessagePort()
    this.port2 = new FixtureMessagePort()
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

const createBrowserFixture = (
  responseFor: (id: string) => SliceWalletProtocolValue | null = (id) => ({
    id,
    result: null,
    version: 1
  })
) => {
  const windowListeners = new Set<(event: MessageEvent) => void>()
  let removed = 0
  let requestId = 0
  let framePort: MessagePort | null = null
  const contentWindow = Object.assign(Object.create(null) as Window, {
    postMessage: (
      message: { id: string },
      _origin: string,
      ports: MessagePort[]
    ) => {
      const port = ports[0]
      if (port === undefined) throw new Error("Missing signer frame port.")
      framePort = port
      port.addEventListener(
        "message",
        (event: MessageEvent<{ id: string }>) => {
          const response = responseFor(event.data.id)
          if (response !== null) port.postMessage(response)
        }
      )
      port.start()
      const response = responseFor(message.id)
      if (response !== null) port.postMessage(response)
    }
  })
  const iframeListeners = new Map<string, () => void>()
  const iframe = Object.assign(Object.create(null) as HTMLIFrameElement, {
    addEventListener: (type: string, listener: () => void) =>
      iframeListeners.set(type, listener),
    allow: "",
    contentWindow,
    remove: () => {
      removed += 1
    },
    removeEventListener: (type: string) => iframeListeners.delete(type),
    src: "",
    style: Object.create(null) as CSSStyleDeclaration,
    title: ""
  })
  const browserWindow = Object.assign(Object.create(null) as Window, {
    addEventListener: (
      _type: "message",
      listener: (event: MessageEvent) => void
    ) => windowListeners.add(listener),
    removeEventListener: (
      _type: "message",
      listener: (event: MessageEvent) => void
    ) => windowListeners.delete(listener)
  })
  Object.defineProperty(browserWindow, "crypto", {
    value: {
      randomUUID: () => {
        requestId += 1
        return `request-${requestId}`
      }
    }
  })
  const document = Object.assign(Object.create(null) as Document, {
    body: {
      appendChild: () => {
        queueMicrotask(() => {
          for (const listener of windowListeners) {
            const event = new MessageEvent("message", {
              data: { type: "slice-wallet:frame-ready", version: 1 },
              origin: "https://id.slice.so"
            })
            Object.defineProperty(event, "source", { value: contentWindow })
            listener(event)
          }
        })
      }
    },
    createElement: () => iframe
  })
  return {
    document,
    getRemovedCount: () => removed,
    postFrameMessage: (message: SliceWalletProtocolValue) => {
      if (framePort === null) throw new Error("Signer frame is not connected.")
      framePort.postMessage(message)
    },
    window: browserWindow
  }
}

describe("shared signer frame leases", () => {
  it("retains the frame while a second acquisition is awaiting its client", async () => {
    const fixture = createBrowserFixture()
    const parameters = {
      document: fixture.document,
      frameUrl: "https://id.slice.so/frame",
      window: fixture.window
    }
    const first = await acquireSliceWalletSignerFrame(parameters)
    const secondPromise = acquireSliceWalletSignerFrame(parameters)

    first.destroy()
    const second = await secondPromise

    expect(fixture.getRemovedCount()).toBe(0)
    second.destroy()
    expect(fixture.getRemovedCount()).toBe(1)
  })

  it("rejects a matched malformed response instead of leaving it pending", async () => {
    const nativeMessageChannel = Object.getOwnPropertyDescriptor(
      globalThis,
      "MessageChannel"
    )
    Object.defineProperty(globalThis, "MessageChannel", {
      configurable: true,
      value: FixtureMessageChannel
    })
    const responseIds: string[] = []
    try {
      const fixture = createBrowserFixture(
        (id): SliceWalletProtocolValue | null => {
          responseIds.push(id)
          if (id === "request-2") return null
          return { id, result: null, version: 1 }
        }
      )
      const client = await connectSliceWalletSignerFrame({
        document: fixture.document,
        frameUrl: "https://id.slice.so/frame",
        timeoutMs: 100,
        window: fixture.window
      })

      const response = client.request({
        method: "getAccountLockState",
        params: { account: "0x1111111111111111111111111111111111111111" }
      })
      await Bun.sleep(5)
      expect(responseIds).toEqual(["request-1", "request-2"])
      fixture.postFrameMessage({
        error: { code: "invalid_request" },
        id: "request-2",
        version: 1
      })
      await expect(response).rejects.toThrow("invalid response")
      client.destroy()
    } finally {
      if (nativeMessageChannel !== undefined) {
        Object.defineProperty(
          globalThis,
          "MessageChannel",
          nativeMessageChannel
        )
      }
    }
  })
})
