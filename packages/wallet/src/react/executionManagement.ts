"use client"

import { createSliceStoreManagementPolicyDescriptor } from "@slicekit/wallet-primitives/execution"
import type {
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue
} from "@slicekit/wallet-primitives/server"
import { assertSliceWalletAuthorityDeployment } from "@slicekit/wallet-primitives/server"
import { useCallback } from "react"
import { authorizeSliceWalletSession } from "../ceremony/client"
import { parseSliceWalletFrameSession } from "../ceremony/protocol"
import type { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletSignerFrameClient
} from "../types"
import type { SliceAccountClient } from "../types/accountClient"
import type { SliceWalletCeremonyMode } from "../types/ceremony"
import type {
  SliceWalletCredentialRecord,
  SliceWalletManagementLifecycle,
  SliceWalletNotifications,
  SliceWalletProviderAdapters,
  StoredSliceWalletExecutionSession,
  StoredSliceWalletRegisteredReplacement
} from "../types/react"
import type { useSliceWalletExecutionAuthority } from "./executionAuthority"
import type { useSliceWalletExecutionHydration } from "./executionHydration"
import {
  clearStoredPendingReplacement,
  clearStoredPendingReplacementStrict,
  writeStoredExecutionSessionStrict,
  writeStoredPendingReplacementStrict
} from "./executionKeyStore"
import { SliceWalletEnablementError } from "./managementLifecycle"
import {
  classifyManagementPendingAction,
  getEnablementRecoveryMode,
  isRegisteredManagementReplacement,
  loadManagementReplacementState,
  managementFrameMatchesStored,
  parseManagementFrameSession,
  rejectRevokedManagementPermission,
  runManagementCommitPhase,
  runManagementRegistrationPhase
} from "./managementOperations"
import { isSliceWalletDelegationNotFoundError } from "./permissionLifecycle"

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
  managementLifecycle,
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
  managementLifecycle: SliceWalletManagementLifecycle
  normalizedIdOrigin: string
  notifications?: SliceWalletNotifications
  sliceAccountClient: SliceAccountClient | null
  storeManagement: SliceWalletProviderAdapters["storeManagement"]
  walletChainId: number
}) =>
  useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet || !sliceAccountClient) {
      throw new Error("Unlock your Slice wallet first.")
    }
    if (!storeManagement) {
      throw new Error("1-tap management is not available in this app.")
    }
    assertSliceWalletAuthorityDeployment({
      authority: "management",
      chainId: walletChainId
    })
    const { credential, kernelAccount } = activeWallet

    await managementLifecycle.runMutation({
      account: kernelAccount.address,
      task: async (control) => {
        const frameClient = await getFrameClient()
        let { committed, pending, replacement } =
          await loadManagementReplacementState({
            account: kernelAccount.address,
            chainId: walletChainId,
            frameClient
          })
        if (pending !== null && pending.expiresAt <= Date.now() / 1_000) {
          await frameClient.request({
            method: "discardSession",
            params: {
              account: kernelAccount.address,
              chainId: walletChainId,
              grantKind: "management"
            }
          })
          await clearStoredPendingReplacementStrict(
            kernelAccount.address,
            "store_management"
          )
          pending = null
          replacement = null
        }

        const registered = isRegisteredManagementReplacement(replacement)
          ? replacement
          : null
        const pendingMatchesRegistered =
          registered !== null &&
          managementFrameMatchesStored(
            pending,
            registered.session,
            walletChainId
          )
        const action = classifyManagementPendingAction({
          hasMatchingCommittedFrame:
            registered !== null &&
            managementFrameMatchesStored(
              committed,
              registered.session,
              walletChainId
            ),
          hasPendingFrame: pending !== null,
          pendingPhase: replacement?.phase ?? null,
          pendingMatchesRegistered
        })

        if (action === "discard-orphan") {
          await frameClient.request({
            method: "discardSession",
            params: {
              account: kernelAccount.address,
              chainId: walletChainId,
              grantKind: "management"
            }
          })
          pending = null
        } else if (action === "ambiguous") {
          throw new SliceWalletEnablementError(
            "A pending management registration must be recovered from Slice ID before retrying.",
            "preserve-pending"
          )
        }

        if (action === "resume" || action === "complete-bookkeeping") {
          if (registered === null) {
            throw new SliceWalletEnablementError(
              "Invalid pending management replacement state.",
              "preserve-pending"
            )
          }
          const resumeSession = pendingMatchesRegistered ? pending : committed
          if (resumeSession === null) {
            throw new SliceWalletEnablementError(
              "The pending management session cannot be reconciled on this device.",
              "preserve-pending"
            )
          }
          if (pending !== null) {
            try {
              await finalizeRegisteredReplacement({
                client: storeManagement.client,
                delegationId: registered.session.delegationId,
                frameClient,
                previousSessions: registered.previousSessions,
                session: resumeSession
              })
            } catch (caught) {
              const error =
                caught instanceof Error
                  ? caught
                  : new Error("Slice Wallet replacement recovery failed.")
              if (!isSliceWalletDelegationNotFoundError(error)) throw error
              await frameClient
                .request({
                  method: "discardSession",
                  params: {
                    account: kernelAccount.address,
                    chainId: walletChainId,
                    grantKind: "management"
                  }
                })
                .catch(() => undefined)
              await clearStoredPendingReplacementStrict(
                kernelAccount.address,
                "store_management"
              )
              rejectRevokedManagementPermission()
            }
          }
          await runManagementCommitPhase({
            activate: () =>
              activateManagementExecutionSession({
                assertCurrent: control.assertCurrent,
                credential,
                kernelAccount,
                session: resumeSession,
                stored: registered.session
              }),
            assertCurrent: control.assertCurrent,
            clearPending: () =>
              clearStoredPendingReplacementStrict(
                kernelAccount.address,
                "store_management"
              ),
            commit:
              pending === null
                ? async () => undefined
                : async () => {
                    await frameClient.request({
                      method: "commitSession",
                      params: {
                        account: resumeSession.account,
                        chainId: resumeSession.chainId,
                        grantKind: resumeSession.grantKind
                      }
                    })
                  },
            persist: () =>
              writeStoredExecutionSessionStrict(registered.session),
            probeCommitted: async () => {
              const result = await frameClient.request({
                method: "getSession",
                params: {
                  account: kernelAccount.address,
                  chainId: walletChainId,
                  grantKind: "management"
                }
              })
              return managementFrameMatchesStored(
                parseManagementFrameSession(
                  result !== null && typeof result === "object" ? result : null
                ),
                registered.session,
                walletChainId
              )
            }
          })
          notifications?.success?.("1-tap management enabled")
          return
        }

        control.assertCurrent()
        const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000)
        const policy = createSliceStoreManagementPolicyDescriptor({
          account: kernelAccount.address,
          chainId: walletChainId,
          expiresAt: Math.floor(expiresAtDate.getTime() / 1_000)
        })
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
        let authorization: SliceWalletPermissionAuthorization | null = null
        let registrationCompleted = false
        let registeredMetadataPersisted = false
        let registrationSent = false
        try {
          authorization = await authorizeSliceWalletSession({
            ceremonyBroker,
            ceremonyMode,
            document,
            idOrigin: normalizedIdOrigin,
            session,
            window
          })
          control.assertCurrent()
          await writeStoredPendingReplacementStrict({
            phase: "registering",
            previousSessions: [],
            session: {
              accountAddress: kernelAccount.address,
              enableSignature: authorization.enableSignature,
              expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
              kind: "store_management",
              permissionId: session.permissionId,
              signerAddress: session.signerId
            }
          })
          const registration = await runManagementRegistrationPhase({
            assertCurrent: control.assertCurrent,
            finalize: async (result) => {
              if (!result.registration.requiresFinalization) return
              await finalizeRegisteredReplacement({
                client: storeManagement.client,
                delegationId: result.registration.delegationId,
                frameClient,
                previousSessions: result.registration.previousSessions,
                session
              })
            },
            persistRegistered: async (result) => {
              await writeStoredPendingReplacementStrict(result.replacement)
              registeredMetadataPersisted = true
            },
            register: async () => {
              registrationSent = true
              const result = await storeManagement.client.registerAuthorization(
                authorization as SliceWalletPermissionAuthorization
              )
              registrationCompleted = true
              const stored = {
                accountAddress: kernelAccount.address,
                delegationId: result.delegationId,
                enableSignature: (
                  authorization as SliceWalletPermissionAuthorization
                ).enableSignature,
                expiresAt: result.expiresAt,
                kind: "store_management",
                permissionId: result.permissionId,
                signerAddress: result.signerAddress
              } satisfies StoredSliceWalletExecutionSession
              return {
                registration: result,
                replacement: {
                  phase: "registered",
                  previousSessions: result.previousSessions,
                  session: stored
                } satisfies StoredSliceWalletRegisteredReplacement,
                stored
              }
            }
          })
          await runManagementCommitPhase({
            activate: () =>
              activateManagementExecutionSession({
                assertCurrent: control.assertCurrent,
                credential,
                kernelAccount,
                session,
                stored: registration.stored
              }),
            assertCurrent: control.assertCurrent,
            clearPending: () =>
              clearStoredPendingReplacementStrict(
                kernelAccount.address,
                "store_management"
              ),
            commit: async () => {
              await frameClient.request({
                method: "commitSession",
                params: {
                  account: session.account,
                  chainId: session.chainId,
                  grantKind: session.grantKind
                }
              })
            },
            persist: () =>
              writeStoredExecutionSessionStrict(registration.stored),
            probeCommitted: async () => {
              const result = await frameClient.request({
                method: "getSession",
                params: {
                  account: kernelAccount.address,
                  chainId: walletChainId,
                  grantKind: "management"
                }
              })
              return managementFrameMatchesStored(
                parseManagementFrameSession(
                  result !== null && typeof result === "object" ? result : null
                ),
                registration.stored,
                walletChainId
              )
            }
          })
        } catch (caught) {
          if (!registrationSent) {
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
              )
            ])
            throw new SliceWalletEnablementError(
              caught instanceof Error
                ? caught.message
                : "Unable to enable 1-tap management.",
              getEnablementRecoveryMode({
                bookkeepingComplete: false,
                pendingPhase: null
              })
            )
          }
          if (caught instanceof SliceWalletEnablementError) throw caught
          if (registrationCompleted && registeredMetadataPersisted) {
            throw new SliceWalletEnablementError(
              "The registered management permission is pending. Retry to continue reconciliation.",
              getEnablementRecoveryMode({
                bookkeepingComplete: false,
                pendingPhase: "registered"
              })
            )
          }
          throw new SliceWalletEnablementError(
            "The management registration outcome must be recovered from Slice ID before retrying.",
            getEnablementRecoveryMode({
              bookkeepingComplete: false,
              pendingPhase: "registering"
            })
          )
        }
        notifications?.success?.("1-tap management enabled")
      }
    })
  }, [
    activeWalletRef,
    activateManagementExecutionSession,
    ceremonyBroker,
    ceremonyMode,
    finalizeRegisteredReplacement,
    getFrameClient,
    managementLifecycle,
    normalizedIdOrigin,
    notifications,
    sliceAccountClient,
    storeManagement,
    walletChainId
  ])
