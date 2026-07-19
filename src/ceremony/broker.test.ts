import { describe, expect, it } from "bun:test"
import type { Hex } from "viem"
import type { SliceWalletPendingCeremonyKind } from "../types"
import {
  createSliceWalletCeremonyBroker,
  SliceWalletUserGestureRequiredError
} from "./broker"

const kinds = [
  "connect",
  "device_enroll",
  "device_handoff",
  "device_promote",
  "grant",
  "recovery",
  "root_sign"
] as const satisfies readonly SliceWalletPendingCeremonyKind[]
const result = `0x${"11".repeat(32)}` as Hex

describe("Slice Wallet ceremony broker", () => {
  for (const kind of kinds) {
    it(`resumes the exact ${kind} intent and settles its caller once`, async () => {
      const broker = createSliceWalletCeremonyBroker()
      let resumes = 0
      const original = broker.defer({
        kind,
        reason: "user_activation_expired",
        resume: async () => {
          resumes += 1
          return result
        }
      })
      expect(broker.getPending()?.kind).toBe(kind)
      const first = broker.continueInPopup()
      const duplicate = broker.continueInPopup()
      expect(duplicate).toBe(first)
      await expect(first).resolves.toBe(result)
      await expect(original).resolves.toBe(result)
      expect(resumes).toBe(1)
      expect(broker.getPending()).toBeNull()
    })
  }

  it("keeps the intent after a blocked popup and resumes on a later gesture", async () => {
    const broker = createSliceWalletCeremonyBroker()
    let blocked = true
    const original = broker.defer({
      kind: "root_sign",
      reason: "user_activation_expired",
      resume: async () => {
        if (blocked)
          throw new SliceWalletUserGestureRequiredError("popup_blocked")
        return result
      }
    })
    await expect(broker.continueInPopup()).rejects.toThrow("top-level")
    expect(broker.getPending()?.reason).toBe("popup_blocked")
    blocked = false
    await expect(broker.continueInPopup()).resolves.toBe(result)
    await expect(original).resolves.toBe(result)
  })

  it("rejects the original promise on cancellation and timeout", async () => {
    const cancelled = createSliceWalletCeremonyBroker()
    const cancelledResult = cancelled.defer({
      kind: "grant",
      reason: "visibility_unstable",
      resume: async () => result
    })
    cancelled.cancel()
    await expect(cancelledResult).rejects.toThrow("cancelled")

    const timedOut = createSliceWalletCeremonyBroker({ timeoutMs: 1 })
    const timedOutResult = timedOut.defer({
      kind: "recovery",
      reason: "popup_blocked",
      resume: async () => result
    })
    await expect(timedOutResult).rejects.toThrow("timed out")
    expect(timedOut.getPending()).toBeNull()
  })
})
