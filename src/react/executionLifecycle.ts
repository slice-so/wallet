"use client"

import { type Dispatch, type SetStateAction, useCallback } from "react"
import {
  buildSliceWalletPermissionRevocationCalls,
  type createSliceWalletCeremonyKernelAccount,
  getSliceWalletCallsHash,
  parseSerializedWalletPolicyDescriptor,
  parseSliceWalletFrameSession
} from "../index"
import type { SliceAccountClient } from "../types/accountClient"
import type {
  SliceWalletFrameSession,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types/frame"
import type {
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletNotifications,
  SliceWalletProviderAdapters
} from "../types/react"
import type { useSliceWalletExecutionAuthority } from "./executionAuthority"
import {
  clearStoredExecutionSession,
  readStoredExecutionSession,
  readStoredPendingReplacement
} from "./executionKeyStore"
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
  managementExecutionSession,
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
  managementExecutionSession: SliceWalletManagementExecutionSession | null
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

  const clearExecutionSessions = useCallback(async () => {
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (activeAccount) {
      const pendingReplacements = await Promise.all([
        readStoredPendingReplacement(activeAccount, "checkout"),
        readStoredPendingReplacement(activeAccount, "store_management")
      ])
      const hadExecutionPermission =
        executionSession !== null ||
        managementExecutionSession !== null ||
        pendingReplacements.some((replacement) => replacement !== null)
      await Promise.all([
        clearStoredExecutionSession(activeAccount, "checkout"),
        clearStoredExecutionSession(activeAccount, "store_management")
      ])
      try {
        const frameClient = await getFrameClient()
        await Promise.all([
          frameClient.request({
            method: "clearSession",
            params: {
              account: activeAccount,
              chainId: walletChainId,
              grantKind: "checkout"
            }
          }),
          frameClient.request({
            method: "clearSession",
            params: {
              account: activeAccount,
              chainId: walletChainId,
              grantKind: "management"
            }
          })
        ])
      } catch {
        // Sign-out still completes if the isolated signer is unavailable.
      }
      if (hadExecutionPermission) {
        notifications?.error?.(
          "Your onchain wallet permission remains active until you revoke it from Slice ID."
        )
      }
    }
    setExecutionSession(null)
    setManagementExecutionSession(null)
  }, [
    activeWalletRef,
    executionSession,
    getFrameClient,
    managementExecutionSession,
    notifications,
    setExecutionSession,
    setManagementExecutionSession,
    walletChainId
  ])

  const clearManagementExecutionSession = useCallback(async () => {
    const activeAccount = activeWalletRef.current?.kernelAccount.address
    if (activeAccount) {
      await clearStoredExecutionSession(activeAccount, "store_management")
      try {
        const frameClient = await getFrameClient()
        await frameClient.request({
          method: "clearSession",
          params: {
            account: activeAccount,
            chainId: walletChainId,
            grantKind: "management"
          }
        })
      } catch {
        // Parent metadata is still cleared; iframe state can clear later.
      }
    }
    setManagementExecutionSession(null)
  }, [
    activeWalletRef,
    getFrameClient,
    setManagementExecutionSession,
    walletChainId
  ])

  const disableManagementExecutionSession = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet || !sliceAccountClient) {
      throw new Error("Unlock your Slice wallet first.")
    }
    if (!storeManagement) {
      throw new Error("1-tap management is not available in this app.")
    }
    const frameClient = await getFrameClient()
    const [{ delegation }, frameResult] = await Promise.all([
      storeManagement.fetchDelegation(),
      frameClient.request({
        method: "getSession",
        params: {
          account: activeWallet.kernelAccount.address,
          chainId: walletChainId,
          grantKind: "management"
        }
      })
    ])
    if (delegation === null) {
      throw new Error(
        "The management delegation is unavailable; revoke it from Slice ID."
      )
    }
    let session: SliceWalletFrameSession | null = null
    if (frameResult !== null && typeof frameResult === "object") {
      session = parseSliceWalletFrameSession(
        frameResult as SliceWalletProtocolValue
      )
    } else if (
      delegation.permissionId !== null &&
      delegation.signerPublicKey !== null &&
      delegation.walletPolicy !== null
    ) {
      const reconstructed = {
        account: activeWallet.kernelAccount.address,
        chainId: walletChainId,
        expiresAt: Math.floor(new Date(delegation.expiresAt).getTime() / 1_000),
        grantKind: "management",
        permissionId: delegation.permissionId,
        policy: parseSerializedWalletPolicyDescriptor(delegation.walletPolicy),
        publicKey: delegation.signerPublicKey,
        signerId: delegation.signerAddress
      } satisfies SliceWalletFrameSession
      session = parseSliceWalletFrameSession(
        reconstructed as SliceWalletProtocolValue
      )
    }
    if (session === null) {
      throw new Error(
        "The management permission descriptor is unavailable; revoke it from Slice ID."
      )
    }
    const { calls } = await buildSliceWalletPermissionRevocationCalls({
      account: activeWallet.kernelAccount.address,
      client: publicClient,
      session
    })
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
    await clearManagementExecutionSession()
    notifications?.success?.("1-tap management disabled")
  }, [
    activeWalletRef,
    clearManagementExecutionSession,
    createReplacementFinalizationProof,
    getFrameClient,
    notifications,
    publicClient,
    sliceAccountClient,
    storeManagement,
    walletChainId
  ])

  return {
    clearExecutionSessions,
    disableManagementExecutionSession,
    refreshExecutionAllowance
  }
}
