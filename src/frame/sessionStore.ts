import type {
  SliceWalletFrameSessionKey,
  SliceWalletSessionStore,
  SliceWalletStoredSession
} from "../types"

const databaseName = "slice-wallet-signer"
const objectStoreName = "sessions"

const normalizeOrigin = (origin: string) => new URL(origin).origin

const getLegacyRecordKey = (
  appOrigin: string,
  key: SliceWalletFrameSessionKey
) =>
  [
    normalizeOrigin(appOrigin),
    key.account.toLowerCase(),
    key.chainId,
    key.grantKind
  ].join(":")

const getRecordKey = (appOrigin: string, key: SliceWalletFrameSessionKey) => {
  const base = getLegacyRecordKey(appOrigin, key)
  if (key.grantKind !== "management") return base
  if (
    key.slicerId === undefined ||
    !Number.isSafeInteger(key.slicerId) ||
    key.slicerId <= 0
  ) {
    throw new Error("Management session keys require a positive slicer id.")
  }
  return `${base}:${key.slicerId}`
}

const getPendingRecordKey = (
  appOrigin: string,
  key: SliceWalletFrameSessionKey
) => `${getRecordKey(appOrigin, key)}:pending`

type PersistedSession = SliceWalletStoredSession & { id: string }

const getStoredManagementSlicerId = (record: SliceWalletStoredSession) => {
  if (
    record.session.slicerId !== undefined &&
    Number.isSafeInteger(record.session.slicerId) &&
    record.session.slicerId > 0
  ) {
    return record.session.slicerId
  }
  const values = new Set(
    record.session.policy.calls.flatMap((call) =>
      call.parameterRules.flatMap((rule) =>
        rule.offset === 0 &&
        rule.condition === "equal" &&
        rule.params.length === 1
          ? rule.params
          : []
      )
    )
  )
  if (values.size !== 1) return null
  const [value] = values
  if (value === undefined) return null
  const slicerId = Number(BigInt(value))
  return Number.isSafeInteger(slicerId) && slicerId > 0 ? slicerId : null
}

const readPersistedSession = async ({
  appOrigin,
  key,
  pending,
  store
}: {
  appOrigin: string
  key: SliceWalletFrameSessionKey
  pending: boolean
  store: IDBObjectStore
}) => {
  const targetKey = pending
    ? getPendingRecordKey(appOrigin, key)
    : getRecordKey(appOrigin, key)
  const direct = (await requestResult(store.get(targetKey))) as
    | PersistedSession
    | undefined
  if (direct !== undefined || key.grantKind !== "management") return direct

  const legacyBase = getLegacyRecordKey(appOrigin, key)
  const legacyKey = pending ? `${legacyBase}:pending` : legacyBase
  const legacy = (await requestResult(store.get(legacyKey))) as
    | PersistedSession
    | undefined
  if (
    legacy === undefined ||
    getStoredManagementSlicerId(legacy) !== key.slicerId
  ) {
    return undefined
  }
  const migrated = {
    ...legacy,
    id: targetKey,
    session: { ...legacy.session, slicerId: key.slicerId }
  } satisfies PersistedSession
  store.put(migrated)
  store.delete(legacyKey)
  return migrated
}

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true
    })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true }
    )
  })

const transactionComplete = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true })
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("IndexedDB transaction aborted.")
        ),
      { once: true }
    )
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true }
    )
  })

const openDatabase = (indexedDb: IDBFactory) => {
  const request = indexedDb.open(databaseName)
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(objectStoreName)) {
      request.result.createObjectStore(objectStoreName, { keyPath: "id" })
    }
  })
  return requestResult(request)
}

