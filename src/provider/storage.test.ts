import { describe, expect, test } from "bun:test"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../p256"
import { serializeWalletPolicyDescriptor } from "../policy"
import {
  readStoredSliceWalletGrant,
  writeStoredSliceWalletGrant
} from "./storage"

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const account = "0x0000000000000000000000000000000000000001" as Address
const target = "0x0000000000000000000000000000000000000002" as Address
const publicKey = `0x04${"11".repeat(64)}` as Hex

const createGrant = () => ({
  account,
  chainId: 8453,
  createdAt: 1_800_000_000,
  enableSignature: "0x1234" as Hex,
  expiresAt: 1_900_000_000,
  permissionId: "0x01020304" as Hex,
  policy: serializeWalletPolicyDescriptor({
    account,
    calls: [
      {
        parameterRules: [],
        selector: "0x00000000",
        target,
        valueLimit: 1n
      }
    ],
    chainId: 8453,
    grantKind: "generic",
    validAfter: 1_800_000_000,
    validUntil: 1_900_000_000,
    version: 1
  }),
  publicKey,
  signerId: getSliceWalletP256SignerId(publicKey),
  version: 1 as const
})

describe("portable wallet provider storage", () => {
  test("persists public grant metadata without private key material", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    expect([...storage.values.values()][0]).not.toContain("privateKey")
    expect(readStoredSliceWalletGrant(storage, 1_800_000_001)).not.toBeNull()
  })

  test("deletes a legacy record containing private key material", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    const [key, raw] = [...storage.values.entries()][0] ?? []
    if (key === undefined || raw === undefined)
      throw new Error("Missing fixture.")
    storage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(raw), privateKey: "0xdeadbeef" })
    )
    expect(readStoredSliceWalletGrant(storage, 1_800_000_001)).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })
})
