import type {
  SliceWalletFrameRequest,
  SliceWalletFrameResponse,
  SliceWalletSignerFrameClient
} from "../types"

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
  document.body.appendChild(iframe)

  const setContinuationVisible = (visible: boolean) => {
    iframe.style.height = visible ? "72px" : "1px"
    iframe.style.pointerEvents = visible ? "auto" : "none"
    iframe.style.width = visible ? "320px" : "1px"
  }

  await new Promise<void>((resolve, reject) => {
    iframe.addEventListener("load", () => resolve(), { once: true })
    iframe.addEventListener(
      "error",
      () => reject(new Error("Slice wallet frame failed to load.")),
      {
        once: true
      }
    )
  })
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
        reject(new Error("Slice wallet frame request timed out."))
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