const readMemoryRecord = ({
  appOrigin,
  key,
  pending,
  records
}: {
  appOrigin: string
  key: SliceWalletFrameSessionKey
  pending: boolean
  records: Map<string, SliceWalletStoredSession>
}) => {
  const targetKey = pending
    ? getPendingRecordKey(appOrigin, key)
    : getRecordKey(appOrigin, key)
  const direct = records.get(targetKey)
  if (direct !== undefined || key.grantKind !== "management") {
    return direct ?? null
  }
  const legacyBase = getLegacyRecordKey(appOrigin, key)
  const legacyKey = pending ? `${legacyBase}:pending` : legacyBase
  const legacy = records.get(legacyKey)
  if (
    legacy === undefined ||
    getStoredManagementSlicerId(legacy) !== key.slicerId
  ) {
    return null
  }
  const migrated = {
    ...legacy,
    session: { ...legacy.session, slicerId: key.slicerId }
  }
  records.set(targetKey, migrated)
  records.delete(legacyKey)
  return migrated
}

export const createSliceWalletIndexedDbSessionStore = (
  indexedDb: IDBFactory = indexedDB
): SliceWalletSessionStore => ({
  commitPending: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    const store = transaction.objectStore(objectStoreName)
    const pending = await readPersistedSession({
      appOrigin,
      key,
      pending: true,
      store
    })
    if (pending === undefined) {
      transaction.abort()
      database.close()
      throw new Error("Pending wallet session is unavailable.")
    }
    const committed = {
      ...pending,
      id: getRecordKey(appOrigin, key)
    } satisfies PersistedSession
    store.put(committed)
    store.delete(getPendingRecordKey(appOrigin, key))
    await transactionComplete(transaction)
    database.close()
    return committed
  },
  delete: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    const store = transaction.objectStore(objectStoreName)
    store.delete(getRecordKey(appOrigin, key))
    store.delete(getPendingRecordKey(appOrigin, key))
    await transactionComplete(transaction)
    database.close()
  },
  deletePending: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    transaction
      .objectStore(objectStoreName)
      .delete(getPendingRecordKey(appOrigin, key))
    await transactionComplete(transaction)
    database.close()
  },
  get: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    const record = await readPersistedSession({
      appOrigin,
      key,
      pending: false,
      store: transaction.objectStore(objectStoreName)
    })
    await transactionComplete(transaction)
    database.close()
    return (record as PersistedSession | undefined) ?? null
  },
  getPending: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    const record = await readPersistedSession({
      appOrigin,
      key,
      pending: true,
      store: transaction.objectStore(objectStoreName)
    })
    await transactionComplete(transaction)
    database.close()
    return (record as PersistedSession | undefined) ?? null
  },
  putPending: async (record) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    transaction.objectStore(objectStoreName).put({
      ...record,
      appOrigin: normalizeOrigin(record.appOrigin),
      id: getPendingRecordKey(record.appOrigin, record.session)
    } satisfies PersistedSession)
    await transactionComplete(transaction)
    database.close()
  }
})

export const createSliceWalletMemorySessionStore =
  (): SliceWalletSessionStore => {
    const records = new Map<string, SliceWalletStoredSession>()
    return {
      commitPending: async (appOrigin, key) => {
        const pendingKey = getPendingRecordKey(appOrigin, key)
        const pending = readMemoryRecord({
          appOrigin,
          key,
          pending: true,
          records
        })
        if (pending === null) {
          throw new Error("Pending wallet session is unavailable.")
        }
        records.set(getRecordKey(appOrigin, key), pending)
        records.delete(pendingKey)
        return pending
      },
      delete: async (appOrigin, key) => {
        records.delete(getRecordKey(appOrigin, key))
        records.delete(getPendingRecordKey(appOrigin, key))
      },
      deletePending: async (appOrigin, key) => {
        records.delete(getPendingRecordKey(appOrigin, key))
      },
      get: async (appOrigin, key) =>
        readMemoryRecord({ appOrigin, key, pending: false, records }),
      getPending: async (appOrigin, key) =>
        readMemoryRecord({ appOrigin, key, pending: true, records }),
      putPending: async (record) => {
        records.set(
          getPendingRecordKey(record.appOrigin, record.session),
          record
        )
      }
    }
  }
