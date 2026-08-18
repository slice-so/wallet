import { describe, expect, it } from "bun:test"
import { getSliceWalletPermissionUnavailableReason } from "./slicePermissionErrors"

describe("getSliceWalletPermissionUnavailableReason", () => {
  it("recognizes revoked Kernel permissions", () => {
    expect(
      getSliceWalletPermissionUnavailableReason(
        new Error(
          "UserOperation reverted during simulation with reason: AA23 reverted 0xc48cf8ee"
        )
      )
    ).toBe("revoked")
    expect(
      getSliceWalletPermissionUnavailableReason(
        "Checkout co-sign failed (404): delegation_not_found"
      )
    ).toBe("revoked")
  })

  it("recognizes expired Kernel permissions", () => {
    expect(
      getSliceWalletPermissionUnavailableReason(
        new Error("UserOperation reverted: AA22 expired or not due")
      )
    ).toBe("expired")
  })

  it("recognizes a permission-mode validation rejection without revert data", () => {
    expect(
      getSliceWalletPermissionUnavailableReason(
        new Error(
          "UserOperation reverted during simulation with reason: AA23 reverted 0x Version: viem@2.55.2"
        )
      )
    ).toBe("invalid")
  })

  it("recognizes a rejected Kernel v4 permission installation", () => {
    expect(
      getSliceWalletPermissionUnavailableReason(
        new Error(
          "The validateUserOp function on the Smart Account reverted. Details: UserOperation reverted during simulation with reason: AA23 reverted 0x23a6725b Version: viem@2.55.13"
        )
      )
    ).toBe("invalid")
  })

  it("does not treat unrelated validation failures as unavailable permissions", () => {
    expect(
      getSliceWalletPermissionUnavailableReason(
        new Error("UserOperation reverted: AA23 reverted 0xdeadbeef")
      )
    ).toBeNull()
  })
})
