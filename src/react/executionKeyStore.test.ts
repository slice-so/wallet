import { beforeEach, describe, expect, it } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import type { StoredSliceWalletExecutionSession } from "../types/react"
import {
  readStoredExecutionSession,
  writeStoredExecutionSession
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

describe("execution key storage", () => {
  it("opens an existing database without requesting a lower version", async () => {
    await createDatabaseAtVersion(2)

    await writeStoredExecutionSession(session)

    expect(
      await readStoredExecutionSession(accountAddress, "checkout")
    ).toEqual(session)
  })
})
