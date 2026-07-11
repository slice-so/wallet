import type {
  SliceWalletFrameSessionKey,
  SliceWalletSessionStore,
  SliceWalletStoredSession
} from "../types"

const databaseName = "slice-wallet-signer"
const objectStoreName = "sessions"
const databaseVersion = 1

const normalizeOrigin = (origin: string) => new URL(origin).origin

const getRecordKey = (appOrigin: string, key: SliceWalletFrameSessionKey) =>
  [
    normalizeOrigin(appOrigin),
    key.account.toLowerCase(),
    key.chainId,
    key.grantKind
  ].join(":")

const getPendingRecordKey = (
  appOrigin: string,
  key: SliceWalletFrameSessionKey
) => `${getRecordKey(appOrigin, key)}:pending`

type PersistedSession = SliceWalletStoredSession & { id: string }

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
  const request = indexedDb.open(databaseName, databaseVersion)
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(objectStoreName)) {
      request.result.createObjectStore(objectStoreName, { keyPath: "id" })
    }
  })
  return requestResult(request)
}

export const createSliceWalletIndexedDbSessionStore = (
  indexedDb: IDBFactory = indexedDB
): SliceWalletSessionStore => ({
  commitPending: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readwrite")
    const store = transaction.objectStore(objectStoreName)
    const pending = (await requestResult(
      store.get(getPendingRecordKey(appOrigin, key))
    )) as PersistedSession | undefined
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
    const transaction = database.transaction(objectStoreName, "readonly")
    const record = await requestResult(
      transaction.objectStore(objectStoreName).get(getRecordKey(appOrigin, key))
    )
    await transactionComplete(transaction)
    database.close()
    return (record as PersistedSession | undefined) ?? null
  },
  getPending: async (appOrigin, key) => {
    const database = await openDatabase(indexedDb)
    const transaction = database.transaction(objectStoreName, "readonly")
    const record = await requestResult(
      transaction
        .objectStore(objectStoreName)
        .get(getPendingRecordKey(appOrigin, key))
    )
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
        const pending = records.get(pendingKey)
        if (pending === undefined) {
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
        records.get(getRecordKey(appOrigin, key)) ?? null,
      getPending: async (appOrigin, key) =>
        records.get(getPendingRecordKey(appOrigin, key)) ?? null,
      putPending: async (record) => {
        records.set(
          getPendingRecordKey(record.appOrigin, record.session),
          record
        )
      }
    }
  }
