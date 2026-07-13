import { describe, expect, it, mock } from "bun:test"
import type { SliceWalletProtocolValue } from "../types"
import { waitForSliceWalletCeremonyMessage } from "./popup"

const createPopup = () => {
  let closed = false
  const popup = Object.assign(Object.create(null) as WindowProxy, {
    close: mock(() => {
      closed = true
    })
  })
  Object.defineProperty(popup, "closed", { get: () => closed })

  return { close: popup.close, popup }
}

describe("waitForSliceWalletCeremonyMessage", () => {
  it("rejects immediately when the user closes the ceremony", async () => {
    const channel = new MessageChannel()
    const { close, popup } = createPopup()
    channel.port1.start()

    const result = waitForSliceWalletCeremonyMessage({
      parse: (value) => value,
      popup,
      port: channel.port1,
      timeoutMs: 5_000
    })

    close()

    await expect(result).rejects.toThrow("User rejected the request")
    channel.port2.close()
  })

  it("still resolves a valid ceremony response", async () => {
    const channel = new MessageChannel()
    const { close, popup } = createPopup()
    const response = {
      type: "slice-wallet:test",
      version: 1
    } satisfies SliceWalletProtocolValue
    channel.port1.start()

    const result = waitForSliceWalletCeremonyMessage({
      parse: (value) => value,
      popup,
      port: channel.port1,
      timeoutMs: 5_000
    })
    channel.port2.postMessage(response)

    await expect(result).resolves.toEqual(response)
    expect(close).toHaveBeenCalledTimes(1)
    channel.port2.close()
  })
})
