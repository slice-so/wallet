import { type Address, isAddressEqual } from "viem"
import type {
  SliceWalletManagementHydrationSnapshot,
  SliceWalletManagementLifecycle,
  SliceWalletManagementLifecycleControl,
  SliceWalletManagementMutationBroadcast,
  SliceWalletManagementRecoveryMode
} from "../types/react"

export class SliceWalletEnablementError extends Error {
  readonly recoveryMode: SliceWalletManagementRecoveryMode

  constructor(
    message: string,
    recoveryMode: SliceWalletManagementRecoveryMode
  ) {
    super(message)
    this.name = "SliceWalletEnablementError"
    this.recoveryMode = recoveryMode
  }
}

export const IDLE_MANAGEMENT_HYDRATION_SNAPSHOT = {
  status: "idle",
  error: null
} satisfies SliceWalletManagementHydrationSnapshot

const createSourceId = () =>
  typeof crypto === "undefined"
    ? `${Date.now()}-${Math.random()}`
    : crypto.randomUUID()

const addressesEqual = (left: Address | null, right: Address | null) =>
  left === null || right === null ? left === right : isAddressEqual(left, right)

export const shouldHandleManagementMutation = ({
  activeAccount,
  chainId,
  message,
  sourceId
}: {
  activeAccount: Address | null
  chainId: number
  message: SliceWalletManagementMutationBroadcast
  sourceId: string
}) =>
  activeAccount !== null &&
  message.sourceId !== sourceId &&
  message.chainId === chainId &&
  isAddressEqual(activeAccount, message.account)

export const createManagementLifecycle = ({
  chainId,
  hydrate,
  onIdentityChange,
  onMutation
}: {
  chainId: number
  hydrate: (
    account: Address,
    control: SliceWalletManagementLifecycleControl
  ) => Promise<void>
  onIdentityChange: () => void
  onMutation?: (message: SliceWalletManagementMutationBroadcast) => void
}): SliceWalletManagementLifecycle => {
  const sourceId = createSourceId()
  let account: Address | null = null
  let identityEpoch = 0
  let mutationSeq = 0
  let completedMutationSeq = 0
  let hydrationSeq = 0
  let completedHydrationSeq = 0
  let snapshot: SliceWalletManagementHydrationSnapshot =
    IDLE_MANAGEMENT_HYDRATION_SNAPSHOT
  let queue = Promise.resolve()
  const listeners = new Set<() => void>()

  const publishSnapshot = (next: SliceWalletManagementHydrationSnapshot) => {
    if (snapshot.status === next.status && snapshot.error === next.error) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const updateSettlement = () => {
    if (
      completedMutationSeq < mutationSeq ||
      completedHydrationSeq < hydrationSeq
    ) {
      publishSnapshot({ ...snapshot, status: "pending" })
      return
    }
    publishSnapshot({ ...snapshot, status: "settled" })
  }

  const withDocumentLock = async <Result>(
    target: Address,
    task: () => Promise<Result>
  ) => {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks
    if (locks === undefined) return task()
    return locks.request(
      `slice-wallet:management:${chainId}:${target.toLowerCase()}`,
      task
    )
  }

  const serialize = <Result>(target: Address, task: () => Promise<Result>) => {
    const result = queue.then(
      () => withDocumentLock(target, task),
      () => withDocumentLock(target, task)
    )
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const createControl = (
    target: Address,
    epoch: number
  ): SliceWalletManagementLifecycleControl => ({
    assertCurrent: () => {
      if (
        epoch !== identityEpoch ||
        account === null ||
        !isAddressEqual(account, target)
      ) {
        throw new SliceWalletEnablementError(
          "The active Slice wallet changed. Try again with the current wallet.",
          "hydrate"
        )
      }
    },
    markStorageUnavailable: () => {
      if (
        epoch === identityEpoch &&
        account !== null &&
        isAddressEqual(account, target)
      ) {
        publishSnapshot({
          error: "storage-unavailable",
          status: snapshot.status
        })
      }
    }
  })

  const runHydration = (
    target: Address,
    task: (control: SliceWalletManagementLifecycleControl) => Promise<void> = (
      control
    ) => hydrate(target, control)
  ) => {
    const epoch = identityEpoch
    const requestedMutationSeq = mutationSeq
    const requestedHydrationSeq = ++hydrationSeq
    publishSnapshot({ error: null, status: "pending" })

    return serialize(target, async () => {
      const control = createControl(target, epoch)
      try {
        control.assertCurrent()
        await task(control)
      } finally {
        if (
          epoch === identityEpoch &&
          requestedHydrationSeq === hydrationSeq &&
          requestedMutationSeq === mutationSeq
        ) {
          completedHydrationSeq = requestedHydrationSeq
        }
        updateSettlement()
      }
    })
  }

  const retryHydration = (target: Address) => runHydration(target)

  const runMutation = async <Result>({
    account: target,
    task
  }: {
    account: Address
    task: (control: SliceWalletManagementLifecycleControl) => Promise<Result>
  }) => {
    const epoch = identityEpoch
    const requestedHydrationSeq = hydrationSeq
    const requestedMutationSeq = ++mutationSeq
    publishSnapshot({ ...snapshot, status: "pending" })
    let outcome: SliceWalletManagementMutationBroadcast["outcome"] = "error"

    try {
      const result = await serialize(target, async () => {
        const control = createControl(target, epoch)
        control.assertCurrent()
        return task(control)
      })
      outcome = "success"
      return result
    } catch (caught) {
      if (
        caught instanceof SliceWalletEnablementError &&
        caught.recoveryMode === "hydrate"
      ) {
        void retryHydration(target).catch(() => undefined)
      }
      throw caught
    } finally {
      if (requestedMutationSeq === mutationSeq) {
        completedMutationSeq = requestedMutationSeq
        if (requestedHydrationSeq === hydrationSeq) {
          completedHydrationSeq = hydrationSeq
        }
      }
      onMutation?.({ account: target, chainId, outcome, sourceId })
      updateSettlement()
    }
  }

  const markNothingToHydrate = (target: Address) => {
    const epoch = identityEpoch
    const requestedMutationSeq = mutationSeq
    const requestedHydrationSeq = ++hydrationSeq
    publishSnapshot({ error: null, status: "pending" })
    if (
      epoch === identityEpoch &&
      requestedMutationSeq === mutationSeq &&
      account !== null &&
      isAddressEqual(account, target)
    ) {
      completedHydrationSeq = requestedHydrationSeq
    }
    updateSettlement()
  }

  const setAccount = (next: Address | null) => {
    if (addressesEqual(account, next)) return
    account = next
    identityEpoch += 1
    mutationSeq = 0
    completedMutationSeq = 0
    hydrationSeq = 0
    completedHydrationSeq = 0
    onIdentityChange()
    publishSnapshot(IDLE_MANAGEMENT_HYDRATION_SNAPSHOT)
  }

  const handleExternalMutation = (target: Address) => {
    if (account === null || !isAddressEqual(account, target)) return
    identityEpoch += 1
    mutationSeq = 0
    completedMutationSeq = 0
    hydrationSeq = 0
    completedHydrationSeq = 0
    onIdentityChange()
    void retryHydration(target).catch(() => undefined)
  }

  return {
    getAccount: () => account,
    getSnapshot: () => snapshot,
    handleExternalMutation,
    markNothingToHydrate,
    retryHydration,
    runHydration,
    runMutation,
    setAccount,
    sourceId,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
