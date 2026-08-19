import { describe, expect, it, spyOn } from "bun:test"
import type { SliceWalletFrameSession } from "@slicekit/wallet-primitives/server"
import { IDBDatabase as FakeIDBDatabase, IDBFactory } from "fake-indexeddb"
import type { Address } from "viem"
import { generateSliceWalletP256KeyPair } from "../p256"
import {
  createSliceWalletIndexedDbSessionStore,
  createSliceWalletMemorySessionStore
} from "./sessionStore"

const account = "0x1000000000000000000000000000000000000001" as Address

describe("signer-frame session store", () => {
  it("partitions records by normalized app origin", async () => {
    const keyPair = await generateSliceWalletP256KeyPair()
    const session = {
      account,
      chainId: 8453,
      expiresAt: 4_000_000_000,
      grantKind: "generic",
      permissionId: "0x01020304",
      policy: {
        account,
        calls: [
          {
            parameterRules: [],
            selector: "0x00000000",
            target: account,
            valueLimit: 1n
          }
        ],
        chainId: 8453,
        grantKind: "generic",
        validAfter: 100,
        validUntil: 4_000_000_000,
        version: 1
      },
      publicKey: keyPair.publicKeyHex,
      signerId: keyPair.signerId
    } as const satisfies SliceWalletFrameSession
    const store = createSliceWalletMemorySessionStore()
    await store.putPending({
      appOrigin: "https://shop.example/path",
      privateKey: keyPair.privateKey,
      session
    })

    expect(await store.get("https://shop.example", session)).toBeNull()
    expect(
      (await store.getPending("https://shop.example", session))?.session
    ).toEqual(session)
    await store.commitPending("https://shop.example", session)
    expect((await store.get("https://shop.example", session))?.session).toEqual(
      session
    )
    expect(await store.get("https://other.example", session)).toBeNull()
  })

  it("preserves an active key when a replacement is discarded", async () => {
    const first = await generateSliceWalletP256KeyPair()
    const replacement = await generateSliceWalletP256KeyPair()
    const session = {
      account,
      chainId: 8453,
      expiresAt: 200,
      grantKind: "generic",
      permissionId: "0x01020304",
      policy: {
        account,
        calls: [],
        chainId: 8453,
        grantKind: "generic",
        validAfter: 100,
        validUntil: 200,
        version: 1
      },
      publicKey: first.publicKeyHex,
      signerId: first.signerId
    } as const satisfies SliceWalletFrameSession
    const store = createSliceWalletMemorySessionStore()
    await store.putPending({
      appOrigin: "https://shop.example",
      privateKey: first.privateKey,
      session
    })
    await store.commitPending("https://shop.example", session)
    await store.putPending({
      appOrigin: "https://shop.example",
      privateKey: replacement.privateKey,
      session: {
        ...session,
        publicKey: replacement.publicKeyHex,
        signerId: replacement.signerId
      }
    })
    await store.deletePending("https://shop.example", session)

    expect(
      (await store.get("https://shop.example", session))?.session.signerId
    ).toBe(first.signerId)
  })

  it("keeps one management session per account and chain", async () => {
    const first = await generateSliceWalletP256KeyPair()
    const second = await generateSliceWalletP256KeyPair()
    const createSession = (
      keyPair: Awaited<ReturnType<typeof generateSliceWalletP256KeyPair>>
    ) =>
      ({
        account,
        chainId: 8453,
        expiresAt: 200,
        grantKind: "management",
        permissionId: "0x01020304",
        policy: {
          account,
          calls: [],
          chainId: 8453,
          grantKind: "management",
          validAfter: 100,
          validUntil: 200,
          version: 1
        },
        publicKey: keyPair.publicKeyHex,
        signerId: keyPair.signerId
      }) satisfies SliceWalletFrameSession
    const firstSession = createSession(first)
    const secondSession = createSession(second)
    const store = createSliceWalletMemorySessionStore()

    await store.putPending({
      appOrigin: "https://shop.example",
      privateKey: first.privateKey,
      session: firstSession
    })
    await store.commitPending("https://shop.example", firstSession)
    await store.putPending({
      appOrigin: "https://shop.example",
      privateKey: second.privateKey,
      session: secondSession
    })
    await store.commitPending("https://shop.example", secondSession)

    await expect(
      store.get("https://shop.example", secondSession)
    ).resolves.toMatchObject({ session: { signerId: second.signerId } })
  })

  it("reads legacy management records and collects expired IndexedDB sessions", async () => {
    const indexedDb = new IDBFactory()
    const keyPair = await generateSliceWalletP256KeyPair()
    const legacySession = {
      account,
      chainId: 8453,
      expiresAt: 4_000_000_000,
      grantKind: "management",
      permissionId: "0x01020304",
      policy: {
        account,
        calls: [
          {
            parameterRules: [
              {
                condition: "equal",
                offset: 0,
                params: [
                  "0x0000000000000000000000000000000000000000000000000000000000000000"
                ]
              }
            ],
            selector: "0x00000000",
            target: account,
            valueLimit: 0n
          }
        ],
        chainId: 8453,
        grantKind: "management",
        validAfter: 100,
        validUntil: 4_000_000_000,
        version: 1
      },
      publicKey: keyPair.publicKeyHex,
      signerId: keyPair.signerId
    } as const
    await new Promise<void>((resolve, reject) => {
      const request = indexedDb.open("slice-wallet-signer")
      request.addEventListener("upgradeneeded", () => {
        request.result.createObjectStore("sessions", { keyPath: "id" })
      })
      request.addEventListener("success", () => {
        const database = request.result
        const transaction = database.transaction("sessions", "readwrite")
        transaction.objectStore("sessions").put({
          appOrigin: "https://shop.example",
          id: `https://shop.example:${account.toLowerCase()}:8453:management`,
          privateKey: keyPair.privateKey,
          session: legacySession
        })
        transaction.objectStore("sessions").put({
          appOrigin: "https://shop.example",
          id: `https://shop.example:${account.toLowerCase()}:8453:generic`,
          privateKey: keyPair.privateKey,
          session: {
            ...legacySession,
            expiresAt: 200,
            grantKind: "generic",
            policy: {
              ...legacySession.policy,
              grantKind: "generic",
              validUntil: 200
            }
          }
        })
        transaction.addEventListener("complete", () => {
          database.close()
          resolve()
        })
        transaction.addEventListener("error", () => reject(transaction.error))
      })
      request.addEventListener("error", () => reject(request.error))
    })
    const store = createSliceWalletIndexedDbSessionStore(indexedDb)

    await expect(
      store.get("https://shop.example", {
        account,
        chainId: 8453,
        grantKind: "management"
      })
    ).resolves.toMatchObject({ session: { grantKind: "management" } })
    await expect(
      store.get("https://shop.example", {
        account,
        chainId: 8453,
        grantKind: "generic"
      })
    ).resolves.toBeNull()
  })

  it("keeps the store usable when best-effort garbage collection fails", async () => {
    const indexedDb = new IDBFactory()
    const transaction = FakeIDBDatabase.prototype.transaction
    let rejectGarbageCollection = true
    const transactionSpy = spyOn(
      FakeIDBDatabase.prototype,
      "transaction"
    ).mockImplementation(function (
      this: IDBDatabase,
      ...parameters: Parameters<IDBDatabase["transaction"]>
    ) {
      if (rejectGarbageCollection && parameters[1] === "readwrite") {
        rejectGarbageCollection = false
        throw new Error("IndexedDB cleanup failed.")
      }
      return transaction.apply(this, parameters)
    })
    try {
      const store = createSliceWalletIndexedDbSessionStore(indexedDb)
      await expect(
        store.get("https://shop.example", {
          account,
          chainId: 8453,
          grantKind: "generic"
        })
      ).resolves.toBeNull()
      await store.setAccountUnlocked("https://shop.example", account, true)
      await expect(
        store.isAccountUnlocked("https://shop.example", account)
      ).resolves.toBe(true)
      expect(rejectGarbageCollection).toBe(false)
    } finally {
      transactionSpy.mockRestore()
    }
  })

  it("persists connection state by app origin until explicit lock", async () => {
    const store = createSliceWalletMemorySessionStore()

    expect(await store.isAccountUnlocked("https://shop.example", account)).toBe(
      false
    )
    await store.setAccountUnlocked("https://shop.example/path", account, true)
    expect(await store.isAccountUnlocked("https://shop.example", account)).toBe(
      true
    )
    expect(
      await store.isAccountUnlocked("https://other.example", account)
    ).toBe(false)

    await store.setAccountUnlocked("https://shop.example", account, false)
    expect(await store.isAccountUnlocked("https://shop.example", account)).toBe(
      false
    )
  })
})
