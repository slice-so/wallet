import type { Address } from "viem"
import { createSliceStoreManagementPolicyDescriptor } from "../execution"
import {
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor,
  parseSliceWalletFrameSession
} from "../index"
import type {
  SliceWalletFrameSession,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types/frame"
import type {
  SliceWalletManagementLifecycleControl,
  SliceWalletProviderAdapters,
  StoredSliceWalletExecutionSession
} from "../types/react"
import {
  clearStoredExecutionSession,
  readStoredExecutionSessionResult
} from "./executionKeyStore"

type StoredManagementSession = Extract<
  StoredSliceWalletExecutionSession,
  { kind: "store_management" }
>

const clearManagementFrameSession = async ({
  account,
  chainId,
  frameClient
}: {
  account: Address
  chainId: number
  frameClient: SliceWalletSignerFrameClient
}) => {
  await frameClient
    .request({
      method: "clearSession",
      params: { account, chainId, grantKind: "management" }
    })
    .catch(() => undefined)
}

export const hydrateStoredManagementExecutionSession = async ({
  account,
  activate,
  chainId,
  clearStoredSession = clearStoredExecutionSession,
  control,
  fetchDelegation,
  getFrameClient,
  readStoredSession = readStoredExecutionSessionResult,
  setSessionNull
}: {
  account: Address
  activate: (input: {
    session: SliceWalletFrameSession
    stored: StoredManagementSession
  }) => Promise<void>
  chainId: number
  clearStoredSession?: typeof clearStoredExecutionSession
  control: SliceWalletManagementLifecycleControl
  fetchDelegation: NonNullable<
    SliceWalletProviderAdapters["storeManagement"]
  >["fetchDelegation"]
  getFrameClient: () => Promise<SliceWalletSignerFrameClient>
  readStoredSession?: typeof readStoredExecutionSessionResult
  setSessionNull: () => void
}) => {
  const storedResult = await readStoredSession(account, "store_management")
  control.assertCurrent()

  if (storedResult.status === "unavailable") {
    setSessionNull()
    control.markStorageUnavailable()
    return
  }
  if (storedResult.status === "missing") {
    let activeDelegationExists = false
    try {
      const { delegation } = await fetchDelegation()
      activeDelegationExists =
        delegation !== null &&
        delegation.signerScheme === "p256" &&
        delegation.permissionId !== null
    } catch {
      // Without store-keyed local evidence, an outage is indistinguishable
      // from a never-enabled store, which must remain eligible for root routing.
    }
    control.assertCurrent()
    setSessionNull()
    if (activeDelegationExists) control.markError("session-invalid")
    return
  }

  const clearInvalidSession = async (
    frameClient?: SliceWalletSignerFrameClient
  ) => {
    control.assertCurrent()
    setSessionNull()
    if (storedResult.status === "found") {
      await clearStoredSession(account, "store_management")
    }
    if (frameClient !== undefined) {
      await clearManagementFrameSession({
        account,
        chainId,
        frameClient
      })
    } else {
      try {
        await clearManagementFrameSession({
          account,
          chainId,
          frameClient: await getFrameClient()
        })
      } catch {
        // The invalid local record is already gone; repair can replace the frame.
      }
    }
    control.markError("session-invalid")
  }

  if (storedResult.status === "invalid") {
    await clearInvalidSession()
    return
  }
  if (storedResult.value.kind !== "store_management") {
    await clearInvalidSession()
    return
  }

  const stored = storedResult.value
  let frameClient: SliceWalletSignerFrameClient
  let frameResult: SliceWalletProtocolValue
  let delegation: Awaited<ReturnType<typeof fetchDelegation>>["delegation"]
  try {
    frameClient = await getFrameClient()
    const results = await Promise.all([
      frameClient.request({
        method: "getSession",
        params: { account, chainId, grantKind: "management" }
      }),
      fetchDelegation()
    ])
    frameResult = results[0]
    delegation = results[1].delegation
  } catch {
    control.assertCurrent()
    setSessionNull()
    control.markError("transport-unavailable")
    return
  }

  if (
    frameResult === null ||
    typeof frameResult !== "object" ||
    delegation === null ||
    delegation.signerScheme !== "p256" ||
    delegation.permissionId === null ||
    delegation.signerPublicKey === null ||
    delegation.walletPolicy === null
  ) {
    await clearInvalidSession(frameClient)
    return
  }

  let session: SliceWalletFrameSession
  try {
    session = parseSliceWalletFrameSession(frameResult)
    const apiPolicy = parseSerializedWalletPolicyDescriptor(
      delegation.walletPolicy
    )
    const expectedPolicy = createSliceStoreManagementPolicyDescriptor({
      account,
      chainId,
      expiresAt: session.expiresAt,
      sessionSignerAddress: session.signerId,
      startsAt: session.policy.validAfter
    })
    if (
      getWalletPolicyHash(apiPolicy) !== getWalletPolicyHash(session.policy) ||
      getWalletPolicyHash(expectedPolicy) !==
        getWalletPolicyHash(session.policy) ||
      delegation.permissionId.toLowerCase() !==
        session.permissionId.toLowerCase() ||
      delegation.signerAddress.toLowerCase() !==
        session.signerId.toLowerCase() ||
      delegation.signerPublicKey.toLowerCase() !==
        session.publicKey.toLowerCase() ||
      stored.permissionId.toLowerCase() !==
        session.permissionId.toLowerCase() ||
      stored.signerAddress.toLowerCase() !== session.signerId.toLowerCase()
    ) {
      await clearInvalidSession(frameClient)
      return
    }
  } catch {
    await clearInvalidSession(frameClient)
    return
  }

  try {
    await activate({ session, stored })
  } catch {
    control.assertCurrent()
    setSessionNull()
    control.markError("transport-unavailable")
  }
}
