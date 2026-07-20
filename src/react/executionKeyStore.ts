"use client"

import { type Address, isAddress, isHex } from "viem"
import type {
  StoredSliceWalletExecutionSession,
  StoredSliceWalletPendingReplacement
} from "../types/react"

const DB_NAME = "slice-wallet"
const STORE_NAME = "execution-sessions"

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const database = await openDatabase()

  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(
        database.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
      )
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

export const readStoredExecutionSession = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<StoredSliceWalletExecutionSession | null> => {
  if (typeof indexedDB === "undefined") return null

  try {
    const stored = await withStore("readonly", (store) =>
      store.get(`${kind}:${accountAddress.toLowerCase()}`)
    )
    const session = stored as
      | (StoredSliceWalletExecutionSession & { privateKey?: string })
      | null
    if (!session) return null
    if (
      session.privateKey !== undefined ||
      session.kind !== kind ||
      !isAddress(session.accountAddress) ||
      !isAddress(session.signerAddress) ||
      !isHex(session.enableSignature, { strict: true }) ||
      !isHex(session.permissionId, { strict: true }) ||
      (session.kind === "checkout" && !isAddress(session.coSignerAddress)) ||
      (session.kind === "store_management" &&
        (!isAddress(session.slicerAddress) ||
          !Number.isSafeInteger(session.slicerId) ||
          session.slicerId <= 0))
    ) {
      await clearStoredExecutionSession(accountAddress, kind)
      return null
    }
    if (new Date(session.expiresAt) <= new Date()) {
      await clearStoredExecutionSession(accountAddress, kind)
      return null
    }

    return session
  } catch {
    return null
  }
}

export const writeStoredExecutionSession = async (
  session: StoredSliceWalletExecutionSession
) => {
  if (typeof indexedDB === "undefined") return

  try {
    await withStore("readwrite", (store) =>
      store.put(
        session,
        `${session.kind}:${session.accountAddress.toLowerCase()}`
      )
    )
  } catch {
    // Losing persistence only means re-enabling later; never block checkout.
  }
}

export const clearStoredExecutionSession = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => {
  if (typeof indexedDB === "undefined") return

  try {
    await withStore("readwrite", (store) =>
      store.delete(`${kind}:${accountAddress.toLowerCase()}`)
    )
  } catch {}
}

const pendingKey = (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => `pending:${kind}:${accountAddress.toLowerCase()}`

export const readStoredPendingReplacement = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<StoredSliceWalletPendingReplacement | null> => {
  if (typeof indexedDB === "undefined") return null
  try {
    const stored = (await withStore("readonly", (store) =>
      store.get(pendingKey(accountAddress, kind))
    )) as StoredSliceWalletPendingReplacement | null | undefined
    if (
      stored === null ||
      stored === undefined ||
      stored.session.kind !== kind ||
      stored.session.accountAddress.toLowerCase() !==
        accountAddress.toLowerCase() ||
      (stored.phase !== "registered" && stored.phase !== "registering") ||
      !Array.isArray(stored.previousSessions) ||
      (stored.phase === "registering" &&
        (stored.previousSessions.length !== 0 ||
          "delegationId" in stored.session)) ||
      (stored.phase !== "registering" &&
        (!("delegationId" in stored.session) ||
          stored.session.delegationId.length === 0 ||
          (stored.session.kind === "checkout" &&
            (stored.allowanceUsdMicros === undefined ||
              !/^\d+$/.test(stored.allowanceUsdMicros))))) ||
      new Date(stored.session.expiresAt) <= new Date()
    ) {
      await clearStoredPendingReplacement(accountAddress, kind)
      return null
    }
    return stored
  } catch {
    return null
  }
}

export const writeStoredPendingReplacement = async (
  replacement: StoredSliceWalletPendingReplacement
) => {
  if (typeof indexedDB === "undefined") return
  await withStore("readwrite", (store) =>
    store.put(
      replacement,
      pendingKey(replacement.session.accountAddress, replacement.session.kind)
    )
  )
}

export const clearStoredPendingReplacement = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => {
  if (typeof indexedDB === "undefined") return
  try {
    await withStore("readwrite", (store) =>
      store.delete(pendingKey(accountAddress, kind))
    )
  } catch {}
}
