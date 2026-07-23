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

const legacyExecutionSessionKey = (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"]
) => `${kind}:${accountAddress.toLowerCase()}`

const executionSessionKey = (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
) => {
  const legacyKey = legacyExecutionSessionKey(accountAddress, kind)
  if (kind !== "store_management") return legacyKey
  if (
    slicerId === undefined ||
    !Number.isSafeInteger(slicerId) ||
    slicerId <= 0
  ) {
    throw new Error("Management session keys require a positive slicer id.")
  }
  return `${legacyKey}:${slicerId}`
}

const pendingKey = (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
) => `pending:${executionSessionKey(accountAddress, kind, slicerId)}`

const migrateLegacyValue = async <Value>({
  getSlicerId,
  kind,
  legacyKey,
  slicerId,
  targetKey
}: {
  getSlicerId: (value: Value) => number | null
  kind: StoredSliceWalletExecutionSession["kind"]
  legacyKey: string
  slicerId?: number
  targetKey: string
}): Promise<Value | null> => {
  if (kind !== "store_management" || slicerId === undefined) return null
  const legacy = (await withStore("readonly", (store) =>
    store.get(legacyKey)
  )) as Value | null | undefined
  if (
    legacy === null ||
    legacy === undefined ||
    getSlicerId(legacy) !== slicerId
  ) {
    return null
  }
  await withStore("readwrite", (store) => store.put(legacy, targetKey))
  await withStore("readwrite", (store) => store.delete(legacyKey))
  return legacy
}

export const readStoredExecutionSessionResult = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
): Promise<
  | { status: "found"; value: StoredSliceWalletExecutionSession }
  | { status: "invalid" }
  | { status: "missing" }
  | { status: "unavailable" }
> => {
  if (typeof indexedDB === "undefined") return { status: "unavailable" }

  try {
    const targetKey = executionSessionKey(accountAddress, kind, slicerId)
    const direct = await withStore("readonly", (store) => store.get(targetKey))
    const stored =
      direct ??
      (await migrateLegacyValue<
        StoredSliceWalletExecutionSession & { privateKey?: string }
      >({
        getSlicerId: (value) =>
          value.kind === "store_management" ? value.slicerId : null,
        kind,
        legacyKey: legacyExecutionSessionKey(accountAddress, kind),
        slicerId,
        targetKey
      }))
    const session = stored as
      | (StoredSliceWalletExecutionSession & { privateKey?: string })
      | null
    if (!session) return { status: "missing" }
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
      await clearStoredExecutionSession(accountAddress, kind, slicerId)
      return { status: "invalid" }
    }
    if (new Date(session.expiresAt) <= new Date()) {
      await clearStoredExecutionSession(accountAddress, kind, slicerId)
      return { status: "invalid" }
    }

    return { status: "found", value: session }
  } catch {
    return { status: "unavailable" }
  }
}

export const readStoredExecutionSession = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
): Promise<StoredSliceWalletExecutionSession | null> => {
  const result = await readStoredExecutionSessionResult(
    accountAddress,
    kind,
    slicerId
  )
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
        executionSessionKey(
          session.accountAddress,
          session.kind,
          session.kind === "store_management" ? session.slicerId : undefined
        )
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
      executionSessionKey(
        session.accountAddress,
        session.kind,
        session.kind === "store_management" ? session.slicerId : undefined
      )
    )
  )
}

export const clearStoredExecutionSession = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
) => {
  if (typeof indexedDB === "undefined") return

  try {
    await withStore("readwrite", (store) =>
      store.delete(executionSessionKey(accountAddress, kind, slicerId))
    )
  } catch {}
}

const readStoredPendingReplacementValue = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
): Promise<StoredSliceWalletPendingReplacement | null> => {
  const targetKey = pendingKey(accountAddress, kind, slicerId)
  const direct = (await withStore("readonly", (store) =>
    store.get(targetKey)
  )) as StoredSliceWalletPendingReplacement | null | undefined
  const stored =
    direct ??
    (await migrateLegacyValue<StoredSliceWalletPendingReplacement>({
      getSlicerId: (value) =>
        value.session.kind === "store_management"
          ? value.session.slicerId
          : null,
      kind,
      legacyKey: `pending:${legacyExecutionSessionKey(accountAddress, kind)}`,
      slicerId,
      targetKey
    }))
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
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
): Promise<StoredSliceWalletPendingReplacement | null> => {
  if (typeof indexedDB === "undefined") return null
  try {
    return await readStoredPendingReplacementValue(
      accountAddress,
      kind,
      slicerId
    )
  } catch {
    return null
  }
}

type StoredPendingReplacementReadResult =
  | { ok: true; value: StoredSliceWalletPendingReplacement | null }
  | { ok: false }

export const readStoredPendingReplacementStrict = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
): Promise<StoredPendingReplacementReadResult> => {
  if (typeof indexedDB === "undefined") return { ok: false }
  try {
    return {
      ok: true,
      value: await readStoredPendingReplacementValue(
        accountAddress,
        kind,
        slicerId
      )
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
      pendingKey(
        replacement.session.accountAddress,
        replacement.session.kind,
        replacement.session.kind === "store_management"
          ? replacement.session.slicerId
          : undefined
      )
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
      pendingKey(
        replacement.session.accountAddress,
        replacement.session.kind,
        replacement.session.kind === "store_management"
          ? replacement.session.slicerId
          : undefined
      )
    )
  )
}

export const clearStoredPendingReplacement = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
) => {
  if (typeof indexedDB === "undefined") return
  try {
    await withStore("readwrite", (store) =>
      store.delete(pendingKey(accountAddress, kind, slicerId))
    )
  } catch {}
}

export const clearStoredPendingReplacementStrict = async (
  accountAddress: Address,
  kind: StoredSliceWalletExecutionSession["kind"],
  slicerId?: number
) => {
  if (typeof indexedDB === "undefined") {
    throw new Error("Slice Wallet session storage is unavailable.")
  }
  await withStore("readwrite", (store) =>
    store.delete(pendingKey(accountAddress, kind, slicerId))
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
    const values = (await withStore("readonly", (store) =>
      store.getAll()
    )) as readonly (
      | StoredSliceWalletExecutionSession
      | StoredSliceWalletPendingReplacement
    )[]
    const slicerIds = [
      ...new Set(
        values.flatMap((value) =>
          "kind" in value &&
          value.kind === "store_management" &&
          value.accountAddress.toLowerCase() === accountAddress.toLowerCase()
            ? [value.slicerId]
            : []
        )
      )
    ]
    const results = await Promise.all(
      slicerIds.map((slicerId) =>
        readStoredExecutionSessionResult(
          accountAddress,
          "store_management",
          slicerId
        )
      )
    )
    if (results.some((result) => result.status === "unavailable")) {
      return { status: "unavailable" }
    }
    return {
      status: "available",
      values: results.flatMap((result) =>
        result.status === "found" && result.value.kind === "store_management"
          ? [result.value]
          : []
      )
    }
  } catch {
    return { status: "unavailable" }
  }
}
