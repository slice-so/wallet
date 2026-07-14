import { describe, expect, it } from "bun:test"
import { createPublicClient, custom, encodeAbiParameters } from "viem"
import { base } from "viem/chains"
import {
  getSliceWalletRootValidatorPublicKey,
  parseSliceWalletUncompressedPublicKey
} from "./rootValidator"

const account = "0x1000000000000000000000000000000000000001" as const
const publicKey =
  "0x04000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000001c8" as const
const createRootStorageClient = (x: bigint, y: bigint) =>
  createPublicClient({
    chain: base,
    transport: custom({
      request: async () =>
        encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [x, y])
    })
  })

describe("Slice wallet root validator state", () => {
  it("parses uncompressed root public keys", () => {
    expect(parseSliceWalletUncompressedPublicKey(publicKey)).toEqual({
      x: 123n,
      y: 456n
    })
    expect(() => parseSliceWalletUncompressedPublicKey("0x04")).toThrow(
      "uncompressed P-256"
    )
  })

  it("returns the installed coordinates and treats zero storage as absent", async () => {
    const installed = await getSliceWalletRootValidatorPublicKey({
      account,
      client: createRootStorageClient(123n, 456n)
    })
    const absent = await getSliceWalletRootValidatorPublicKey({
      account,
      client: createRootStorageClient(0n, 0n)
    })

    expect(installed).toEqual({ x: 123n, y: 456n })
    expect(absent).toBeNull()
  })
})
