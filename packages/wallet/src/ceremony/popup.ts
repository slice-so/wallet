import type { SliceWalletProtocolValue } from "@slicekit/wallet-primitives"
import { bytesToHex, type Hex } from "viem"
import {
  sliceWalletBrokerRequiredDialogRoutes,
  sliceWalletDialogCeremonyRoutes
} from "../ceremonyRoutes"
import type { SliceWalletCeremonyMode } from "../types"
import { SliceWalletUserRejectedRequestError } from "../userRejectedRequest"
import { SliceWalletUserGestureRequiredError } from "./broker"
import { parseSliceWalletCeremonyReadyMessage } from "./protocol"

const ceremonyClosedPollIntervalMs = 100

type SliceWalletCeremonySurface = {
  close: () => void
  readonly closed: boolean
  postMessage: (
    message: SliceWalletProtocolValue,
    targetOrigin: string,
    transfer: Transferable[]
  ) => void
  reveal: () => void
  source: WindowProxy
}

export const createSliceWalletCeremonyNonce = (window: Window): Hex => {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

const isSafariWebKit = (window: Window) => {
  const userAgent = window.navigator.userAgent
  return (
    /iP(?:ad|hone|od)/.test(userAgent) ||
    (/Safari/.test(userAgent) &&
      !/(?:Chrome|Chromium|CriOS|Edg|FxiOS|OPiOS)/.test(userAgent))
  )
}

const isIframeCapableOrigin = (location: Location) =>
  location.protocol === "https:" ||
  (location.protocol === "http:" &&
    (location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.hostname === "[::1]"))

const dialogRoutes = new Set<string>(sliceWalletDialogCeremonyRoutes)
const brokerRequiredDialogRoutes = new Set<string>(
  sliceWalletBrokerRequiredDialogRoutes
)

const getCeremonyRoute = (path: string) => {
  const match = /^\/ceremony\/([^/]+)$/.exec(
    new URL(path, "https://slice.invalid").pathname
  )
  return match?.[1]
}

export const resolveSliceWalletCeremonyMode = ({
  brokerAvailable = false,
  document,
  mode,
  path,
  window
}: {
  brokerAvailable?: boolean
  document?: Document
  mode: SliceWalletCeremonyMode
  path?: string
  window: Window
}): Exclude<SliceWalletCeremonyMode, "auto"> => {
  let route: string | undefined
  if (path !== undefined) {
    route = getCeremonyRoute(path)
    if (route === undefined || !dialogRoutes.has(route)) return "popup"
  }
  if (mode === "popup") return mode
  if (!isIframeCapableOrigin(window.location)) return "popup"
  if (
    route !== undefined &&
    brokerRequiredDialogRoutes.has(route) &&
    !brokerAvailable
  ) {
    return "popup"
  }
  if (mode === "iframe") return document === undefined ? "popup" : mode
  if (
    document === undefined ||
    window.isSecureContext === false ||
    isSafariWebKit(window)
  ) {
    return "popup"
  }
  return "iframe"
}

const popupFeatures = (window: Window) => {
  const mobile =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 640px)").matches
  return mobile ? undefined : "popup,width=560,height=720"
}

const createPopupSurface = ({
  name,
  url,
  window
}: {
  name: string
  url: URL
  window: Window
}): SliceWalletCeremonySurface => {
  const popup = window.open(url, name, popupFeatures(window))
  if (popup === null) {
    throw new SliceWalletUserGestureRequiredError("popup_blocked")
  }
  return {
    close: () => popup.close(),
    get closed() {
      return popup.closed
    },
    postMessage: (message, targetOrigin, transfer) =>
      popup.postMessage(message, targetOrigin, transfer),
    reveal: () => undefined,
    source: popup
  }
}

const createIframeSurface = ({
  document,
  origin,
  url,
  window
}: {
  document: Document
  origin: string
  url: URL
  window: Window
}): SliceWalletCeremonySurface => {
  const root = document.createElement("div")
  root.dataset.sliceWalletDialog = ""
  root.setAttribute("aria-label", "Slice Wallet")
  root.setAttribute("aria-modal", "true")
  root.setAttribute("role", "dialog")
  Object.assign(root.style, {
    height: "100dvh",
    inset: "0",
    pointerEvents: "auto",
    position: "fixed",
    width: "100vw",
    zIndex: "2147483647"
  })

  const iframe = document.createElement("iframe")
  iframe.allow = [
    `publickey-credentials-create ${origin}`,
    `publickey-credentials-get ${origin}`
  ].join("; ")
  iframe.referrerPolicy = "no-referrer"
  iframe.sandbox.add(
    "allow-downloads",
    "allow-forms",
    "allow-popups",
    "allow-popups-to-escape-sandbox",
    "allow-same-origin",
    "allow-scripts"
  )
  iframe.src = url.href
  iframe.title = "Slice Wallet"
  Object.assign(iframe.style, {
    border: "0",
    height: "100%",
    pointerEvents: "auto",
    visibility: "hidden",
    width: "100%"
  })
  root.appendChild(iframe)
  document.body.appendChild(root)

  const source = iframe.contentWindow
  if (source === null) {
    root.remove()
    throw new Error("Slice Wallet dialog is unavailable.")
  }

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    window.removeEventListener("keydown", onKeyDown)
    root.remove()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close()
  }
  window.addEventListener("keydown", onKeyDown)

  return {
    close,
    get closed() {
      return closed
    },
    postMessage: (message, targetOrigin, transfer) =>
      source.postMessage(message, targetOrigin, transfer),
    reveal: () => {
      iframe.style.visibility = "visible"
    },
    source
  }
}

