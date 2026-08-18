"use client"

import { type Address, isAddress, isHex } from "viem"
import type {
  StoredSliceWalletExecutionSession,
  StoredSliceWalletPendingReplacement
} from "../types/react"

const DB_NAME = "slice-wallet"
const STORE_NAME = "execution-sessions"

type StoredManagementSession = Extract<
  StoredSliceWalletExecutionSession,
  { kind: "store_management" }
>

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

const executionSessionKey = (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => `${kind}:${accountAddress.toLowerCase()}`

const pendingKey = (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => `pending:${executionSessionKey(accountAddress, kind)}`

export const readStoredExecutionSessionResult = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<
  | { status: "found"; value: StoredSliceWalletExecutionSession }
  | { reason: "expired" | "malformed"; status: "invalid" }
  | { status: "missing" }
  | { status: "unavailable" }
> => {
  if (typeof indexedDB === "undefined") return { status: "unavailable" }

  try {
    const stored = await withStore("readonly", (store) =>
      store.get(executionSessionKey(accountAddress, kind))
    )
    const session = stored as
      | (StoredSliceWalletExecutionSession & { privateKey?: string })
      | null
    if (!session) return { status: "missing" }
    if (
      session.privateKey !== undefined ||
      session.kind !== kind ||
      !isAddress(session.accountAddress) ||
      !isAddress(session.signerAddress) ||
      !/^\d+$/.test(session.enableNonce) ||
      BigInt(session.enableNonce).toString() !== session.enableNonce ||
      !isHex(session.enableSignature, { strict: true }) ||
      !isHex(session.permissionId, { strict: true }) ||
      (session.kind === "checkout" && !isAddress(session.coSignerAddress))
    ) {
      await clearStoredExecutionSession(accountAddress, kind)
      return { reason: "malformed", status: "invalid" }
    }
    if (new Date(session.expiresAt) <= new Date()) {
      await clearStoredExecutionSession(accountAddress, kind)
      return { reason: "expired", status: "invalid" }
    }

    return { status: "found", value: session }
  } catch {
    return { status: "unavailable" }
  }
}

export const readStoredExecutionSession = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<StoredSliceWalletExecutionSession | null> => {
  const result = await readStoredExecutionSessionResult(accountAddress, kind)
  return result.status === "found" ? result.value : null
}

export const writeStoredExecutionSession = async (
  session: StoredSliceWalletExecutionSession
) => {
  if (typeof indexedDB === "undefined") return

  try {
    await withStore("readwrite", (store) =>
      store.put(
        session,
        executionSessionKey(session.accountAddress, session.kind)
      )
    )
  } catch {
    // Losing persistence only means re-enabling later; never block checkout.
  }
}

export const writeStoredExecutionSessionStrict = async (
  session: StoredSliceWalletExecutionSession
) => {
  if (typeof indexedDB === "undefined") {
    throw new Error("Slice Wallet session storage is unavailable.")
  }
  await withStore("readwrite", (store) =>
    store.put(
      session,
      executionSessionKey(session.accountAddress, session.kind)
    )
  )
}

export const clearStoredExecutionSession = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => {
  if (typeof indexedDB === "undefined") return

  try {
    await withStore("readwrite", (store) =>
      store.delete(executionSessionKey(accountAddress, kind))
    )
  } catch {}
}

const readStoredPendingReplacementValue = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<StoredSliceWalletPendingReplacement | null> => {
  const targetKey = pendingKey(accountAddress, kind)
  const stored = (await withStore("readonly", (store) =>
    store.get(targetKey)
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
    await withStore("readwrite", (store) => store.delete(targetKey))
    return null
  }
  return stored
}

export const readStoredPendingReplacement = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<StoredSliceWalletPendingReplacement | null> => {
  if (typeof indexedDB === "undefined") return null
  try {
    return await readStoredPendingReplacementValue(accountAddress, kind)
  } catch {
    return null
  }
}

type StoredPendingReplacementReadResult =
  | { ok: true; value: StoredSliceWalletPendingReplacement | null }
  | { ok: false }

export const readStoredPendingReplacementStrict = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
): Promise<StoredPendingReplacementReadResult> => {
  if (typeof indexedDB === "undefined") return { ok: false }
  try {
    return {
      ok: true,
      value: await readStoredPendingReplacementValue(accountAddress, kind)
    }
  } catch {
    return { ok: false }
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

export const writeStoredPendingReplacementStrict = async (
  replacement: StoredSliceWalletPendingReplacement
) => {
  if (typeof indexedDB === "undefined") {
    throw new Error("Slice Wallet session storage is unavailable.")
  }
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

export const clearStoredPendingReplacementStrict = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => {
  if (typeof indexedDB === "undefined") {
    throw new Error("Slice Wallet session storage is unavailable.")
  }
  await withStore("readwrite", (store) =>
    store.delete(pendingKey(accountAddress, kind))
  )
}

export const readStoredManagementExecutionSessions = async (
  accountAddress: Address
): Promise<
  | { status: "available"; values: readonly StoredManagementSession[] }
  | { status: "unavailable" }
> => {
  if (typeof indexedDB === "undefined") return { status: "unavailable" }
  try {
    const result = await readStoredExecutionSessionResult(
      accountAddress,
      "store_management"
    )
    if (result.status === "unavailable") {
      return { status: "unavailable" }
    }
    return {
      status: "available",
      values:
        result.status === "found" && result.value.kind === "store_management"
          ? [result.value]
          : []
    }
  } catch {
    return { status: "unavailable" }
  }
}
