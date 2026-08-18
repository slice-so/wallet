"use client"

import { createSliceCheckoutPolicyDescriptor } from "@slicekit/wallet-protocol/execution"
import { serializeWalletPolicyDescriptor } from "@slicekit/wallet-protocol/policy"
import { useCallback } from "react"
import { type Address, isAddress } from "viem"
import { authorizeSliceWalletSession } from "../ceremony/client"
import { parseSliceWalletFrameSession } from "../ceremony/protocol"
import type { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
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

/** Default per-grant checkout budget: $100 in micro-USD. */
export const defaultExecutionAllowanceUsdMicros = 100_000_000n

export const useSliceWalletCheckoutEnablement = ({
  activeWalletRef,
  activateExecutionSession,
  ceremonyBroker,
  ceremonyMode,
  checkoutExecution,
  finalizeRegisteredReplacement,
  getFrameClient,
  normalizedIdOrigin,
  notifications,
  sliceAccountClient,
  walletChainId
}: {
  activeWalletRef: {
    current: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    } | null
  }
  activateExecutionSession: ReturnType<
    typeof useSliceWalletExecutionHydration
  >["activateExecutionSession"]
  ceremonyBroker: SliceWalletCeremonyBroker
  ceremonyMode: SliceWalletCeremonyMode
  checkoutExecution: SliceWalletProviderAdapters["checkoutExecution"]
  finalizeRegisteredReplacement: ReturnType<
    typeof useSliceWalletExecutionAuthority
  >["finalizeRegisteredReplacement"]
  getFrameClient: () => Promise<SliceWalletSignerFrameClient>
  normalizedIdOrigin: string
  notifications?: SliceWalletNotifications
  sliceAccountClient: SliceAccountClient | null
  walletChainId: number
}) =>
  useCallback(
    async ({
      allowanceUsdMicros = defaultExecutionAllowanceUsdMicros,
      budgetPeriodSec,
      tokenAddresses = []
    }: {
      allowanceUsdMicros?: bigint
      budgetPeriodSec?: number
      tokenAddresses?: readonly Address[]
    } = {}) => {
      const activeWallet = activeWalletRef.current
      if (!activeWallet || !sliceAccountClient) {
        throw new Error("Unlock your Slice wallet first.")
      }
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      const { credential, kernelAccount } = activeWallet
      const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const validUntil = Math.floor(expiresAtDate.getTime() / 1000)
      const { coSignerAddress } =
        await checkoutExecution.client.getConfiguration(walletChainId)
      const policy = createSliceCheckoutPolicyDescriptor({
        account: kernelAccount.address,
        chainId: walletChainId,
        expiresAt: validUntil,
        tokenAddresses: [
          ...new Set(tokenAddresses.map((value) => value.toLowerCase()))
        ].filter((value): value is Address => isAddress(value))
      })
      const frameClient = await getFrameClient()
      let [pendingFrameResult, pendingReplacement] = await Promise.all([
        frameClient.request({
          method: "getPendingSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChainId,
            grantKind: "checkout"
          }
        }),
        readStoredPendingReplacement(kernelAccount.address, "checkout")
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
              grantKind: "checkout"
            }
          }),
          clearStoredPendingReplacement(kernelAccount.address, "checkout")
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
            grantKind: "checkout"
          }
        })
        pendingFrameResult = null
        pendingReplacement = null
      } else if (pendingRegistrationAction === "ambiguous") {
        throw new Error(
          "A pending checkout registration must be recovered from Slice ID."
        )
      } else if (pendingRegistrationAction === "resume") {
        if (
          pendingFrameResult === null ||
          typeof pendingFrameResult !== "object" ||
          pendingReplacement === null ||
          pendingReplacement.phase === "registering" ||
          pendingReplacement.session.kind !== "checkout" ||
          pendingReplacement.allowanceUsdMicros === undefined
        ) {
          throw new Error("Invalid pending checkout replacement state.")
        }
        const replacementSession = pendingReplacement.session
        const replacementPreviousSessions = pendingReplacement.previousSessions
        const replacementAllowanceUsdMicros =
          pendingReplacement.allowanceUsdMicros
        const pendingSession = parseSliceWalletFrameSession(
          pendingFrameResult as SliceWalletProtocolValue
        )
        const outcome = await resumeSliceWalletRegisteredReplacement({
          activate: () =>
            activateExecutionSession({
              credential,
              kernelAccount,
              session: pendingSession,
              snapshot: {
                allowanceUsdMicros: replacementAllowanceUsdMicros,
                ...(replacementSession.budgetPeriodSec !== undefined
                  ? { budgetPeriodSec: replacementSession.budgetPeriodSec }
                  : {}),
                coSignerAddress: replacementSession.coSignerAddress,
                delegationId: replacementSession.delegationId,
                expiresAt: replacementSession.expiresAt,
                permissionId: replacementSession.permissionId,
                remainingUsdMicros: replacementAllowanceUsdMicros,
                signerAddress: replacementSession.signerAddress,
                signerScheme: "p256",
                walletPolicy: serializeWalletPolicyDescriptor(
                  pendingSession.policy
                )
              },
              stored: replacementSession
            }),
          clear: () =>
            clearStoredPendingReplacement(kernelAccount.address, "checkout"),
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
              client: checkoutExecution.client,
              delegationId: replacementSession.delegationId,
              frameClient,
              previousSessions: replacementPreviousSessions,
              session: pendingSession
            }),
          notifyRevoked: () =>
            notifications?.error?.(
              "This checkout permission was revoked from Slice ID. Enable it again to continue."
            ),
          persist: () => writeStoredExecutionSession(replacementSession)
        })
        if (outcome === "resumed") {
          notifications?.success?.("1-tap checkout enabled")
        }
        return
      }
      const created = await frameClient.request({
        method: "createSession",
        params: {
          checkout: {
            allowanceUsdMicros: allowanceUsdMicros.toString(),
            ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
            coSignerAddress
          },
          policy
        }
      })
      if (created === null || typeof created !== "object") {
        throw new Error(
          "Slice Wallet signer did not create a checkout session."
        )
      }
      const session = parseSliceWalletFrameSession(
        created as SliceWalletProtocolValue
      )
      let authorization: SliceWalletPermissionAuthorization
      let registration: Awaited<
        ReturnType<typeof checkoutExecution.client.registerAuthorization>
      > | null = null
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
            ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
            coSignerAddress,
            enableSignature: authorization.enableSignature,
            expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
            kind: "checkout",
            permissionId: session.permissionId,
            signerAddress: session.signerId
          }
        })
        registration =
          await checkoutExecution.client.registerAuthorization(authorization)
        const stored = {
          accountAddress: kernelAccount.address,
          ...(registration.budgetPeriodSec === undefined
            ? {}
            : { budgetPeriodSec: registration.budgetPeriodSec }),
          coSignerAddress: registration.coSignerAddress,
          delegationId: registration.delegationId,
          enableSignature: authorization.enableSignature,
          expiresAt: registration.expiresAt,
          kind: "checkout",
          permissionId: registration.permissionId,
          signerAddress: registration.signerAddress
        } satisfies StoredSliceWalletExecutionSession
        await writeStoredPendingReplacement({
          allowanceUsdMicros: registration.allowanceUsdMicros,
          phase: "registered",
          previousSessions: registration.previousSessions,
          session: stored
        })
        if (registration.requiresFinalization) {
          await finalizeRegisteredReplacement({
            client: checkoutExecution.client,
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
        if (registration === null) {
          await Promise.all([
            frameClient
              .request({
                method: "discardSession",
                params: {
                  account: session.account,
                  chainId: session.chainId,
                  grantKind: session.grantKind
                }
              })
              .catch(() => undefined),
            clearStoredPendingReplacement(
              kernelAccount.address,
              "checkout"
            ).catch(() => undefined)
          ])
        }
        throw error
      }
      if (registration === null) {
        throw new Error("Slice checkout delegation registration failed.")
      }
      const stored = {
        accountAddress: kernelAccount.address,
        ...(registration.budgetPeriodSec === undefined
          ? {}
          : { budgetPeriodSec: registration.budgetPeriodSec }),
        coSignerAddress: registration.coSignerAddress,
        delegationId: registration.delegationId,
        enableSignature: authorization.enableSignature,
        expiresAt: registration.expiresAt,
        kind: "checkout",
        permissionId: registration.permissionId,
        signerAddress: registration.signerAddress
      } satisfies StoredSliceWalletExecutionSession
      await writeStoredExecutionSession(stored)
      await clearStoredPendingReplacement(kernelAccount.address, "checkout")
      await activateExecutionSession({
        credential,
        kernelAccount,
        session,
        snapshot: {
          allowanceUsdMicros: registration.allowanceUsdMicros,
          ...(registration.budgetPeriodSec === undefined
            ? {}
            : { budgetPeriodSec: registration.budgetPeriodSec }),
          coSignerAddress: registration.coSignerAddress,
          delegationId: registration.delegationId,
          expiresAt: registration.expiresAt,
          permissionId: registration.permissionId,
          remainingUsdMicros: registration.allowanceUsdMicros,
          signerAddress: registration.signerAddress,
          signerScheme: "p256",
          walletPolicy: serializeWalletPolicyDescriptor(session.policy)
        },
        stored
      })
      notifications?.success?.("1-tap checkout enabled")
    },
    [
      activeWalletRef,
      activateExecutionSession,
      ceremonyBroker,
      ceremonyMode,
      checkoutExecution,
      finalizeRegisteredReplacement,
      getFrameClient,
      normalizedIdOrigin,
      notifications,
      sliceAccountClient,
      walletChainId
    ]
  )