export const openSliceWalletCeremonyChannel = ({
  brokerAvailable = false,
  document,
  idOrigin,
  mode = "popup",
  nonce,
  path,
  popupName = "slice-wallet-ceremony",
  readyTimeoutMs = 10_000,
  window
}: {
  brokerAvailable?: boolean
  document?: Document
  idOrigin: string
  mode?: SliceWalletCeremonyMode
  nonce: Hex
  path: string
  popupName?: string
  readyTimeoutMs?: number
  window: Window
}) => {
  const origin = new URL(idOrigin).origin
  const resolvedMode = resolveSliceWalletCeremonyMode({
    brokerAvailable,
    document,
    mode,
    path,
    window
  })
  const url = new URL(path, origin)
  if (resolvedMode === "iframe" && getCeremonyRoute(url.href) !== undefined) {
    url.pathname = url.pathname.replace(/^\/ceremony\//, "/dialog/")
  }
  url.searchParams.set("nonce", nonce)
  let surface: SliceWalletCeremonySurface
  if (resolvedMode === "iframe") {
    if (document === undefined) {
      throw new Error("Slice Wallet dialog requires a document.")
    }
    surface = createIframeSurface({ document, origin, url, window })
  } else {
    surface = createPopupSurface({ name: popupName, url, window })
  }

  return new Promise<{
    port: MessagePort
    surface: SliceWalletCeremonySurface
  }>((resolve, reject) => {
    const cleanup = () => {
      clearInterval(closedPoll)
      clearTimeout(timeout)
      window.removeEventListener("message", onReady)
    }
    const timeout = setTimeout(() => {
      cleanup()
      surface.close()
      reject(
        resolvedMode === "iframe"
          ? new SliceWalletUserGestureRequiredError("visibility_unstable")
          : new Error("Slice Wallet ceremony bridge timed out.")
      )
    }, readyTimeoutMs)
    const closedPoll = setInterval(() => {
      if (!surface.closed) return
      cleanup()
      reject(new SliceWalletUserRejectedRequestError())
    }, ceremonyClosedPollIntervalMs)
    const onReady = (event: MessageEvent<SliceWalletProtocolValue>) => {
      if (event.source !== surface.source || event.origin !== origin) return
      try {
        parseSliceWalletCeremonyReadyMessage(event.data)
      } catch {
        return
      }
      cleanup()
      const channel = new MessageChannel()
      channel.port1.start()
      surface.postMessage(
        {
          nonce,
          type: "slice-wallet:ceremony-connect",
          version: 1
        },
        origin,
        [channel.port2]
      )
      surface.reveal()
      resolve({ port: channel.port1, surface })
    }
    window.addEventListener("message", onReady)
  })
}

export const waitForSliceWalletCeremonyMessage = <Result>({
  parse,
  port,
  surface,
  timeoutMs
}: {
  parse: (value: SliceWalletProtocolValue) => Result
  port: MessagePort
  surface: SliceWalletCeremonySurface
  timeoutMs?: number
}) =>
  new Promise<Result>((resolve, reject) => {
    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout)
      clearInterval(closedPoll)
      port.removeEventListener("message", onMessage)
    }
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            cleanup()
            port.close()
            surface.close()
            reject(new Error("Slice Wallet ceremony timed out."))
          }, timeoutMs)
    const closedPoll = setInterval(() => {
      if (!surface.closed) return

      cleanup()
      port.close()
      reject(new SliceWalletUserRejectedRequestError())
    }, ceremonyClosedPollIntervalMs)
    const onMessage = (event: MessageEvent<SliceWalletProtocolValue>) => {
      cleanup()
      port.close()
      surface.close()
      try {
        resolve(parse(event.data))
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Slice Wallet ceremony response is invalid.")
        )
      }
    }
    port.addEventListener("message", onMessage, { once: true })
  })
