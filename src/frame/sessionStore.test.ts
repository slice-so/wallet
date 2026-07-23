import { describe, expect, it } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import type { Address } from "viem"
import { generateSliceWalletP256KeyPair } from "../p256"
import type { SliceWalletFrameSession } from "../types"
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
      expiresAt: 200,
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
        validUntil: 200,
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

  it("keeps management sessions for two slicers usable in parallel", async () => {
    const first = await generateSliceWalletP256KeyPair()
    const second = await generateSliceWalletP256KeyPair()
    const createSession = (
      slicerId: number,
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
        signerId: keyPair.signerId,
        slicerId
      }) satisfies SliceWalletFrameSession
    const firstSession = createSession(7, first)
    const secondSession = createSession(9, second)
    const store = createSliceWalletMemorySessionStore()

    await Promise.all([
      store.putPending({
        appOrigin: "https://shop.example",
        privateKey: first.privateKey,
        session: firstSession
      }),
      store.putPending({
        appOrigin: "https://shop.example",
        privateKey: second.privateKey,
        session: secondSession
      })
    ])
    await Promise.all([
      store.commitPending("https://shop.example", firstSession),
      store.commitPending("https://shop.example", secondSession)
    ])

    await expect(
      store.get("https://shop.example", firstSession)
    ).resolves.toMatchObject({ session: { signerId: first.signerId } })
    await expect(
      store.get("https://shop.example", secondSession)
    ).resolves.toMatchObject({ session: { signerId: second.signerId } })
  })

  it("migrates a legacy frame record only for its policy-bound slicer", async () => {
    const indexedDb = new IDBFactory()
    const keyPair = await generateSliceWalletP256KeyPair()
    const legacySession = {
      account,
      chainId: 8453,
      expiresAt: 200,
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
        validUntil: 200,
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
        grantKind: "management",
        slicerId: 9
      })
    ).resolves.toBeNull()
    await expect(
      store.get("https://shop.example", {
        account,
        chainId: 8453,
        grantKind: "management",
        slicerId: 0
      })
    ).resolves.toMatchObject({ session: { slicerId: 0 } })
  })
})
