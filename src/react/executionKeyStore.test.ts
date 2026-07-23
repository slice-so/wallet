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

const managementSession = {
  accountAddress,
  delegationId: "management-a",
  enableSignature: "0x1234",
  expiresAt: "2099-01-01T00:00:00.000Z",
  kind: "store_management",
  permissionId: "0x5678",
  signerAddress: "0x3333333333333333333333333333333333333333",
  slicerAddress: "0x4444444444444444444444444444444444444444",
  slicerId: 0
} as const satisfies StoredSliceWalletExecutionSession

const managementPending = {
  phase: "registering",
  previousSessions: [],
  session: {
    accountAddress,
    enableSignature: "0x1234",
    expiresAt: "2099-01-01T00:00:00.000Z",
    kind: "store_management",
    permissionId: "0x5678",
    signerAddress: "0x3333333333333333333333333333333333333333",
    slicerAddress: "0x4444444444444444444444444444444444444444",
    slicerId: 0
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

  it("keeps committed and pending management records isolated by slicer", async () => {
    const secondSession = {
      ...managementSession,
      delegationId: "management-b",
      slicerId: 9
    } satisfies StoredSliceWalletExecutionSession
    const secondPending = {
      ...managementPending,
      session: { ...managementPending.session, slicerId: 9 }
    } satisfies StoredSliceWalletPendingReplacement

    await Promise.all([
      writeStoredExecutionSession(managementSession),
      writeStoredExecutionSession(secondSession),
      writeStoredPendingReplacement(managementPending),
      writeStoredPendingReplacement(secondPending)
    ])

    await expect(
      readStoredExecutionSession(accountAddress, "store_management", 0)
    ).resolves.toEqual(managementSession)
    await expect(
      readStoredExecutionSession(accountAddress, "store_management", 9)
    ).resolves.toEqual(secondSession)
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management", 0)
    ).resolves.toEqual(managementPending)
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management", 9)
    ).resolves.toEqual(secondPending)
    await expect(
      readStoredManagementExecutionSessions(accountAddress)
    ).resolves.toMatchObject({
      status: "available",
      values: expect.arrayContaining([managementSession, secondSession])
    })
    await Promise.all([
      clearStoredExecutionSession(accountAddress, "store_management", 0),
      clearStoredPendingReplacementStrict(accountAddress, "store_management", 0)
    ])
    await expect(
      readStoredExecutionSession(accountAddress, "store_management", 9)
    ).resolves.toEqual(secondSession)
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management", 9)
    ).resolves.toEqual(secondPending)
  })

  it("migrates only the legacy management record that identifies the requested slicer", async () => {
    await writeStoredExecutionSession(session)
    await Promise.all([
      seedStoredValue(
        `store_management:${accountAddress.toLowerCase()}`,
        managementSession
      ),
      seedStoredValue(
        `pending:store_management:${accountAddress.toLowerCase()}`,
        {
          ...managementPending,
          session: { ...managementPending.session, slicerId: 9 }
        }
      )
    ])

    await expect(
      readStoredExecutionSession(accountAddress, "store_management", 9)
    ).resolves.toBeNull()
    await expect(
      readStoredExecutionSession(accountAddress, "store_management", 0)
    ).resolves.toEqual(managementSession)
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management", 0)
    ).resolves.toBeNull()
    await expect(
      readStoredPendingReplacement(accountAddress, "store_management", 9)
    ).resolves.toMatchObject({ session: { slicerId: 9 } })
    await expect(
      readStoredExecutionSession(accountAddress, "checkout")
    ).resolves.toEqual(session)
  })
})
