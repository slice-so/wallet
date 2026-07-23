import { describe, expect, it } from "bun:test"
import { acquireSliceWalletSignerFrame } from "./client"

const createBrowserFixture = () => {
  const windowListeners = new Set<(event: MessageEvent) => void>()
  let removed = 0
  let requestId = 0
  const contentWindow = Object.assign(Object.create(null) as Window, {
    postMessage: (
      message: { id: string },
      _origin: string,
      ports: MessagePort[]
    ) => {
      const port = ports[0]
      if (port === undefined) throw new Error("Missing signer frame port.")
      port.addEventListener("message", (event: MessageEvent<{ id: string }>) =>
        port.postMessage({ id: event.data.id, result: null })
      )
      port.start()
      port.postMessage({ id: message.id, result: null })
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
})
