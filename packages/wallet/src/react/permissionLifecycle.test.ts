import { describe, expect, test } from "bun:test"
import type { Hex } from "viem"
import {
  SliceWalletExecutionRequestError,
  type SliceWalletExecutionSessionProof,
  type SliceWalletReplacementFinalization
} from "../execution"
import type { StoredSliceWalletPendingReplacement } from "../types/react"
import {
  getSliceWalletPendingRegistrationAction,
  resumeSliceWalletRegisteredReplacement,
  retrySliceWalletFinalityAction
} from "./permissionLifecycle"

const account = "0x0000000000000000000000000000000000000001" as const
const signer = "0x0000000000000000000000000000000000000002" as const
const coSigner = "0x0000000000000000000000000000000000000003" as const
const permissionId = "0x01020304" as const
const enableSignature = "0x01" as const
const userOperationHash = `0x${"11".repeat(32)}` as Hex
const expectedDisableCallHash = `0x${"22".repeat(32)}` as Hex

const registeredCheckoutReplacement = {
  allowanceUsdMicros: "100000000",
  phase: "registered",
  previousSessions: [],
  session: {
    accountAddress: account,
    coSignerAddress: coSigner,
    delegationId: "pending-delegation",
    enableSignature,
    expiresAt: "2099-01-01T00:00:00.000Z",
    kind: "checkout",
    permissionId,
    signerAddress: signer
  }
} as const satisfies StoredSliceWalletPendingReplacement

const registeringCheckoutReplacement = {
  phase: "registering",
  previousSessions: [],
  session: {
    accountAddress: account,
    coSignerAddress: coSigner,
    enableSignature,
    expiresAt: "2099-01-01T00:00:00.000Z",
    kind: "checkout",
    permissionId,
    signerAddress: signer
  }
} as const satisfies StoredSliceWalletPendingReplacement

const createProof = (attempt: number): SliceWalletExecutionSessionProof => ({
  challenge: `0x${attempt.toString(16).padStart(64, "0")}` as Hex,
  delegationId: "pending-delegation",
  expiresAt: 4_070_908_800,
  proofSignature: `0x${attempt.toString(16).padStart(2, "0")}` as Hex
})

describe("getSliceWalletPendingRegistrationAction", () => {
  test("discards an unrecorded frame session so a fresh grant can proceed", () => {
    expect(
      getSliceWalletPendingRegistrationAction({
        hasPendingFrame: true,
        replacement: null
      })
    ).toBe("discard_orphan")
    expect(
      getSliceWalletPendingRegistrationAction({
        hasPendingFrame: false,
        replacement: null
      })
    ).toBe("none")
  })

  test("keeps an in-flight registration conservative and resumes a completed registration", () => {
    expect(
      getSliceWalletPendingRegistrationAction({
        hasPendingFrame: true,
        replacement: registeringCheckoutReplacement
      })
    ).toBe("ambiguous")
    expect(
      getSliceWalletPendingRegistrationAction({
        hasPendingFrame: true,
        replacement: registeredCheckoutReplacement
      })
    ).toBe("resume")
  })
})

describe("resumeSliceWalletRegisteredReplacement", () => {
  test("commits and activates when the server finalizes idempotently", async () => {
    const events: string[] = []
    const outcome = await resumeSliceWalletRegisteredReplacement({
      activate: async () => {
        events.push("activate")
      },
      clear: async () => {
        events.push("clear")
      },
      commit: async () => {
        events.push("commit")
      },
      discard: async () => {
        events.push("discard")
      },
      finalize: () =>
        retrySliceWalletFinalityAction({
          createProof: async () => createProof(1),
          operation: { expectedDisableCallHash, userOperationHash },
          request: async () => {
            events.push("finalize")
          }
        }),
      notifyRevoked: () => {
        events.push("notify")
      },
      persist: async () => {
        events.push("persist")
      }
    })

    expect(outcome).toBe("resumed")
    expect(events).toEqual([
      "finalize",
      "commit",
      "persist",
      "clear",
      "activate"
    ])
  })

  test("discards local state and notifies when Slice ID removed the row", async () => {
    const events: string[] = []
    const outcome = await resumeSliceWalletRegisteredReplacement({
      activate: async () => {
        events.push("activate")
      },
      clear: async () => {
        events.push("clear")
      },
      commit: async () => {
        events.push("commit")
      },
      discard: async () => {
        events.push("discard")
      },
      finalize: async () => {
        events.push("finalize")
        throw new SliceWalletExecutionRequestError(
          404,
          "delegation_not_found",
          "revoked"
        )
      },
      notifyRevoked: () => {
        events.push("notify")
      },
      persist: async () => {
        events.push("persist")
      }
    })

    expect(outcome).toBe("revoked")
    expect(events).toEqual(["finalize", "discard", "clear", "notify"])
  })

  test("resumes a predecessor-less registration without operation hashes", async () => {
    const requests: SliceWalletReplacementFinalization[] = []
    let committed = false
    const outcome = await resumeSliceWalletRegisteredReplacement({
      activate: async () => {},
      clear: async () => {},
      commit: async () => {
        committed = true
      },
      discard: async () => {},
      finalize: () =>
        retrySliceWalletFinalityAction({
          createProof: async () => createProof(1),
          operation: {},
          request: async (proof) => {
            requests.push(proof)
          }
        }),
      notifyRevoked: () => {},
      persist: async () => {}
    })

    expect(outcome).toBe("resumed")
    expect(committed).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.userOperationHash).toBeUndefined()
    expect(requests[0]?.expectedDisableCallHash).toBeUndefined()
  })
})

describe("retrySliceWalletFinalityAction", () => {
  test("uses a fresh proof while retrying the same confirmed management operation", async () => {
    const delays: number[] = []
    const requests: SliceWalletReplacementFinalization[] = []
    let attempt = 0

    await retrySliceWalletFinalityAction({
      createProof: async () => createProof(++attempt),
      now: () => 1_000,
      operation: { expectedDisableCallHash, userOperationHash },
      request: async (proof) => {
        requests.push(proof)
        if (requests.length === 1) {
          throw new SliceWalletExecutionRequestError(
            409,
            "revocation_not_final",
            "one confirmation"
          )
        }
      },
      sleep: async (durationMs) => {
        delays.push(durationMs)
      }
    })

    expect(requests).toHaveLength(2)
    expect(requests[0]?.challenge).not.toBe(requests[1]?.challenge)
    expect(requests[0]?.proofSignature).not.toBe(requests[1]?.proofSignature)
    expect(
      requests.map(({ expectedDisableCallHash: callHash }) => callHash)
    ).toEqual([expectedDisableCallHash, expectedDisableCallHash])
    expect(requests.map(({ userOperationHash: hash }) => hash)).toEqual([
      userOperationHash,
      userOperationHash
    ])
    expect(delays).toEqual([250])
  })

  test("does not retry non-finality failures", async () => {
    let attempts = 0
    const failure = new SliceWalletExecutionRequestError(
      401,
      "bad_session_proof",
      "invalid proof"
    )

    await expect(
      retrySliceWalletFinalityAction({
        createProof: async () => createProof(++attempts),
        operation: { expectedDisableCallHash, userOperationHash },
        request: async () => {
          throw failure
        }
      })
    ).rejects.toBe(failure)
    expect(attempts).toBe(1)
  })
})
