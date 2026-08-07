import type { Address } from "viem"
import { createSliceStoreManagementPolicyDescriptor } from "../execution"
import { getWalletPolicyHash, parseSliceWalletFrameSession } from "../index"
import type {
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types"
import type {
  StoredSliceWalletExecutionSession,
  StoredSliceWalletPendingReplacement,
  StoredSliceWalletRegisteredReplacement
} from "../types/react"
import { readStoredPendingReplacementStrict } from "./executionKeyStore"
import { SliceWalletEnablementError } from "./managementLifecycle"

export const parseManagementFrameSession = (value: object | null) =>
  value === null
    ? null
    : parseSliceWalletFrameSession(value as SliceWalletProtocolValue)

export const loadManagementReplacementState = async ({
  account,
  chainId,
  frameClient
}: {
  account: Address
  chainId: number
  frameClient: SliceWalletSignerFrameClient
}) => {
  const [pendingValue, committedValue, replacementRead] = await Promise.all([
    frameClient.request({
      method: "getPendingSession",
      params: { account, chainId, grantKind: "management" }
    }),
    frameClient.request({
      method: "getSession",
      params: { account, chainId, grantKind: "management" }
    }),
    readStoredPendingReplacementStrict(account, "store_management")
  ])
  if (!replacementRead.ok) {
    throw new SliceWalletEnablementError(
      "Slice Wallet session storage is unavailable. Retry before enabling 1-tap management.",
      "preserve-pending"
    )
  }
  return {
    committed: parseManagementFrameSession(
      committedValue !== null && typeof committedValue === "object"
        ? committedValue
        : null
    ),
    pending: parseManagementFrameSession(
      pendingValue !== null && typeof pendingValue === "object"
        ? pendingValue
        : null
    ),
    replacement: replacementRead.value
  }
}

export const managementFrameMatchesStored = (
  frame: ReturnType<typeof parseSliceWalletFrameSession> | null,
  stored: Extract<
    StoredSliceWalletExecutionSession,
    { kind: "store_management" }
  >,
  chainId: number
) =>
  frame !== null &&
  frame.chainId === chainId &&
  frame.grantKind === "management" &&
  frame.account.toLowerCase() === stored.accountAddress.toLowerCase() &&
  frame.permissionId.toLowerCase() === stored.permissionId.toLowerCase() &&
  frame.signerId.toLowerCase() === stored.signerAddress.toLowerCase() &&
  getWalletPolicyHash(frame.policy) ===
    getWalletPolicyHash(
      createSliceStoreManagementPolicyDescriptor({
        account: stored.accountAddress,
        chainId,
        expiresAt: frame.expiresAt,
        startsAt: frame.policy.validAfter
      })
    )

type RegisteredManagementReplacement =
  StoredSliceWalletRegisteredReplacement & {
    session: Extract<
      StoredSliceWalletExecutionSession,
      { kind: "store_management" }
    >
  }

export const isRegisteredManagementReplacement = (
  replacement: StoredSliceWalletPendingReplacement | null
): replacement is RegisteredManagementReplacement =>
  replacement?.phase === "registered" &&
  replacement.session.kind === "store_management"

export const rejectRevokedManagementPermission = (): never => {
  const message =
    "This management permission was revoked from Slice ID. Enable it again to continue."
  throw new SliceWalletEnablementError(message, "hydrate")
}

type ManagementPendingAction =
  | "ambiguous"
  | "complete-bookkeeping"
  | "discard-orphan"
  | "none"
  | "resume"

export const classifyManagementPendingAction = ({
  hasMatchingCommittedFrame,
  hasPendingFrame,
  pendingPhase,
  pendingMatchesRegistered
}: {
  hasMatchingCommittedFrame: boolean
  hasPendingFrame: boolean
  pendingPhase: "registered" | "registering" | null
  pendingMatchesRegistered: boolean
}): ManagementPendingAction => {
  if (pendingPhase === "registering") return "ambiguous"
  if (pendingPhase === null) {
    return hasPendingFrame ? "discard-orphan" : "none"
  }
  if (hasPendingFrame && !pendingMatchesRegistered) return "ambiguous"
  if (!hasPendingFrame && !hasMatchingCommittedFrame) return "ambiguous"
  return hasPendingFrame ? "resume" : "complete-bookkeeping"
}

type ManagementDisablePreflight =
  | "blocked"
  | "proceed"
  | "reconcile"
  | "state-changed"
  | "storage-unavailable"

export const getEnablementRecoveryMode = ({
  bookkeepingComplete,
  pendingPhase
}: {
  bookkeepingComplete: boolean
  pendingPhase: "registered" | "registering" | null
}) =>
  bookkeepingComplete || pendingPhase === null
    ? ("hydrate" as const)
    : ("preserve-pending" as const)

export const getManagementHydrationGuard = ({
  pendingPhase,
  readable
}: {
  pendingPhase: "registered" | "registering" | null
  readable: boolean
}): "hydrate" | "skip" | "storage-unavailable" => {
  if (!readable) return "storage-unavailable"
  return pendingPhase === null ? "hydrate" : "skip"
}

export const getManagementDisablePreflight = ({
  committedMatchesPending,
  pendingReadable,
  pendingPhase,
  targetMatches
}: {
  committedMatchesPending: boolean
  pendingReadable: boolean
  pendingPhase: "registered" | "registering" | null
  targetMatches: boolean
}): ManagementDisablePreflight => {
  if (!pendingReadable) return "storage-unavailable"
  if (pendingPhase === "registering") return "blocked"
  if (pendingPhase === "registered") {
    if (!committedMatchesPending) return "blocked"
    return targetMatches ? "reconcile" : "state-changed"
  }
  return targetMatches ? "proceed" : "state-changed"
}

export const runManagementRegistrationPhase = async <Registration>({
  assertCurrent,
  finalize,
  persistRegistered,
  register
}: {
  assertCurrent: () => void
  finalize: (registration: Registration) => Promise<void>
  persistRegistered: (registration: Registration) => Promise<void>
  register: () => Promise<Registration>
}) => {
  assertCurrent()
  const registration = await register()
  await persistRegistered(registration)
  assertCurrent()
  await finalize(registration)
  assertCurrent()
  return registration
}

export const runManagementCommitPhase = async ({
  activate,
  assertCurrent,
  clearPending,
  commit,
  persist,
  probeCommitted
}: {
  activate: () => Promise<void>
  assertCurrent: () => void
  clearPending: () => Promise<void>
  commit: () => Promise<void>
  persist: () => Promise<void>
  probeCommitted: () => Promise<boolean>
}) => {
  assertCurrent()
  try {
    await commit()
  } catch {
    if (!(await probeCommitted())) {
      throw new SliceWalletEnablementError(
        "The management session commit could not be confirmed. Try again to reconcile it.",
        "preserve-pending"
      )
    }
  }

  try {
    await persist()
  } catch {
    throw new SliceWalletEnablementError(
      "The management session could not be saved. Try again to reconcile it.",
      "preserve-pending"
    )
  }
  try {
    await clearPending()
  } catch {
    throw new SliceWalletEnablementError(
      "The management session was committed but cleanup is incomplete. Try again to reconcile it.",
      "preserve-pending"
    )
  }

  assertCurrent()
  try {
    await activate()
  } catch (caught) {
    if (caught instanceof SliceWalletEnablementError) throw caught
    throw new SliceWalletEnablementError(
      "1-tap management was enabled but this device could not activate it. Retry to refresh the session.",
      "hydrate"
    )
  }
  assertCurrent()
}
