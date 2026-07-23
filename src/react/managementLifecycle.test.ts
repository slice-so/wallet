import { describe, expect, test } from "bun:test"
import { getAddress } from "viem"
import {
  createManagementLifecycle,
  SliceWalletEnablementError,
  shouldHandleManagementMutation
} from "./managementLifecycle"

const account = "0x0000000000000000000000000000000000000001" as const
const otherAccount = "0x0000000000000000000000000000000000000002" as const

const deferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("management lifecycle", () => {
  test("serializes a mutation behind the full hydration body", async () => {
    const pause = deferred()
    const events: string[] = []
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => undefined
    })
    lifecycle.setAccount(account)
    const hydration = lifecycle.runHydration(account, async () => {
      events.push("hydrate-start")
      await pause.promise
      events.push("hydrate-cleanup")
    })
    const mutation = lifecycle.runMutation({
      account,
      slicerId: 7,
      task: async () => events.push("mutation")
    })
    await Promise.resolve()
    expect(events).toEqual(["hydrate-start"])
    pause.resolve()
    await Promise.all([hydration, mutation])
    expect(events).toEqual(["hydrate-start", "hydrate-cleanup", "mutation"])
  })

  test("keeps H1, mutation, H2 pending until the latest hydration settles", async () => {
    const h1Pause = deferred()
    const h2Pause = deferred()
    const statuses: string[] = []
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => undefined
    })
    lifecycle.setAccount(account)
    lifecycle.subscribe(() => statuses.push(lifecycle.getSnapshot().status))
    const h1 = lifecycle.runHydration(account, () => h1Pause.promise)
    const mutation = lifecycle.runMutation({
      account,
      slicerId: 7,
      task: async () => undefined
    })
    const h2 = lifecycle.runHydration(account, () => h2Pause.promise)
    h1Pause.resolve()
    await h1
    await mutation
    expect(lifecycle.getSnapshot().status).toBe("pending")
    h2Pause.resolve()
    await h2
    expect(lifecycle.getSnapshot().status).toBe("settled")
    expect(statuses.slice(0, -1)).not.toContain("settled")
  })

  test("invalidates in-flight work on an account switch", async () => {
    const pause = deferred()
    let identityChanges = 0
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => {
        identityChanges += 1
      }
    })
    lifecycle.setAccount(account)
    const mutation = lifecycle.runMutation({
      account,
      slicerId: 7,
      task: async (control) => {
        await pause.promise
        control.assertCurrent()
      }
    })
    await Promise.resolve()
    lifecycle.setAccount(otherAccount)
    pause.resolve()
    await expect(mutation).rejects.toBeInstanceOf(SliceWalletEnablementError)
    expect(identityChanges).toBe(2)
  })

  test("queues hydrate recovery before rethrow and preserves pending when asked", async () => {
    let hydrations = 0
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => {
        hydrations += 1
      },
      onIdentityChange: () => undefined
    })
    lifecycle.setAccount(account)
    await expect(
      lifecycle.runMutation({
        account,
        slicerId: 7,
        task: async () => {
          throw new SliceWalletEnablementError("activate", "hydrate")
        }
      })
    ).rejects.toThrow("activate")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hydrations).toBe(1)
    await expect(
      lifecycle.runMutation({
        account,
        slicerId: 7,
        task: async () => {
          throw new SliceWalletEnablementError("pending", "preserve-pending")
        }
      })
    ).rejects.toThrow("pending")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hydrations).toBe(1)
  })

  test("tracks fail-closed storage errors and clears them on retry", async () => {
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => undefined
    })
    lifecycle.setAccount(account)
    await lifecycle.runHydration(account, async (control) => {
      control.markStorageUnavailable()
    })
    expect(lifecycle.getSnapshot()).toEqual({
      error: "storage-unavailable",
      status: "settled"
    })
    await lifecycle.retryHydration(account)
    expect(lifecycle.getSnapshot()).toEqual({
      error: null,
      status: "settled"
    })
    lifecycle.setAccount(otherAccount)
    expect(lifecycle.getSnapshot()).toEqual({ error: null, status: "idle" })
  })

  test("settles markNothingToHydrate directly for the active account", () => {
    const statuses: string[] = []
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => undefined
    })
    lifecycle.setAccount(account)
    lifecycle.subscribe(() => statuses.push(lifecycle.getSnapshot().status))

    lifecycle.markNothingToHydrate(account)

    expect(lifecycle.getSnapshot()).toEqual({ error: null, status: "settled" })
    expect(statuses).toEqual(["pending", "settled"])
  })

  test("serializes disable work as a management mutation", async () => {
    const pause = deferred()
    const events: string[] = []
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => undefined
    })
    lifecycle.setAccount(account)
    const hydration = lifecycle.runHydration(account, async () => {
      events.push("hydrate")
      await pause.promise
    })
    const disable = lifecycle.runMutation({
      account,
      slicerId: 7,
      task: async () => events.push("disable")
    })

    await Promise.resolve()
    expect(events).toEqual(["hydrate"])
    pause.resolve()
    await Promise.all([hydration, disable])
    expect(events).toEqual(["hydrate", "disable"])
  })

  test("keeps one lifecycle identity for equivalent account updates", async () => {
    const stableAccount = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const
    let identityChanges = 0
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => {
        identityChanges += 1
      }
    })
    const sourceId = lifecycle.sourceId

    lifecycle.setAccount(stableAccount)
    lifecycle.setAccount(getAddress(stableAccount))
    await lifecycle.runHydration(stableAccount)

    expect(identityChanges).toBe(1)
    expect(lifecycle.sourceId).toBe(sourceId)
    expect(lifecycle.getSnapshot().status).toBe("settled")
  })

  test("external same-account mutations invalidate and rehydrate", async () => {
    let hydrations = 0
    const identityChanges: (number | undefined)[] = []
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => {
        hydrations += 1
      },
      onIdentityChange: (slicerId) => identityChanges.push(slicerId)
    })
    lifecycle.setAccount(account)
    lifecycle.handleExternalMutation(otherAccount, 7)
    expect(hydrations).toBe(0)
    lifecycle.handleExternalMutation(account, 7)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(hydrations).toBe(1)
    expect(identityChanges).toEqual([undefined, 7])
  })

  test("broadcasts the mutated slicer identity", async () => {
    const messages: object[] = []
    const lifecycle = createManagementLifecycle({
      chainId: 8453,
      hydrate: async () => undefined,
      onIdentityChange: () => undefined,
      onMutation: (message) => messages.push(message)
    })
    lifecycle.setAccount(account)

    await lifecycle.runMutation({
      account,
      slicerId: 0,
      task: async () => undefined
    })

    expect(messages).toEqual([
      {
        account,
        chainId: 8453,
        outcome: "success",
        slicerId: 0,
        sourceId: lifecycle.sourceId
      }
    ])
  })

  test("serializes coordinators through the shared document lock", async () => {
    const existingLocks = Object.getOwnPropertyDescriptor(navigator, "locks")
    let lockQueue = Promise.resolve()
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: <Result>(
          _name: string,
          callback: () => Promise<Result>
        ): Promise<Result> => {
          const result = lockQueue.then(callback, callback)
          lockQueue = result.then(
            () => undefined,
            () => undefined
          )
          return result
        }
      }
    })
    try {
      const pause = deferred()
      const events: string[] = []
      const create = () =>
        createManagementLifecycle({
          chainId: 8453,
          hydrate: async () => undefined,
          onIdentityChange: () => undefined
        })
      const first = create()
      const second = create()
      first.setAccount(account)
      second.setAccount(account)
      const firstMutation = first.runMutation({
        account,
        slicerId: 7,
        task: async () => {
          events.push("first-start")
          await pause.promise
          events.push("first-end")
        }
      })
      const secondMutation = second.runMutation({
        account,
        slicerId: 9,
        task: async () => events.push("second")
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(events).toEqual(["first-start"])
      pause.resolve()
      await Promise.all([firstMutation, secondMutation])
      expect(events).toEqual(["first-start", "first-end", "second"])
    } finally {
      if (existingLocks === undefined) {
        Reflect.deleteProperty(navigator, "locks")
      } else {
        Object.defineProperty(navigator, "locks", existingLocks)
      }
    }
  })

  test("filters self and unrelated cross-tab messages case-insensitively", () => {
    const lowercasedAccount =
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const
    const message = {
      account: lowercasedAccount,
      chainId: 8453,
      outcome: "success",
      slicerId: 7,
      sourceId: "other"
    } as const
    expect(
      shouldHandleManagementMutation({
        activeAccount: getAddress(lowercasedAccount),
        chainId: 8453,
        message,
        sourceId: "self"
      })
    ).toBe(true)
    expect(
      shouldHandleManagementMutation({
        activeAccount: lowercasedAccount,
        chainId: 8453,
        message,
        sourceId: "other"
      })
    ).toBe(false)
    expect(
      shouldHandleManagementMutation({
        activeAccount: otherAccount,
        chainId: 8453,
        message,
        sourceId: "self"
      })
    ).toBe(false)
  })
})
