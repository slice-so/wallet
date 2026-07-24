import { describe, expect, test } from "bun:test"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../p256"
import {
  getWalletPermissionId,
  serializeWalletPolicyDescriptor
} from "../policy"
import {
  readStoredSliceWalletAccount,
  readStoredSliceWalletCall,
  readStoredSliceWalletGrant,
  writeStoredSliceWalletAccount,
  writeStoredSliceWalletCall,
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

const createGrant = () => {
  const policy = {
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
    rateLimit: { count: 1, intervalSec: 3600 },
    validAfter: 1_800_000_000,
    validUntil: 1_800_003_600,
    version: 1
  } as const
  const signerId = getSliceWalletP256SignerId(publicKey)
  return {
    account,
    chainId: 8453,
    createdAt: 1_800_000_000,
    enableSignature: "0x1234" as Hex,
    expiresAt: 1_800_003_600,
    permissionId: getWalletPermissionId(policy, signerId),
    permissions: [
      {
        data: {
          maximumValue: "0x1" as Hex,
          recipient: target,
          template: "native-transfer" as const
        },
        policies: [
          {
            data: { count: 1, intervalSec: 3600 },
            type: "rate-limit" as const
          }
        ],
        type: "slice-call" as const
      }
    ],
    policy: serializeWalletPolicyDescriptor(policy),
    publicKey,
    signerId
  }
}

describe("portable wallet provider storage", () => {
  test("persists indexed accounts", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
      credentialIdHash: `0x${"33".repeat(32)}`,
      factoryVersion: "1",
      publicKey,
      recoveryPermissionId: null,
      recoverySignerAddress: null,
      registrationKind: "initial"
    })
    expect(readStoredSliceWalletAccount(storage)).toMatchObject({
      accountAddress: account,
      accountIndex: 7
    })
  })

  test("persists public grant metadata without private key material", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    expect([...storage.values.values()][0]).not.toContain("privateKey")
    expect(
      readStoredSliceWalletGrant(storage, 8453, account, 1_800_000_001)
    ).not.toBeNull()
  })

  test("rejects a record containing private key material", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    const [key, raw] = [...storage.values.entries()][0] ?? []
    if (key === undefined || raw === undefined)
      throw new Error("Missing fixture.")
    storage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(raw), privateKey: "0xdeadbeef" })
    )
    expect(
      readStoredSliceWalletGrant(storage, 8453, account, 1_800_000_001)
    ).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  test("isolates grants by account", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    expect(
      readStoredSliceWalletGrant(storage, 8453, account, 1_800_000_001)
    ).not.toBeNull()
    expect(
      readStoredSliceWalletGrant(storage, 10, account, 1_800_000_001)
    ).toBeNull()
    expect(
      readStoredSliceWalletGrant(storage, 8453, target, 1_800_000_001)
    ).toBeNull()
  })

  test("persists a tracked call by opaque id and expires it after retention", () => {
    const storage = new MemoryStorage()
    const call = {
      chainId: 8453,
      createdAt: 1_800_000_000_000,
      id: "checkout-call",
      userOperationHash: `0x${"22".repeat(32)}` as Hex
    }
    writeStoredSliceWalletCall(storage, call)

    expect(
      readStoredSliceWalletCall(storage, call.id, call.createdAt + 1)
    ).toEqual(call)
    expect(
      readStoredSliceWalletCall(
        storage,
        call.id,
        call.createdAt + 24 * 60 * 60 * 1000 + 1
      )
    ).toBeNull()
  })
})
