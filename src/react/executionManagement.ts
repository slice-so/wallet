"use client"

import { useCallback } from "react"
import type { Address } from "viem"
import { createSliceStoreManagementPolicyDescriptor } from "../execution"
import {
  authorizeSliceWalletSession,
  type createSliceWalletCeremonyKernelAccount,
  parseSliceWalletFrameSession
} from "../index"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types"
import type { SliceAccountClient } from "../types/accountClient"
import type { SliceWalletCeremonyMode } from "../types/ceremony"
import type {
  SliceWalletCredentialRecord,
  SliceWalletNotifications,
  SliceWalletProviderAdapters,
  StoredSliceWalletExecutionSession
} from "../types/react"
import type { useSliceWalletExecutionAuthority } from "./executionAuthority"
import type { useSliceWalletExecutionHydration } from "./executionHydration"
import {
  clearStoredPendingReplacement,
  readStoredPendingReplacement,
  writeStoredExecutionSession,
  writeStoredPendingReplacement
} from "./executionKeyStore"
import {
  getSliceWalletPendingRegistrationAction,
  resumeSliceWalletRegisteredReplacement
} from "./permissionLifecycle"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

export const useSliceWalletManagementEnablement = ({
  activeWalletRef,
  activateManagementExecutionSession,
  ceremonyBroker,
  ceremonyMode,
  finalizeRegisteredReplacement,
  getFrameClient,
  normalizedIdOrigin,
  notifications,
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
  activateManagementExecutionSession: ReturnType<
    typeof useSliceWalletExecutionHydration
  >["activateManagementExecutionSession"]
  ceremonyBroker: SliceWalletCeremonyBroker
  ceremonyMode: SliceWalletCeremonyMode
  finalizeRegisteredReplacement: ReturnType<
    typeof useSliceWalletExecutionAuthority
  >["finalizeRegisteredReplacement"]
  getFrameClient: () => Promise<SliceWalletSignerFrameClient>
  normalizedIdOrigin: string
  notifications?: SliceWalletNotifications
  sliceAccountClient: SliceAccountClient | null
  storeManagement: SliceWalletProviderAdapters["storeManagement"]
  walletChainId: number
}) =>
  useCallback(
    async ({
      slicerAddress,
      slicerId
    }: {
      slicerAddress: Address
      slicerId: number
    }) => {
      const activeWallet = activeWalletRef.current
      if (!activeWallet || !sliceAccountClient) {
        throw new Error("Unlock your Slice wallet first.")
      }
      if (!storeManagement) {
        throw new Error("1-tap management is not available in this app.")
      }
      const { credential, kernelAccount } = activeWallet
      const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
      const policy = createSliceStoreManagementPolicyDescriptor({
        account: kernelAccount.address,
        chainId: walletChainId,
        expiresAt: Math.floor(expiresAtDate.getTime() / 1_000),
        slicerAddress,
        slicerId
      })
      const frameClient = await getFrameClient()
      let [pendingFrameResult, pendingReplacement] = await Promise.all([
        frameClient.request({
          method: "getPendingSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChainId,
            grantKind: "management"
          }
        }),
        readStoredPendingReplacement(kernelAccount.address, "store_management")
      ])
      if (
        pendingFrameResult !== null &&
        typeof pendingFrameResult === "object" &&
        parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        ).expiresAt <= Math.floor(Date.now() / 1_000)
      ) {
        await Promise.all([
          frameClient.request({
            method: "discardSession",
            params: {
              account: kernelAccount.address,
              chainId: walletChainId,
              grantKind: "management"
            }
          }),
          clearStoredPendingReplacement(
            kernelAccount.address,
            "store_management"
          )
        ])
        pendingFrameResult = null
        pendingReplacement = null
      }
      const pendingRegistrationAction = getSliceWalletPendingRegistrationAction(
        {
          hasPendingFrame:
            pendingFrameResult !== null &&
            typeof pendingFrameResult === "object",
          replacement: pendingReplacement
        }
      )
      if (pendingRegistrationAction === "discard_orphan") {
        await frameClient.request({
          method: "discardSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChainId,
            grantKind: "management"
          }
        })
        pendingFrameResult = null
        pendingReplacement = null
      } else if (pendingRegistrationAction === "ambiguous") {
        throw new Error(
          "A pending management registration must be recovered from Slice ID."
        )
      } else if (pendingRegistrationAction === "resume") {
        if (
          pendingFrameResult === null ||
          typeof pendingFrameResult !== "object" ||
          pendingReplacement === null ||
          pendingReplacement.phase === "registering" ||
          pendingReplacement.session.kind !== "store_management"
        ) {
          throw new Error("Invalid pending management replacement state.")
        }
        const replacementSession = pendingReplacement.session
        const replacementPreviousSessions = pendingReplacement.previousSessions
        const pendingSession = parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        )
        const outcome = await resumeSliceWalletRegisteredReplacement({
          activate: () =>
            activateManagementExecutionSession({
              credential,
              kernelAccount,
              session: pendingSession,
              stored: replacementSession
            }),
          clear: () =>
            clearStoredPendingReplacement(
              kernelAccount.address,
              "store_management"
            ),
          commit: async () => {
            await frameClient.request({
              method: "commitSession",
              params: {
                account: pendingSession.account,
                chainId: pendingSession.chainId,
                grantKind: pendingSession.grantKind
              }
            })
          },
          discard: async () => {
            await frameClient.request({
              method: "discardSession",
              params: {
                account: pendingSession.account,
                chainId: pendingSession.chainId,
                grantKind: pendingSession.grantKind
              }
            })
          },
          finalize: () =>
            finalizeRegisteredReplacement({
              client: storeManagement.client,
              delegationId: replacementSession.delegationId,
              frameClient,
              previousSessions: replacementPreviousSessions,
              session: pendingSession
            }),
          notifyRevoked: () =>
            notifications?.error?.(
              "This management permission was revoked from Slice ID. Enable it again to continue."
            ),
          persist: () => writeStoredExecutionSession(replacementSession)
        })
        if (outcome === "resumed") {
          notifications?.success?.("1-tap management enabled")
        }
        return
      }
      const created = await frameClient.request({
        method: "createSession",
        params: { policy }
      })
      if (created === null || typeof created !== "object") {
        throw new Error(
          "Slice Wallet signer did not create a management session."
        )
      }
      const session = parseSliceWalletFrameSession(
        created as SliceWalletProtocolValue
      )
      let authorization: SliceWalletPermissionAuthorization
      let registration: Awaited<
        ReturnType<typeof storeManagement.client.registerAuthorization>
      >
      let registered = false
      try {
        authorization = await authorizeSliceWalletSession({
          ceremonyBroker,
          ceremonyMode,
          document,
          idOrigin: normalizedIdOrigin,
          session,
          window
        })
        await writeStoredPendingReplacement({
          phase: "registering",
          previousSessions: [],
          session: {
            accountAddress: kernelAccount.address,
            enableSignature: authorization.enableSignature,
            expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
            kind: "store_management",
            permissionId: session.permissionId,
            signerAddress: session.signerId,
            slicerAddress,
            slicerId
          }
        })
        registration = await storeManagement.client.registerAuthorization({
          authorization,
          slicerAddress,
          slicerId
        })
        registered = true
        const stored = {
          accountAddress: kernelAccount.address,
          delegationId: registration.delegationId,
          enableSignature: authorization.enableSignature,
          expiresAt: registration.expiresAt,
          kind: "store_management",
          permissionId: registration.permissionId,
          signerAddress: registration.signerAddress,
          slicerAddress,
          slicerId
        } satisfies StoredSliceWalletExecutionSession
        await writeStoredPendingReplacement({
          phase: "registered",
          previousSessions: registration.previousSessions,
          session: stored
        })
        if (registration.requiresFinalization) {
          await finalizeRegisteredReplacement({
            client: storeManagement.client,
            delegationId: registration.delegationId,
            frameClient,
            previousSessions: registration.previousSessions,
            session
          })
        }
        await frameClient.request({
          method: "commitSession",
          params: {
            account: session.account,
            chainId: session.chainId,
            grantKind: session.grantKind
          }
        })
      } catch (error) {
        if (!registered) {
          await Promise.all([
            frameClient
              .request({
                method: "discardSession",
                params: {
                  account: session.account,
                  chainId: session.chainId,
                  grantKind: "management"
                }
              })
              .catch(() => undefined),
            clearStoredPendingReplacement(
              kernelAccount.address,
              "store_management"
            ).catch(() => undefined)
          ])
        }
        throw error
      }
      const stored = {
        accountAddress: kernelAccount.address,
        delegationId: registration.delegationId,
        enableSignature: authorization.enableSignature,
        expiresAt: registration.expiresAt,
        kind: "store_management",
        permissionId: registration.permissionId,
        signerAddress: registration.signerAddress,
        slicerAddress,
        slicerId
      } satisfies StoredSliceWalletExecutionSession
      await writeStoredExecutionSession(stored)
      await clearStoredPendingReplacement(
        kernelAccount.address,
        "store_management"
      )
      await activateManagementExecutionSession({
        credential,
        kernelAccount,
        session,
        stored
      })
      notifications?.success?.("1-tap management enabled")
    },
    [
      activeWalletRef,
      activateManagementExecutionSession,
      ceremonyBroker,
      ceremonyMode,
      finalizeRegisteredReplacement,
      getFrameClient,
      normalizedIdOrigin,
      notifications,
      sliceAccountClient,
      storeManagement,
      walletChainId
    ]
  )
