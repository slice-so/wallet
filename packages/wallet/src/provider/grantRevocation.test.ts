import { describe, expect, mock, test } from "bun:test"
import { revokeSliceWalletGrantState } from "./grantRevocation"

describe("wallet grant revocation state", () => {
  test("keeps the grant retryable when the onchain uninstall fails", async () => {
    const uninstallError = new Error("bundler unavailable")
    const clearStored = mock(() => undefined)
    const clearSession = mock(async () => undefined)

    await expect(
      revokeSliceWalletGrantState({
        clearSession,
        clearStored,
        uninstall: async () => {
          throw uninstallError
        }
      })
    ).rejects.toBe(uninstallError)
    expect(clearSession).not.toHaveBeenCalled()
    expect(clearStored).not.toHaveBeenCalled()
  })

  test("does not touch frame state when the onchain revocation fails", async () => {
    const uninstallError = new Error("bundler unavailable")
    const clearSession = mock(async () => {
      throw new Error("frame unavailable")
    })
    const clearStored = mock(() => undefined)

    await expect(
      revokeSliceWalletGrantState({
        clearSession,
        clearStored,
        uninstall: async () => {
          throw uninstallError
        }
      })
    ).rejects.toBe(uninstallError)
    expect(clearSession).not.toHaveBeenCalled()
    expect(clearStored).not.toHaveBeenCalled()
  })

  test("clears local state after an authoritative onchain uninstall", async () => {
    const clearStored = mock(() => undefined)

    await expect(
      revokeSliceWalletGrantState({
        clearSession: async () => {
          throw new Error("frame unavailable")
        },
        clearStored,
        uninstall: async () => undefined
      })
    ).resolves.toBeUndefined()
    expect(clearStored).toHaveBeenCalledTimes(1)
  })
})
