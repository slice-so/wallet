import type {
  SliceWalletCeremonyBroker,
  SliceWalletCeremonyContinuationResult,
  SliceWalletPendingCeremony,
  SliceWalletPendingCeremonyKind,
  SliceWalletPopupRequiredReason
} from "../types"

export class SliceWalletUserGestureRequiredError extends Error {
  readonly reason: SliceWalletPopupRequiredReason

  constructor(reason: SliceWalletPopupRequiredReason) {
    super("Continue the Slice Wallet ceremony from a top-level user gesture.")
    this.name = "SliceWalletUserGestureRequiredError"
    this.reason = reason
  }
}

type PendingIntent = {
  metadata: SliceWalletPendingCeremony
  reject: (error: Error) => void
  resolve: (value: SliceWalletCeremonyContinuationResult) => void
  resume: () => Promise<SliceWalletCeremonyContinuationResult>
  timeout: ReturnType<typeof setTimeout>
}

export const createSliceWalletCeremonyBroker = ({
  timeoutMs = 5 * 60_000
}: {
  timeoutMs?: number
} = {}): SliceWalletCeremonyBroker => {
  let intent: PendingIntent | null = null
  let continuation: Promise<SliceWalletCeremonyContinuationResult> | null = null
  const listeners = new Set<
    (pending: SliceWalletPendingCeremony | null) => void
  >()

  const notify = () => {
    const pending = intent?.metadata ?? null
    for (const listener of listeners) listener(pending)
  }
  const clear = () => {
    if (intent === null) return null
    const current = intent
    intent = null
    continuation = null
    clearTimeout(current.timeout)
    notify()
    return current
  }
  const rejectPending = (error: Error) => clear()?.reject(error)

  return {
    cancel: () =>
      rejectPending(new Error("Slice Wallet ceremony was cancelled.")),
    continueInPopup: () => {
      if (continuation !== null) return continuation
      const current = intent
      if (current === null) {
        return Promise.reject(new Error("No Slice Wallet ceremony is pending."))
      }
      continuation = current
        .resume()
        .then((result) => {
          if (intent === current) clear()?.resolve(result)
          return result
        })
        .catch((error) => {
          continuation = null
          if (error instanceof SliceWalletUserGestureRequiredError) {
            current.metadata = {
              ...current.metadata,
              reason: error.reason
            }
            notify()
          } else if (intent === current) {
            rejectPending(
              error instanceof Error
                ? error
                : new Error("Slice Wallet ceremony failed.")
            )
          }
          throw error
        })
      return continuation
    },
    defer: <Result extends SliceWalletCeremonyContinuationResult>({
      kind,
      reason,
      resume
    }: {
      kind: SliceWalletPendingCeremonyKind
      reason: SliceWalletPopupRequiredReason
      resume: () => Promise<Result>
    }) => {
      if (intent !== null) {
        return Promise.reject(
          new Error("Another Slice Wallet ceremony already requires attention.")
        )
      }
      const createdAt = Date.now()
      return new Promise<Result>((resolve, reject) => {
        const pending: PendingIntent = {
          metadata: {
            createdAt,
            expiresAt: createdAt + timeoutMs,
            kind,
            reason
          },
          reject,
          resolve: (value) => resolve(value as Result),
          resume,
          timeout: setTimeout(() => {
            if (intent !== pending) return
            rejectPending(new Error("Slice Wallet ceremony timed out."))
          }, timeoutMs)
        }
        intent = pending
        notify()
      })
    },
    getPending: () => intent?.metadata ?? null,
    subscribe: (listener) => {
      listeners.add(listener)
      listener(intent?.metadata ?? null)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

export const requireSliceWalletPopupGesture = <
  Result extends SliceWalletCeremonyContinuationResult
>({
  broker,
  kind,
  reason,
  resume
}: {
  broker?: SliceWalletCeremonyBroker
  kind: SliceWalletPendingCeremonyKind
  reason: SliceWalletPopupRequiredReason
  resume: () => Promise<Result>
}) => {
  if (broker === undefined) {
    throw new SliceWalletUserGestureRequiredError(reason)
  }
  return broker.defer({ kind, reason, resume })
}
