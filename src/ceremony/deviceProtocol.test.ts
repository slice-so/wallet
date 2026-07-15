import { describe, expect, it } from "bun:test"
import { parseSliceWalletCeremonyDeviceResponse } from "./deviceProtocol"

const nonce = `0x${"11".repeat(32)}` as const
const credentialIdHash = `0x${"22".repeat(32)}` as const

describe("device ceremony protocol", () => {
  it("accepts a bound device lifecycle result", () => {
    expect(
      parseSliceWalletCeremonyDeviceResponse({
        account: "0x1000000000000000000000000000000000000001",
        action: "add",
        chainId: 8453,
        credentialIdHash,
        nonce,
        permissionId: "0x12345678",
        type: "slice-wallet:ceremony-device",
        userOperationHash: `0x${"33".repeat(32)}`,
        version: 1
      })
    ).toMatchObject({ action: "add", chainId: 8453, credentialIdHash })
  })

  it("rejects unknown fields and malformed permission ids", () => {
    expect(() =>
      parseSliceWalletCeremonyDeviceResponse({
        account: "0x1000000000000000000000000000000000000001",
        action: "remove",
        chainId: 8453,
        credentialIdHash,
        nonce,
        permissionId: "0x12",
        type: "slice-wallet:ceremony-device",
        userOperationHash: null,
        version: 1
      })
    ).toThrow("invalid")
  })
})
