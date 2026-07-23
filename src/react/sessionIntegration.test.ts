import { describe, expect, it, mock } from "bun:test"
import type { Address } from "viem"
import type {
  SliceWalletCeremonySessionResult,
  SliceWalletSessionAdapter,
  SliceWalletSessionSnapshot
} from "../types/session"
import { createSliceWalletSessionIntegration } from "./sessionIntegration"

const accountA = "0x1111111111111111111111111111111111111111" as const
const accountB = "0x2222222222222222222222222222222222222222" as const
const audience = "https://api.slice.test"
const chainId = 8453

const snapshot = (
  account: Address = accountA,
  activeChainId = chainId
): SliceWalletSessionSnapshot => ({
  account,
  audience,
  chainId: activeChainId,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  sessionSigner: "0x3333333333333333333333333333333333333333"
})

const granted = {
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  grantMessage: "grant",
  sessionSigner: "0x3333333333333333333333333333333333333333",
  signature: "0x1234",
  status: "granted"
} as const satisfies SliceWalletCeremonySessionResult

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const createHarness = (adapter: SliceWalletSessionAdapter) => {
  const states: ReturnType<
    ReturnType<typeof createSliceWalletSessionIntegration>["getState"]
  >[] = []
  const warn = mock(() => undefined)
  const integration = createSliceWalletSessionIntegration({
    onChange: (state) => states.push(state)
  })
  const configure = (account: `0x${string}` | null, activeChainId = chainId) =>
    integration.configure({
      account,
      adapter,
      audience,
      chainId: activeChainId,
      warn
    })
  return { configure, integration, states, warn }
}

describe("Slice Wallet session integration", () => {
  it("deactivates session A before switching to account B", async () => {
    let fetches = 0
    const end = mock(async () => undefined)
    const harness = createHarness({
      complete: async () => snapshot(),
      end,
      fetch: async () => (fetches++ === 0 ? snapshot() : null),
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })
    harness.configure(accountA)
    await settle()
    expect(harness.integration.getState().session?.account).toBe(accountA)

    harness.configure(accountB)
    expect(harness.integration.getState().session).toBeNull()
    await settle()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it("deactivates a Base session when the active chain changes", async () => {
    let fetches = 0
    const end = mock(async () => undefined)
    const harness = createHarness({
      complete: async () => snapshot(),
      end,
      fetch: async () => (fetches++ === 0 ? snapshot() : null),
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })
    harness.configure(accountA)
    await settle()
    harness.configure(accountA, 10)

    expect(harness.integration.getState().session).toBeNull()
    await settle()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it("ends a disconnected API session while hydration is still pending", async () => {
    let resolveFetch!: (value: SliceWalletSessionSnapshot | null) => void
    const end = mock(async () => undefined)
    const harness = createHarness({
      complete: async () => snapshot(),
      end,
      fetch: () =>
        new Promise<SliceWalletSessionSnapshot | null>((resolve) => {
          resolveFetch = resolve
        }),
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })

    harness.configure(accountA)
    harness.configure(null)
    await settle()

    expect(end).toHaveBeenCalledTimes(1)
    resolveFetch(snapshot())
    await settle()
    expect(harness.integration.getState().session).toBeNull()
  })

  it("hydrates a valid session from fetch on reload", async () => {
    const hydrated = snapshot()
    const fetch = mock(async () => hydrated)
    const harness = createHarness({
      complete: async () => snapshot(),
      end: async () => undefined,
      fetch,
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })

    harness.configure(accountA)
    await settle()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.integration.getState()).toEqual({
      session: hydrated,
      sessionError: null
    })
  })

  it("rejects a stale session hint returned for another account", async () => {
    const harness = createHarness({
      complete: async () => snapshot(),
      end: async () => undefined,
      fetch: async () => snapshot(accountB),
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })

    harness.configure(accountA)
    await settle()

    expect(harness.integration.getState().session).toBeNull()
    expect(harness.integration.getState().sessionError).toContain(
      "does not match"
    )
  })

  it("surfaces ceremony cancellation without completing", async () => {
    const complete = mock(async () => snapshot())
    const harness = createHarness({
      complete,
      end: async () => undefined,
      fetch: async () => null,
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })
    harness.configure(accountA)
    await settle()

    await harness.integration.complete({ status: "cancelled" })

    expect(complete).not.toHaveBeenCalled()
    expect(harness.integration.getState().sessionError).toBe(
      "Session cancelled."
    )
  })

  it("keeps the wallet integration alive when session completion throws", async () => {
    const end = mock(async () => undefined)
    const harness = createHarness({
      complete: async () => {
        throw new Error("completion failed")
      },
      end,
      fetch: async () => null,
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })
    harness.configure(accountA)
    await settle()

    await harness.integration.complete(granted)

    expect(harness.integration.getState()).toEqual({
      session: null,
      sessionError: "completion failed"
    })
    expect(end).not.toHaveBeenCalled()
  })

  it("clears local state before a throwing end call settles", async () => {
    const harness = createHarness({
      complete: async () => snapshot(),
      end: async () => {
        expect(harness.integration.getState().session).toBeNull()
        throw new Error("end failed")
      },
      fetch: async () => snapshot(),
      prepare: async () => ({ sessionSigner: snapshot().sessionSigner })
    })
    harness.configure(accountA)
    await settle()

    await harness.integration.revoke()

    expect(harness.integration.getState()).toEqual({
      session: null,
      sessionError: null
    })
    expect(harness.warn).toHaveBeenCalledWith("end failed")
  })
})
