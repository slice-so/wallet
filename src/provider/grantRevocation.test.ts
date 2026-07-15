import { describe, expect, mock, test } from "bun:test"
import { revokeSliceWalletGrantState } from "./grantRevocation"

const permissionId = "0x01020304" as const

describe("wallet grant revocation state", () => {
  test("keeps the grant retryable when the onchain uninstall fails", async () => {
    const uninstallError = new Error("bundler unavailable")
    const clearStored = mock(() => undefined)
    const clearSession = mock(async () => undefined)

    await expect(
      revokeSliceWalletGrantState({
        clearSession,
        clearStored,
        permissionId,
        uninstall: async () => {
          throw uninstallError
        }
      })
    ).rejects.toBe(uninstallError)
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(clearStored).not.toHaveBeenCalled()
  })

  test("preserves both failure causes when the frame is also unavailable", async () => {
    const uninstallError = new Error("bundler unavailable")
    const sessionError = new Error("frame unavailable")
    const clearStored = mock(() => undefined)

    try {
      await revokeSliceWalletGrantState({
        clearSession: async () => {
          throw sessionError
        },
        clearStored,
        permissionId,
        uninstall: async () => {
          throw uninstallError
        }
      })
      throw new Error("Expected revocation to fail.")
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([
        uninstallError,
        sessionError
      ])
    }
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
        permissionId,
        uninstall: async () => undefined
      })
    ).resolves.toBeUndefined()
    expect(clearStored).toHaveBeenCalledTimes(1)
  })
})
