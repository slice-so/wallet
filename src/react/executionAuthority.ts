"use client"

import { useCallback } from "react"
import { type Hex, isHex } from "viem"
import {
  parseSliceWalletExecutionSessionDescriptor,
  type SliceWalletCheckoutExecutionClient,
  type SliceWalletExecutionSessionDescriptor,
  type SliceWalletManagementExecutionClient
} from "../execution"
import {
  buildSliceWalletPermissionRevocationCalls,
  getSliceWalletCallsHash
} from "../index"
import type { SliceAccountClient } from "../types/accountClient"
import type {
  SliceWalletFrameSession,
  SliceWalletSignerFrameClient
} from "../types/frame"
import type { SliceWalletProviderAdapters } from "../types/react"
import { retrySliceWalletFinalityAction } from "./permissionLifecycle"

export const useSliceWalletExecutionAuthority = ({
  checkoutExecution,
  publicClient,
  sliceAccountClient
}: {
  checkoutExecution: SliceWalletProviderAdapters["checkoutExecution"]
  publicClient: Parameters<
    typeof buildSliceWalletPermissionRevocationCalls
  >[0]["client"]
  sliceAccountClient: SliceAccountClient | null
}) => {
  const createCheckoutSessionProof = useCallback(
    async ({
      action,
      delegationId,
      frameClient,
      session
    }: {
      action: "predecessor_descriptors" | "revoke" | "status"
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      session: SliceWalletFrameSession
    }) => {
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      const challenge =
        await checkoutExecution.client.createSessionChallenge(delegationId)
      const proofSignature = await frameClient.request({
        method: "signSessionRequest",
        params: {
          action,
          ...challenge,
          delegationId,
          session: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind,
            ...(session.slicerId === undefined
              ? {}
              : { slicerId: session.slicerId })
          }
        }
      })
      if (typeof proofSignature !== "string" || !isHex(proofSignature)) {
        throw new Error("Slice wallet returned an invalid session proof.")
      }
      return { ...challenge, delegationId, proofSignature }
    },
    [checkoutExecution]
  )

  const createReplacementFinalizationProof = useCallback(
    async ({
      action = "finalize_replacement",
      client,
      delegationId,
      frameClient,
      session
    }: {
      action?: "finalize_replacement" | "predecessor_descriptors" | "revoke"
      client: {
        createSessionChallenge: (
          delegationId: string
        ) => Promise<{ challenge: Hex; expiresAt: number }>
      }
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      session: SliceWalletFrameSession
    }) => {
      const challenge = await client.createSessionChallenge(delegationId)
      const proofSignature = await frameClient.request({
        method: "signSessionRequest",
        params: {
          action,
          ...challenge,
          delegationId,
          session: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind,
            ...(session.slicerId === undefined
              ? {}
              : { slicerId: session.slicerId })
          }
        }
      })
      if (typeof proofSignature !== "string" || !isHex(proofSignature)) {
        throw new Error("Slice wallet returned an invalid replacement proof.")
      }
      return { ...challenge, delegationId, proofSignature }
    },
    []
  )

  const finalizeRegisteredReplacement = useCallback(
    async ({
      client,
      delegationId,
      frameClient,
      previousSessions,
      session
    }: {
      client:
        | Pick<
            SliceWalletCheckoutExecutionClient,
            "createSessionChallenge" | "finalizeReplacement"
          >
        | Pick<
            SliceWalletManagementExecutionClient,
            "createSessionChallenge" | "finalizeReplacement"
          >
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
      session: SliceWalletFrameSession
    }) => {
      const calls = []
      for (const descriptor of previousSessions) {
        const built = await buildSliceWalletPermissionRevocationCalls({
          account: session.account,
          client: publicClient,
          session: parseSliceWalletExecutionSessionDescriptor(descriptor)
        })
        calls.push(...built.calls)
      }
      if (calls.length > 0 && sliceAccountClient === null) {
        throw new Error("Unlock your Slice wallet first.")
      }
      const execution =
        calls.length === 0 || sliceAccountClient === null
          ? null
          : await sliceAccountClient.sendCalls({ calls })
      const operation =
        execution === null
          ? {}
          : {
              expectedDisableCallHash: getSliceWalletCallsHash(calls),
              userOperationHash: execution.executionId
            }
      await retrySliceWalletFinalityAction({
        createProof: () =>
          createReplacementFinalizationProof({
            client,
            delegationId,
            frameClient,
            session
          }),
        operation,
        request: async (proof) => {
          await client.finalizeReplacement(proof)
        }
      })
    },
    [createReplacementFinalizationProof, publicClient, sliceAccountClient]
  )

  const fetchCheckoutDelegation = useCallback(
    async (input: {
      delegationId: string
      frameClient: SliceWalletSignerFrameClient
      session: SliceWalletFrameSession
    }) => {
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      return checkoutExecution.client.fetchDelegation(
        await createCheckoutSessionProof({ action: "status", ...input })
      )
    },
    [checkoutExecution, createCheckoutSessionProof]
  )

  return {
    createReplacementFinalizationProof,
    fetchCheckoutDelegation,
    finalizeRegisteredReplacement
  }
}
