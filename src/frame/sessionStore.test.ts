import { describe, expect, it } from "bun:test"
import type { Address } from "viem"
import { generateSliceWalletP256KeyPair } from "../p256"
import type { SliceWalletFrameSession } from "../types"
import { createSliceWalletMemorySessionStore } from "./sessionStore"

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
