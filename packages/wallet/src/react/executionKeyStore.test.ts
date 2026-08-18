import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import type {
  StoredSliceWalletExecutionSession,
  StoredSliceWalletPendingReplacement
} from "../types/react"
import {
  clearStoredExecutionSession,
  clearStoredPendingReplacementStrict,
  readStoredExecutionSession,
  readStoredExecutionSessionResult,
  readStoredManagementExecutionSessions,
  readStoredPendingReplacement,
  writeStoredExecutionSession,
  writeStoredPendingReplacement,
  writeStoredPendingReplacementStrict
} from "./executionKeyStore"

const accountAddress = "0x1111111111111111111111111111111111111111"
const session = {
  accountAddress,
  coSignerAddress: "0x2222222222222222222222222222222222222222",
  delegationId: "delegation-id",
  enableNonce: "0",
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
    enableNonce: "0",
    enableSignature: "0x1234",
    expiresAt: "2099-01-01T00:00:00.000Z",
    kind: "checkout",
    permissionId: "0x5678",
    signerAddress: "0x3333333333333333333333333333333333333333"
  }
} as const satisfies StoredSliceWalletPendingReplacement

const managementSession = {
  accountAddress,
  delegationId: "management-a",
  enableNonce: "0",
  enableSignature: "0x1234",
  expiresAt: "2099-01-01T00:00:00.000Z",
  kind: "store_management",
  permissionId: "0x5678",
  signerAddress: "0x3333333333333333333333333333333333333333"
} as const satisfies StoredSliceWalletExecutionSession

const managementPending = {
  phase: "registering",
  previousSessions: [],
  session: {
    accountAddress,
    enableNonce: "0",
    enableSignature: "0x1234",
    expiresAt: "2099-01-01T00:00:00.000Z",
    kind: "store_management",
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

const seedStoredValue = (key: string, value: object) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("slice-wallet")
    request.addEventListener("success", () => {
      const database = request.result
      const transaction = database.transaction(
        "execution-sessions",
        "readwrite"
      )
      transaction.objectStore("execution-sessions").put(value, key)
      transaction.addEventListener("complete", () => {
        database.close()
        resolve()
      })
      transaction.addEventListener("error", () => reject(transaction.error))
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

  it("keeps one committed and pending management record per account", async () => {
    const secondSession = {
      ...managementSession,
      delegationId: "management-b"
    } satisfies StoredSliceWalletExecutionSession
    const secondPending = {
      ...managementPending,
      session: {
        ...managementPending.session,
        signerAddress: "0x5555555555555555555555555555555555555555"
      }
    } satisfies StoredSliceWalletPendingReplacement

    await writeStoredExecutionSession(managementSession)
    await writeStoredExecutionSession(secondSession)
    await writeStoredPendingReplacement(managementPending)
    await writeStoredPendingReplacement(secondPending)

    await expect(
      readStoredExecutionSession(accountAddress, "store_management")
    ).resolves.toEqual(secondSession)
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management")
    ).resolves.toEqual(secondPending)
    await expect(
      readStoredManagementExecutionSessions(accountAddress)
    ).resolves.toMatchObject({
      status: "available",
      values: [secondSession]
    })
    await clearStoredExecutionSession(accountAddress, "store_management")
    await clearStoredPendingReplacementStrict(
      accountAddress,
      "store_management"
    )
    await expect(
      readStoredExecutionSession(accountAddress, "store_management")
    ).resolves.toBeNull()
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management")
    ).resolves.toBeNull()
  })

  it("distinguishes expired sessions from malformed local state", async () => {
    const key = `store_management:${accountAddress.toLowerCase()}`
    await writeStoredExecutionSession(managementSession)
    await seedStoredValue(key, {
      ...managementSession,
      expiresAt: "2020-01-01T00:00:00.000Z"
    })
    await expect(
      readStoredExecutionSessionResult(accountAddress, "store_management")
    ).resolves.toEqual({ reason: "expired", status: "invalid" })

    await seedStoredValue(key, {
      ...managementSession,
      privateKey: "must-not-be-stored"
    })
    await expect(
      readStoredExecutionSessionResult(accountAddress, "store_management")
    ).resolves.toEqual({ reason: "malformed", status: "invalid" })
  })

  it("reads legacy account-scoped management storage keys", async () => {
    await writeStoredExecutionSession(session)
    await Promise.all([
      seedStoredValue(
        `store_management:${accountAddress.toLowerCase()}`,
        managementSession
      ),
      seedStoredValue(
        `pending:store_management:${accountAddress.toLowerCase()}`,
        managementPending
      )
    ])

    await expect(
      readStoredExecutionSession(accountAddress, "store_management")
    ).resolves.toEqual(managementSession)
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management")
    ).resolves.toEqual(managementPending)
    await expect(
      readStoredExecutionSession(accountAddress, "checkout")
    ).resolves.toEqual(session)
  })
})
