import {
  SliceWalletExecutionRequestError,
  type SliceWalletExecutionSessionProof,
  type SliceWalletReplacementFinalization
} from "../execution"
import type { StoredSliceWalletPendingReplacement } from "../types/react"

const defaultSleep = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs))

const isExecutionRequestError = (error: Error, status: number, code: string) =>
  error instanceof SliceWalletExecutionRequestError &&
  error.status === status &&
  error.code === code

export const isSliceWalletDelegationNotFoundError = (error: Error) =>
  isExecutionRequestError(error, 404, "delegation_not_found")

export const getSliceWalletPendingRegistrationAction = ({
  hasPendingFrame,
  replacement
}: {
  hasPendingFrame: boolean
  replacement: StoredSliceWalletPendingReplacement | null
}): "ambiguous" | "discard_orphan" | "none" | "resume" => {
  if (!hasPendingFrame) return replacement === null ? "none" : "ambiguous"
  if (replacement === null) return "discard_orphan"
  return replacement.phase === "registering" ? "ambiguous" : "resume"
}

export const retrySliceWalletFinalityAction = async ({
  createProof,
  deadlineMs = 45_000,
  initialDelayMs = 250,
  maxDelayMs = 4_000,
  now = Date.now,
  operation,
  request,
  sleep = defaultSleep
}: {
  createProof: () => Promise<SliceWalletExecutionSessionProof>
  deadlineMs?: number
  initialDelayMs?: number
  maxDelayMs?: number
  now?: () => number
  operation: Pick<
    SliceWalletReplacementFinalization,
    "expectedDisableCallHash" | "userOperationHash"
  >
  request: (proof: SliceWalletReplacementFinalization) => Promise<void>
  sleep?: (durationMs: number) => Promise<void>
}) => {
  const deadline = now() + deadlineMs
  let delayMs = initialDelayMs
  while (true) {
    try {
      await request({ ...(await createProof()), ...operation })
      return
    } catch (caught) {
      const error =
        caught instanceof Error
          ? caught
          : new Error("Slice Wallet finalization failed.")
      if (
        !isExecutionRequestError(error, 409, "revocation_not_final") ||
        now() + delayMs > deadline
      ) {
        throw error
      }
      await sleep(delayMs)
      delayMs = Math.min(delayMs * 2, maxDelayMs)
    }
  }
}

export const resumeSliceWalletRegisteredReplacement = async ({
  activate,
  assertCurrent = () => undefined,
  clear,
  commit,
  discard,
  finalize,
  notifyRevoked,
  persist,
  probeCommitted
}: {
  activate: () => Promise<void>
  assertCurrent?: () => void
  clear: () => Promise<void>
  commit: () => Promise<void>
  discard: () => Promise<void>
  finalize: () => Promise<void>
  notifyRevoked: () => void
  persist: () => Promise<void>
  probeCommitted?: () => Promise<boolean>
}): Promise<"resumed" | "revoked"> => {
  try {
    await finalize()
  } catch (caught) {
    const error =
      caught instanceof Error
        ? caught
        : new Error("Slice Wallet replacement recovery failed.")
    if (!isSliceWalletDelegationNotFoundError(error)) throw error
    await Promise.all([discard().catch(() => undefined), clear()])
    notifyRevoked()
    return "revoked"
  }
  assertCurrent()
  try {
    await commit()
  } catch (caught) {
    if (probeCommitted === undefined || !(await probeCommitted())) throw caught
  }
  await persist()
  await clear()
  assertCurrent()
  await activate()
  assertCurrent()
  return "resumed"
}
