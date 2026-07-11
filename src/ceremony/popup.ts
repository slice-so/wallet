import { bytesToHex, type Hex } from "viem"
import type { SliceWalletProtocolValue } from "../types"
import { parseSliceWalletCeremonyReadyMessage } from "./protocol"

export const createSliceWalletCeremonyNonce = (window: Window): Hex => {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

export const openSliceWalletCeremonyChannel = ({
  idOrigin,
  nonce,
  path,
  readyTimeoutMs = 10_000,
  window
}: {
  idOrigin: string
  nonce: Hex
  path: string
  readyTimeoutMs?: number
  window: Window
}) => {
  const origin = new URL(idOrigin).origin
  const url = new URL(path, origin)
  url.searchParams.set("nonce", nonce)
  const popup = window.open(
    url,
    "slice-wallet-ceremony",
    "popup,width=560,height=720"
  )
  if (popup === null) throw new Error("Slice Wallet popup was blocked.")

  return new Promise<{ popup: WindowProxy; port: MessagePort }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onReady)
        popup.close()
        reject(new Error("Slice Wallet popup bridge timed out."))
      }, readyTimeoutMs)
      const onReady = (event: MessageEvent<SliceWalletProtocolValue>) => {
        if (event.source !== popup || event.origin !== origin) return
        try {
          parseSliceWalletCeremonyReadyMessage(event.data)
        } catch {
          return
        }
        clearTimeout(timeout)
        window.removeEventListener("message", onReady)
        const channel = new MessageChannel()
        channel.port1.start()
        popup.postMessage(
          {
            nonce,
            type: "slice-wallet:ceremony-connect",
            version: 1
          },
          origin,
          [channel.port2]
        )
        resolve({ popup, port: channel.port1 })
      }
      window.addEventListener("message", onReady)
    }
  )
}

export const waitForSliceWalletCeremonyMessage = <Result>({
  parse,
  popup,
  port,
  timeoutMs
}: {
  parse: (value: SliceWalletProtocolValue) => Result
  popup: WindowProxy
  port: MessagePort
  timeoutMs: number
}) =>
  new Promise<Result>((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.close()
      popup.close()
      reject(new Error("Slice Wallet ceremony timed out."))
    }, timeoutMs)
    port.addEventListener(
      "message",
      (event: MessageEvent<SliceWalletProtocolValue>) => {
        clearTimeout(timeout)
        port.close()
        popup.close()
        try {
          resolve(parse(event.data))
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error("Slice Wallet ceremony response is invalid.")
          )
        }
      },
      { once: true }
    )
  })
