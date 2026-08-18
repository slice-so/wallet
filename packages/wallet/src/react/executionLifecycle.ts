"use client"

import { createSliceStoreManagementPolicyDescriptor } from "@slicekit/wallet-protocol/execution"
import {
  getWalletPolicyHash,
  parseSerializedWalletPolicyDescriptor
} from "@slicekit/wallet-protocol/policy"
import {
  buildSliceWalletPermissionRevocationCalls,
  getSliceWalletCallsHash
} from "@slicekit/wallet-protocol/server"
import { type Dispatch, type SetStateAction, useCallback } from "react"
import { parseSliceWalletFrameSession } from "../ceremony/protocol"
import type { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
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
import {
  isSliceWalletDelegationUnavailableError,
  retrySliceWalletFinalityAction
} from "./permissionLifecycle"

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
    SetStateAction<SliceWalletManagementExecutionSession | null>
  >
  sliceAccountClient: SliceAccountClient | null
  storeManagement: SliceWalletProviderAdapters["storeManagement"]
  walletChainId: number
}) => {
  const clearCheckoutExecutionSession = useCallback(async () => {
    setExecutionSession(null)
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (!activeAccount) return
    await clearStoredExecutionSession(activeAccount, "checkout")
    try {
      const frameClient = await getFrameClient()
      await frameClient.request({
        method: "clearSession",
        params: {
          account: activeAccount,
          chainId: walletChainId,
          grantKind: "checkout"
        }
      })
    } catch {
      // Parent metadata is cleared; iframe state can clear later.
    }
  }, [activeWalletRef, getFrameClient, setExecutionSession, walletChainId])

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
        await clearCheckoutExecutionSession()
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
    } catch (caught) {
      const error =
        caught instanceof Error
          ? caught
          : new Error("Slice Wallet delegation refresh failed.")
      if (isSliceWalletDelegationUnavailableError(error)) {
        await clearCheckoutExecutionSession()
      }
      // Transient refresh failures leave the active session unchanged.
    }
  }, [
    activeWalletRef,
    checkoutExecution,
    clearCheckoutExecutionSession,
    executionSession,
    fetchCheckoutDelegation,
    getFrameClient,
    walletChainId,
    setExecutionSession
  ])

  const clearManagementExecutionSession = useCallback(
    async (account: `0x${string}`) => {
      await clearStoredExecutionSession(account, "store_management")
      try {
        const frameClient = await getFrameClient()
        await frameClient.request({
          method: "clearSession",
          params: {
            account,
            chainId: walletChainId,
            grantKind: "management"
          }
        })
      } catch {
        // Parent metadata is still cleared; iframe state can clear later.
      }
      setManagementExecutionSession(null)
    },
    [getFrameClient, setManagementExecutionSession, walletChainId]
  )

  const disableManagementExecutionSession = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet || !sliceAccountClient) {
      throw new Error("Unlock your Slice wallet first.")
    }
    if (!storeManagement) {
      throw new Error("1-tap management is not available in this app.")
    }
    await managementLifecycle.runMutation({
      account: activeWallet.kernelAccount.address,
      task: async (control) => {
        const frameClient = await getFrameClient()
        const [{ delegation }, frameResult, pendingFrameResult, pendingRead] =
          await Promise.all([
            storeManagement.fetchDelegation(),
            frameClient.request({
              method: "getSession",
              params: {
                account: activeWallet.kernelAccount.address,
                chainId: walletChainId,
                grantKind: "management"
              }
            }),
            frameClient.request({
              method: "getPendingSession",
              params: {
                account: activeWallet.kernelAccount.address,
                chainId: walletChainId,
                grantKind: "management"
              }
            }),
            readStoredPendingReplacementStrict(
              activeWallet.kernelAccount.address,
              "store_management"
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
          targetMatches: true
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
              "store_management"
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
          activeWallet.kernelAccount.address
        )
        control.assertCurrent()
        notifications?.success?.("1-tap management disabled")
      }
    })
  }, [
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
  ])

  return {
    disableManagementExecutionSession,
    refreshExecutionAllowance
  }
}
