import type {
  SliceWalletFrameSessionKey,
  SliceWalletSessionStore,
  SliceWalletStoredSession
} from "../types"

const databaseName = "slice-wallet-signer"
const objectStoreName = "sessions"

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

const getAccountUnlockKey = (appOrigin: string, account: string) =>
  `unlock:${normalizeOrigin(appOrigin)}:${account.toLowerCase()}`

type PersistedSession = SliceWalletStoredSession & { id: string }
type PersistedAccountUnlock = { id: string; unlocked: true }

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
  return direct
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

const deleteExpiredSessions = async (database: IDBDatabase) => {
  const transaction = database.transaction(objectStoreName, "readwrite")
  const completed = transactionComplete(transaction)
  const request = transaction.objectStore(objectStoreName).openCursor()
  const cursorCompleted = new Promise<void>((resolve, reject) => {
    request.addEventListener("success", () => {
      const cursor = request.result
      if (cursor === null) {
        resolve()
        return
      }
      const value = cursor.value as PersistedAccountUnlock | PersistedSession
      if (
        "session" in value &&
        value.session.expiresAt <= Math.floor(Date.now() / 1_000)
      ) {
        cursor.delete()
      }
      cursor.continue()
    })
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB cursor failed.")),
      { once: true }
    )
  })
  await Promise.all([cursorCompleted, completed])
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
  return direct ?? null
}

export const createSliceWalletIndexedDbSessionStore = (
  indexedDb: IDBFactory = indexedDB
): SliceWalletSessionStore => {
  let garbageCollection: Promise<void> | null = null
  const openSessionDatabase = async () => {
    const database = await openDatabase(indexedDb)
    garbageCollection ??= deleteExpiredSessions(database).catch(() => undefined)
    await garbageCollection
    return database
  }
  return {
    commitPending: async (appOrigin, key) => {
      const database = await openSessionDatabase()
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
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readwrite")
      const store = transaction.objectStore(objectStoreName)
      store.delete(getRecordKey(appOrigin, key))
      store.delete(getPendingRecordKey(appOrigin, key))
      await transactionComplete(transaction)
      database.close()
    },
    deletePending: async (appOrigin, key) => {
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readwrite")
      transaction
        .objectStore(objectStoreName)
        .delete(getPendingRecordKey(appOrigin, key))
      await transactionComplete(transaction)
      database.close()
    },
    get: async (appOrigin, key) => {
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readonly")
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
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readonly")
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
    isAccountUnlocked: async (appOrigin, account) => {
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readonly")
      const record = await requestResult(
        transaction
          .objectStore(objectStoreName)
          .get(getAccountUnlockKey(appOrigin, account))
      )
      await transactionComplete(transaction)
      database.close()
      return (record as PersistedAccountUnlock | undefined)?.unlocked === true
    },
    putPending: async (record) => {
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readwrite")
      transaction.objectStore(objectStoreName).put({
        ...record,
        appOrigin: normalizeOrigin(record.appOrigin),
        id: getPendingRecordKey(record.appOrigin, record.session)
      } satisfies PersistedSession)
      await transactionComplete(transaction)
      database.close()
    },
    setAccountUnlocked: async (appOrigin, account, unlocked) => {
      const database = await openSessionDatabase()
      const transaction = database.transaction(objectStoreName, "readwrite")
      const store = transaction.objectStore(objectStoreName)
      const id = getAccountUnlockKey(appOrigin, account)
      if (unlocked) {
        store.put({ id, unlocked: true } satisfies PersistedAccountUnlock)
      } else {
        store.delete(id)
      }
      await transactionComplete(transaction)
      database.close()
    }
  }
}

export const createSliceWalletMemorySessionStore =
  (): SliceWalletSessionStore => {
    const records = new Map<string, SliceWalletStoredSession>()
    const unlockedAccounts = new Set<string>()
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
      isAccountUnlocked: async (appOrigin, account) =>
        unlockedAccounts.has(getAccountUnlockKey(appOrigin, account)),
      putPending: async (record) => {
        records.set(
          getPendingRecordKey(record.appOrigin, record.session),
          record
        )
      },
      setAccountUnlocked: async (appOrigin, account, unlocked) => {
        const key = getAccountUnlockKey(appOrigin, account)
        if (unlocked) {
          unlockedAccounts.add(key)
        } else {
          unlockedAccounts.delete(key)
        }
      }
    }
  }
