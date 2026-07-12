import type {
  SliceWalletFrameRequest,
  SliceWalletFrameResponse,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types"

const logFrameClient = (
  stage: string,
  details: Record<string, boolean | number | string> = {}
) => console.info(`[slice-wallet-frame-client] ${stage}`, details)

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
    iframe.style.height = visible ? "72px" : "1px"
    iframe.style.pointerEvents = visible ? "auto" : "none"
    iframe.style.width = visible ? "320px" : "1px"
  }

  const ready = new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    logFrameClient("ready.wait.start", { origin: url.origin })
    const timeout = setTimeout(() => {
      cleanup()
      logFrameClient("ready.wait.timeout", {
        durationMs: Date.now() - startedAt
      })
      reject(new Error("Slice wallet frame failed to become ready."))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timeout)
      iframe.removeEventListener("error", onError)
      window.removeEventListener("message", onReady)
    }
    const onError = () => {
      cleanup()
      logFrameClient("ready.wait.error", {
        durationMs: Date.now() - startedAt
      })
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
      logFrameClient("ready.wait.done", {
        durationMs: Date.now() - startedAt
      })
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
      method: string
      startedAt: number
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  channel.port1.addEventListener(
    "message",
    (event: MessageEvent<SliceWalletFrameResponse>) => {
      const response = event.data
      const request = pending.get(response.id)
      if (request === undefined) {
        logFrameClient("response.unmatched", { id: response.id })
        return
      }
      clearTimeout(request.timeout)
      pending.delete(response.id)
      logFrameClient("response.received", {
        durationMs: Date.now() - request.startedAt,
        id: response.id,
        method: request.method,
        status: "error" in response ? "error" : "success"
      })
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
      const startedAt = Date.now()
      logFrameClient("request.send", {
        id: message.id,
        method: message.method,
        transport: message.method === "connect" ? "window" : "message-port"
      })
      const timeout = setTimeout(() => {
        pending.delete(message.id)
        logFrameClient("request.timeout", {
          durationMs: Date.now() - startedAt,
          id: message.id,
          method: message.method
        })
        reject(
          new Error(`Slice wallet frame ${message.method} request timed out.`)
        )
      }, timeoutMs)
      pending.set(message.id, {
        method: message.method,
        reject,
        resolve,
        startedAt,
        timeout
      })
      if (message.method === "connect") {
        iframe.contentWindow?.postMessage(message, url.origin, [channel.port2])
      } else {
        channel.port1.postMessage(message)
      }
    })

  await send({ id: window.crypto.randomUUID(), method: "connect", version: 1 })

  return {
    destroy: () => {
      logFrameClient("client.destroy", { pendingRequests: pending.size })
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
