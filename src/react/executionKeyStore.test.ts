import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import type {
  StoredSliceWalletExecutionSession,
  StoredSliceWalletPendingReplacement
} from "../types/react"
import {
  readStoredExecutionSession,
  writeStoredExecutionSession,
  writeStoredPendingReplacement,
  writeStoredPendingReplacementStrict
} from "./executionKeyStore"

const accountAddress = "0x1111111111111111111111111111111111111111"
const session = {
  accountAddress,
  coSignerAddress: "0x2222222222222222222222222222222222222222",
  delegationId: "delegation-id",
  enableSignature: "0x1234",
  expiresAt: "2099-01-01T00:00:00.000Z",
  kind: "checkout",
  permissionId: "0x5678",
  signerAddress: "0x3333333333333333333333333333333333333333"
} as const satisfies StoredSliceWalletExecutionSession

const pendingReplacement = {
  phase: "registering",
  previousSessions: [],
  session: {
    accountAddress,
    coSignerAddress: "0x2222222222222222222222222222222222222222",
    enableSignature: "0x1234",
    expiresAt: "2099-01-01T00:00:00.000Z",
    kind: "checkout",
    permissionId: "0x5678",
    signerAddress: "0x3333333333333333333333333333333333333333"
  }
} as const satisfies StoredSliceWalletPendingReplacement

const existingIndexedDb = Object.getOwnPropertyDescriptor(
  globalThis,
  "indexedDB"
)

const createDatabaseAtVersion = (version: number) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("slice-wallet", version)
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("execution-sessions")
    })
    request.addEventListener("success", () => {
      request.result.close()
      resolve()
    })
    request.addEventListener("error", () => reject(request.error))
  })

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new IDBFactory()
  })
})

afterEach(() => {
  if (existingIndexedDb === undefined) {
    Reflect.deleteProperty(globalThis, "indexedDB")
  } else {
    Object.defineProperty(globalThis, "indexedDB", existingIndexedDb)
  }
})

describe("execution key storage", () => {
  it("opens an existing database without requesting a lower version", async () => {
    await createDatabaseAtVersion(2)

    await writeStoredExecutionSession(session)

    expect(
      await readStoredExecutionSession(accountAddress, "checkout")
    ).toEqual(session)
  })

  it("keeps checkout persistence optional while management can require it", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined
    })

    await expect(
      writeStoredPendingReplacement(pendingReplacement)
    ).resolves.toBeUndefined()
    await expect(
      writeStoredPendingReplacementStrict(pendingReplacement)
    ).rejects.toThrow("Slice Wallet session storage is unavailable.")
  })
})
