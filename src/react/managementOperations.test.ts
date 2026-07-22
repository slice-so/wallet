import { describe, expect, test } from "bun:test"
import { SliceWalletEnablementError } from "./managementLifecycle"
import {
  classifyManagementPendingAction,
  getManagementDisablePreflight,
  getManagementHydrationGuard,
  rejectRevokedManagementPermission,
  runManagementCommitPhase,
  runManagementRegistrationPhase
} from "./managementOperations"

describe("management operation policies", () => {
  test("keeps registering ambiguous and validates registered targets", () => {
    expect(
      classifyManagementPendingAction({
        hasMatchingCommittedFrame: false,
        hasPendingFrame: true,
        pendingPhase: "registering",
        pendingMatchesRegistered: false,
        targetMatches: true
      })
    ).toBe("ambiguous")
    expect(
      classifyManagementPendingAction({
        hasMatchingCommittedFrame: false,
        hasPendingFrame: true,
        pendingMatchesRegistered: false,
        pendingPhase: "registered",
        targetMatches: true
      })
    ).toBe("ambiguous")
    expect(
      classifyManagementPendingAction({
        hasMatchingCommittedFrame: false,
        hasPendingFrame: true,
        pendingPhase: "registered",
        pendingMatchesRegistered: true,
        targetMatches: false
      })
    ).toBe("complete-old-then-continue")
    expect(
      classifyManagementPendingAction({
        hasMatchingCommittedFrame: true,
        hasPendingFrame: false,
        pendingPhase: "registered",
        pendingMatchesRegistered: false,
        targetMatches: true
      })
    ).toBe("complete-bookkeeping")
    expect(
      classifyManagementPendingAction({
        hasMatchingCommittedFrame: false,
        hasPendingFrame: false,
        pendingPhase: "registered",
        pendingMatchesRegistered: false,
        targetMatches: true
      })
    ).toBe("ambiguous")
  })

  test("blocks unsafe disable states", () => {
    expect(
      getManagementDisablePreflight({
        committedMatchesPending: false,
        pendingPhase: null,
        pendingReadable: false,
        targetMatches: true
      })
    ).toBe("storage-unavailable")
    expect(
      getManagementDisablePreflight({
        committedMatchesPending: false,
        pendingPhase: "registered",
        pendingReadable: true,
        targetMatches: true
      })
    ).toBe("blocked")
    expect(
      getManagementDisablePreflight({
        committedMatchesPending: true,
        pendingPhase: "registered",
        pendingReadable: true,
        targetMatches: false
      })
    ).toBe("state-changed")
    expect(
      getManagementDisablePreflight({
        committedMatchesPending: true,
        pendingPhase: "registered",
        pendingReadable: true,
        targetMatches: true
      })
    ).toBe("reconcile")
  })

  test("fails closed when pending replacement storage cannot be read", () => {
    expect(
      getManagementHydrationGuard({ pendingPhase: null, readable: false })
    ).toBe("storage-unavailable")
    expect(
      getManagementHydrationGuard({
        pendingPhase: "registering",
        readable: true
      })
    ).toBe("skip")
    expect(
      getManagementHydrationGuard({ pendingPhase: null, readable: true })
    ).toBe("hydrate")
  })

  test("reports revoked resume state and rejects with hydrate recovery", () => {
    try {
      rejectRevokedManagementPermission()
      throw new Error("Expected revoked permission rejection.")
    } catch (caught) {
      expect(caught).toBeInstanceOf(SliceWalletEnablementError)
      if (!(caught instanceof SliceWalletEnablementError)) throw caught
      expect(caught.message).toBe(
        "This management permission was revoked from Slice ID. Enable it again to continue."
      )
      expect(caught.recoveryMode).toBe("hydrate")
    }
  })
})

describe("management phase orchestration", () => {
  test("persists registration before checking identity for finalization", async () => {
    const events: string[] = []
    let current = true
    await expect(
      runManagementRegistrationPhase({
        assertCurrent: () => {
          if (!current) throw new Error("changed")
        },
        finalize: async () => {
          events.push("finalize")
        },
        persistRegistered: async () => {
          events.push("persist")
        },
        register: async () => {
          current = false
          events.push("register")
          return "registered"
        }
      })
    ).rejects.toThrow("changed")
    expect(events).toEqual(["register", "persist"])
  })

  test("reconciles commit rejection and completes strict bookkeeping", async () => {
    const events: string[] = []
    await runManagementCommitPhase({
      activate: async () => {
        events.push("activate")
      },
      assertCurrent: () => undefined,
      clearPending: async () => {
        events.push("clear")
      },
      commit: async () => {
        throw new Error("transport")
      },
      persist: async () => {
        events.push("persist")
      },
      probeCommitted: async () => true
    })
    expect(events).toEqual(["persist", "clear", "activate"])
  })

  test("does not activate when strict pending cleanup fails", async () => {
    let activated = false
    const failure = runManagementCommitPhase({
      activate: async () => {
        activated = true
      },
      assertCurrent: () => undefined,
      clearPending: async () => {
        throw new Error("storage")
      },
      commit: async () => undefined,
      persist: async () => undefined,
      probeCommitted: async () => false
    })
    await expect(failure).rejects.toBeInstanceOf(SliceWalletEnablementError)
    expect(activated).toBe(false)
  })

  test("finishes bookkeeping but suppresses activation after identity changes during commit", async () => {
    const events: string[] = []
    let current = true
    const operation = runManagementCommitPhase({
      activate: async () => {
        events.push("activate")
      },
      assertCurrent: () => {
        if (!current) throw new Error("wallet changed")
      },
      clearPending: async () => {
        events.push("clear")
      },
      commit: async () => {
        events.push("commit")
        current = false
      },
      persist: async () => {
        events.push("persist")
      },
      probeCommitted: async () => false
    })
    await expect(operation).rejects.toThrow("wallet changed")
    expect(events).toEqual(["commit", "persist", "clear"])
  })

  test("preserves pending state when commit probing or strict persistence fails", async () => {
    let cleared = false
    await expect(
      runManagementCommitPhase({
        activate: async () => undefined,
        assertCurrent: () => undefined,
        clearPending: async () => {
          cleared = true
        },
        commit: async () => {
          throw new Error("transport")
        },
        persist: async () => undefined,
        probeCommitted: async () => false
      })
    ).rejects.toBeInstanceOf(SliceWalletEnablementError)
    expect(cleared).toBe(false)

    await expect(
      runManagementCommitPhase({
        activate: async () => undefined,
        assertCurrent: () => undefined,
        clearPending: async () => {
          cleared = true
        },
        commit: async () => undefined,
        persist: async () => {
          throw new Error("storage")
        },
        probeCommitted: async () => false
      })
    ).rejects.toBeInstanceOf(SliceWalletEnablementError)
    expect(cleared).toBe(false)
  })

  test("classifies activation failure as hydrate recovery", async () => {
    try {
      await runManagementCommitPhase({
        activate: async () => {
          throw new Error("activate")
        },
        assertCurrent: () => undefined,
        clearPending: async () => undefined,
        commit: async () => undefined,
        persist: async () => undefined,
        probeCommitted: async () => false
      })
      throw new Error("Expected activation to fail.")
    } catch (caught) {
      expect(caught).toBeInstanceOf(SliceWalletEnablementError)
      if (!(caught instanceof SliceWalletEnablementError)) throw caught
      expect(caught.recoveryMode).toBe("hydrate")
    }
  })
})
