"use client"

import { type Dispatch, type SetStateAction, useCallback } from "react"
import { createSliceStoreManagementPolicyDescriptor } from "../execution"
import {
  buildSliceWalletPermissionRevocationCalls,
  type createSliceWalletCeremonyKernelAccount,
  getSliceWalletCallsHash,
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor,
  parseSliceWalletFrameSession
} from "../index"
import type { SliceAccountClient } from "../types/accountClient"
import type {
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types/frame"
import type {
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletManagementLifecycle,
  SliceWalletNotifications,
  SliceWalletProviderAdapters
} from "../types/react"
import type { useSliceWalletExecutionAuthority } from "./executionAuthority"
import {
  clearStoredExecutionSession,
  clearStoredPendingReplacementStrict,
  readStoredExecutionSession,
  readStoredPendingReplacementStrict,
  writeStoredExecutionSessionStrict
} from "./executionKeyStore"
import { SliceWalletEnablementError } from "./managementLifecycle"
import {
  getManagementDisablePreflight,
  isRegisteredManagementReplacement,
  managementFrameMatchesStored
} from "./managementOperations"
import { retrySliceWalletFinalityAction } from "./permissionLifecycle"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

export const useSliceWalletExecutionLifecycle = ({
  activeWalletRef,
  checkoutExecution,
  createReplacementFinalizationProof,
  executionSession,
  fetchCheckoutDelegation,
  getFrameClient,
  managementLifecycle,
  notifications,
  publicClient,
  setExecutionSession,
  setManagementExecutionSession,
  sliceAccountClient,
  storeManagement,
  walletChainId
}: {
  activeWalletRef: {
    current: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    } | null
  }
  checkoutExecution: SliceWalletProviderAdapters["checkoutExecution"]
  createReplacementFinalizationProof: ReturnType<
    typeof useSliceWalletExecutionAuthority
  >["createReplacementFinalizationProof"]
  executionSession: SliceWalletExecutionSession | null
  fetchCheckoutDelegation: ReturnType<
    typeof useSliceWalletExecutionAuthority
  >["fetchCheckoutDelegation"]
  getFrameClient: () => Promise<SliceWalletSignerFrameClient>
  managementLifecycle: SliceWalletManagementLifecycle
  notifications?: SliceWalletNotifications
  publicClient: Parameters<
    typeof buildSliceWalletPermissionRevocationCalls
  >[0]["client"]
  setExecutionSession: Dispatch<
    SetStateAction<SliceWalletExecutionSession | null>
  >
  setManagementExecutionSession: Dispatch<
    SetStateAction<Map<number, SliceWalletManagementExecutionSession>>
  >
  sliceAccountClient: SliceAccountClient | null
  storeManagement: SliceWalletProviderAdapters["storeManagement"]
  walletChainId: number
}) => {
  const refreshExecutionAllowance = useCallback(async () => {
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (!executionSession || !activeAccount) return
    try {
      if (!checkoutExecution) return
      const stored = await readStoredExecutionSession(activeAccount, "checkout")
      if (stored?.kind !== "checkout") return
      const frameClient = await getFrameClient()
      const frameResult = await frameClient.request({
        method: "getSession",
        params: {
          account: activeAccount,
          chainId: walletChainId,
          grantKind: "checkout"
        }
      })
      if (frameResult === null || typeof frameResult !== "object") return
      const session = parseSliceWalletFrameSession(
        frameResult as SliceWalletProtocolValue
      )
      const snapshot = await fetchCheckoutDelegation({
        delegationId: stored.delegationId,
        frameClient,
        session
      })
      if (!snapshot.delegation) {
        setExecutionSession(null)
        return
      }
      const delegation = snapshot.delegation
      setExecutionSession((current) =>
        current === null
          ? null
          : {
              ...current,
              allowanceUsdMicros: BigInt(delegation.allowanceUsdMicros),
              ...(delegation.budgetPeriodSec === undefined
                ? {}
                : { budgetPeriodSec: delegation.budgetPeriodSec }),
              remainingUsdMicros: BigInt(delegation.remainingUsdMicros)
            }
      )
    } catch {
      // Allowance refresh is best-effort; the active session remains usable.
    }
  }, [
    activeWalletRef,
    checkoutExecution,
    executionSession,
    fetchCheckoutDelegation,
    getFrameClient,
    setExecutionSession,
    walletChainId
  ])

  const clearManagementExecutionSession = useCallback(
    async (account: `0x${string}`, slicerId: number) => {
      await clearStoredExecutionSession(account, "store_management", slicerId)
      try {
        const frameClient = await getFrameClient()
        await frameClient.request({
          method: "clearSession",
          params: {
            account,
            chainId: walletChainId,
            grantKind: "management",
            slicerId
          }
        })
      } catch {
        // Parent metadata is still cleared; iframe state can clear later.
      }
      setManagementExecutionSession((current) => {
        const next = new Map(current)
        next.delete(slicerId)
        return next
      })
    },
    [getFrameClient, setManagementExecutionSession, walletChainId]
  )

  const disableManagementExecutionSession = useCallback(
    async ({
      slicerAddress,
      slicerId
    }: {
      slicerAddress: `0x${string}`
      slicerId: number
    }) => {
      const activeWallet = activeWalletRef.current
      if (!activeWallet || !sliceAccountClient) {
        throw new Error("Unlock your Slice wallet first.")
      }
      if (!storeManagement) {
        throw new Error("1-tap management is not available in this app.")
      }
      await managementLifecycle.runMutation({
        account: activeWallet.kernelAccount.address,
        slicerId,
        task: async (control) => {
          const frameClient = await getFrameClient()
          const [{ delegation }, frameResult, pendingFrameResult, pendingRead] =
            await Promise.all([
              storeManagement.fetchDelegation(slicerId),
              frameClient.request({
                method: "getSession",
                params: {
                  account: activeWallet.kernelAccount.address,
                  chainId: walletChainId,
                  grantKind: "management",
                  slicerId
                }
              }),
              frameClient.request({
                method: "getPendingSession",
                params: {
                  account: activeWallet.kernelAccount.address,
                  chainId: walletChainId,
                  grantKind: "management",
                  slicerId
                }
              }),
              readStoredPendingReplacementStrict(
                activeWallet.kernelAccount.address,
                "store_management",
                slicerId
              )
            ])
          if (!pendingRead.ok) {
            throw new SliceWalletEnablementError(
              "Slice Wallet session storage is unavailable. Retry before disabling 1-tap management.",
              "preserve-pending"
            )
          }
          const pendingReplacement = pendingRead.value
          const registeredPending = isRegisteredManagementReplacement(
            pendingReplacement
          )
            ? pendingReplacement
            : null
          const committedSession =
            frameResult !== null && typeof frameResult === "object"
              ? parseSliceWalletFrameSession(
                  frameResult as SliceWalletProtocolValue
                )
              : null
          const pendingTargetMatches =
            registeredPending !== null &&
            registeredPending.session.slicerId === slicerId &&
            registeredPending.session.slicerAddress.toLowerCase() ===
              slicerAddress.toLowerCase()
          const committedMatchesPending =
            registeredPending !== null &&
            managementFrameMatchesStored(
              committedSession,
              registeredPending.session,
              walletChainId
            )
          const preflight = getManagementDisablePreflight({
            committedMatchesPending,
            pendingPhase: pendingReplacement?.phase ?? null,
            pendingReadable: true,
            targetMatches:
              pendingReplacement === null ? true : pendingTargetMatches
          })
          if (preflight === "blocked") {
            throw new SliceWalletEnablementError(
              "A management permission change is still pending. Recover or retry it before disabling.",
              "preserve-pending"
            )
          }
          if (
            pendingFrameResult !== null &&
            typeof pendingFrameResult === "object"
          ) {
            throw new SliceWalletEnablementError(
              "A management permission change is still pending. Recover or retry it before disabling.",
              "preserve-pending"
            )
          }
          if (
            (preflight === "reconcile" || preflight === "state-changed") &&
            registeredPending !== null
          ) {
            try {
              await writeStoredExecutionSessionStrict(registeredPending.session)
              await clearStoredPendingReplacementStrict(
                activeWallet.kernelAccount.address,
                "store_management",
                slicerId
              )
            } catch {
              throw new SliceWalletEnablementError(
                "The committed management permission could not be reconciled. Retry before disabling.",
                "preserve-pending"
              )
            }
          }
          if (preflight === "state-changed") {
            throw new SliceWalletEnablementError(
              "The active management permission changed. Refresh this store and try again.",
              "hydrate"
            )
          }
          if (delegation === null) {
            throw new Error(
              "The management delegation is unavailable; revoke it from Slice ID."
            )
          }
          if (
            delegation.slicerId !== null &&
            delegation.slicerId !== slicerId
          ) {
            throw new SliceWalletEnablementError(
              "The active management permission belongs to another store. Refresh and try again.",
              "hydrate"
            )
          }
          const session = committedSession
          if (session === null) {
            throw new Error(
              "The management permission descriptor is unavailable; revoke it from Slice ID."
            )
          }
          if (
            delegation.permissionId === null ||
            delegation.signerPublicKey === null ||
            delegation.walletPolicy === null ||
            delegation.permissionId.toLowerCase() !==
              session.permissionId.toLowerCase() ||
            delegation.signerAddress.toLowerCase() !==
              session.signerId.toLowerCase() ||
            delegation.signerPublicKey.toLowerCase() !==
              session.publicKey.toLowerCase() ||
            getWalletPolicyHash(
              parseSerializedWalletPolicyDescriptor(delegation.walletPolicy)
            ) !== getWalletPolicyHash(session.policy)
          ) {
            throw new SliceWalletEnablementError(
              "The active management permission changed. Refresh this store and try again.",
              "hydrate"
            )
          }
          const expectedPolicy = createSliceStoreManagementPolicyDescriptor({
            account: activeWallet.kernelAccount.address,
            chainId: walletChainId,
            expiresAt: session.expiresAt,
            slicerAddress,
            slicerId,
            startsAt: session.policy.validAfter
          })
          if (
            getWalletPolicyHash(expectedPolicy) !==
            getWalletPolicyHash(session.policy)
          ) {
            throw new SliceWalletEnablementError(
              "The active management permission changed. Refresh this store and try again.",
              "hydrate"
            )
          }
          control.assertCurrent()
          const { calls } = await buildSliceWalletPermissionRevocationCalls({
            account: activeWallet.kernelAccount.address,
            client: publicClient,
            session
          })
          control.assertCurrent()
          const execution = await sliceAccountClient.sendCalls({ calls })
          const operation = {
            expectedDisableCallHash: getSliceWalletCallsHash(calls),
            userOperationHash: execution.executionId
          }
          await retrySliceWalletFinalityAction({
            createProof: () =>
              createReplacementFinalizationProof({
                action: "revoke",
                client: storeManagement.client,
                delegationId: delegation.delegationId,
                frameClient,
                session
              }),
            operation,
            request: async (proof) => {
              await storeManagement.client.revokeDelegation(proof)
            }
          })
          await clearManagementExecutionSession(
            activeWallet.kernelAccount.address,
            slicerId
          )
          control.assertCurrent()
          notifications?.success?.("1-tap management disabled")
        }
      })
    },
    [
      activeWalletRef,
      clearManagementExecutionSession,
      createReplacementFinalizationProof,
      getFrameClient,
      managementLifecycle,
      notifications,
      publicClient,
      sliceAccountClient,
      storeManagement,
      walletChainId
    ]
  )

  return {
    disableManagementExecutionSession,
    refreshExecutionAllowance
  }
}
