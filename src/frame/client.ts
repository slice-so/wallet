import type {
  SliceWalletFrameRequest,
  SliceWalletFrameResponse,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types"

const isFrameReadyMessage = (value: SliceWalletProtocolValue) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const input = value as {
    readonly [key: string]: SliceWalletProtocolValue
  }
  return (
    Object.keys(input).length === 2 &&
    input.type === "slice-wallet:frame-ready" &&
    input.version === 1
  )
}

export const connectSliceWalletSignerFrame = async ({
  document,
  frameUrl,
  timeoutMs = 15_000,
  window
}: {
  document: Document
  frameUrl: string
  timeoutMs?: number
  window: Window
}): Promise<SliceWalletSignerFrameClient> => {
  const url = new URL(frameUrl)
  const iframe = document.createElement("iframe")
  iframe.src = url.href
  iframe.title = "Slice Wallet"
  iframe.allow = ""
  iframe.style.border = "0"
  iframe.style.height = "1px"
  iframe.style.inset = "auto 16px 16px auto"
  iframe.style.position = "fixed"
  iframe.style.pointerEvents = "none"
  iframe.style.width = "1px"
  iframe.style.zIndex = "2147483647"

  const setContinuationVisible = (visible: boolean) => {
    iframe.style.height = visible ? "100dvh" : "1px"
    iframe.style.inset = visible ? "0" : "auto 16px 16px auto"
    iframe.style.pointerEvents = visible ? "auto" : "none"
    iframe.style.width = visible ? "100vw" : "1px"
  }

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Slice wallet frame failed to become ready."))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timeout)
      iframe.removeEventListener("error", onError)
      window.removeEventListener("message", onReady)
    }
    const onError = () => {
      cleanup()
      reject(new Error("Slice wallet frame failed to load."))
    }
    const onReady = (event: MessageEvent<SliceWalletProtocolValue>) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== url.origin ||
        !isFrameReadyMessage(event.data)
      ) {
        return
      }
      cleanup()
      resolve()
    }
    iframe.addEventListener("error", onError, { once: true })
    window.addEventListener("message", onReady)
  })
  document.body.appendChild(iframe)
  try {
    await ready
  } catch (error) {
    iframe.remove()
    throw error
  }
  if (iframe.contentWindow === null)
    throw new Error("Slice wallet frame is unavailable.")

  const channel = new MessageChannel()
  const pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (
        result: Extract<
          SliceWalletFrameResponse,
          { result: object | string | null }
        >["result"]
      ) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  channel.port1.addEventListener(
    "message",
    (event: MessageEvent<SliceWalletFrameResponse>) => {
      const response = event.data
      const request = pending.get(response.id)
      if (request === undefined) return
      clearTimeout(request.timeout)
      pending.delete(response.id)
      if ("error" in response) {
        request.reject(new Error(response.error.message))
      } else {
        request.resolve(response.result)
      }
    }
  )
  channel.port1.start()

  const send = (
    message:
      | SliceWalletFrameRequest
      | { id: string; method: "connect"; version: 1 }
  ) =>
    new Promise<
      Extract<
        SliceWalletFrameResponse,
        { result: object | string | null }
      >["result"]
    >((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(message.id)
        reject(
          new Error(`Slice wallet frame ${message.method} request timed out.`)
        )
      }, timeoutMs)
      pending.set(message.id, { reject, resolve, timeout })
      if (message.method === "connect") {
        iframe.contentWindow?.postMessage(message, url.origin, [channel.port2])
      } else {
        channel.port1.postMessage(message)
      }
    })

  await send({ id: window.crypto.randomUUID(), method: "connect", version: 1 })

  return {
    destroy: () => {
      for (const request of pending.values()) {
        clearTimeout(request.timeout)
        request.reject(new Error("Slice wallet frame client was destroyed."))
      }
      pending.clear()
      channel.port1.close()
      iframe.remove()
    },
    request: (request) =>
      send({
        ...request,
        id: window.crypto.randomUUID(),
        version: 1
      } as SliceWalletFrameRequest),
    setContinuationVisible
  }
}
