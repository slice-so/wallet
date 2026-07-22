"use client"

import { useCallback } from "react"
import type { Chain } from "viem"
import {
  createKernelPasskeySliceAccountClient,
  createSliceKernelPasskeyTransport,
  getSliceBundlerApiUrl,
  type SliceWalletCheckoutExecutionDelegationSnapshot
} from "../execution"
import {
  type createSliceWalletCeremonyKernelAccount,
  createSliceWalletPermissionAccount,
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
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletManagementLifecycleControl,
  SliceWalletProviderAdapters,
  StoredSliceWalletExecutionSession
} from "../types/react"
import {
  clearStoredExecutionSession,
  readStoredExecutionSession,
  readStoredPendingReplacementStrict
} from "./executionKeyStore"
import { hydrateStoredManagementExecutionSession } from "./managementHydration"
import { getManagementHydrationGuard } from "./managementOperations"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

export const useSliceWalletExecutionHydration = ({
  checkoutExecution,
  fetchCheckoutDelegation,
  getFrameClient,
  publicClient,
  setExecutionSession,
  setManagementExecutionSession,
  storeManagement,
  walletChain
}: {
  checkoutExecution: SliceWalletProviderAdapters["checkoutExecution"]
  fetchCheckoutDelegation: (input: {
    delegationId: string
    frameClient: SliceWalletSignerFrameClient
    session: SliceWalletFrameSession
  }) => Promise<{
    delegation: SliceWalletCheckoutExecutionDelegationSnapshot | null
  }>
  getFrameClient: () => Promise<SliceWalletSignerFrameClient>
  publicClient: Parameters<
    typeof createSliceWalletPermissionAccount
  >[0]["client"]
  setExecutionSession: (session: SliceWalletExecutionSession | null) => void
  setManagementExecutionSession: (
    session: SliceWalletManagementExecutionSession | null
  ) => void
  storeManagement: SliceWalletProviderAdapters["storeManagement"]
  walletChain: Chain
}) => {
  const buildExecutionClient = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
      session: SliceWalletFrameSession
      stored: Extract<StoredSliceWalletExecutionSession, { kind: "checkout" }>
    }) => {
      if (!checkoutExecution) {
        throw new Error("1-tap checkout is not available in this app.")
      }
      const frameClient = await getFrameClient()
      const executionAccount = await createSliceWalletPermissionAccount({
        address: kernelAccount.address,
        accountIndex: BigInt(credential.accountIndex),
        checkoutCoSigner: checkoutExecution.client,
        client: publicClient,
        credential: {
          credentialIdHash: credential.credentialIdHash,
          publicKey: credential.publicKey
        },
        delegationId: stored.delegationId,
        enableSignature: stored.enableSignature,
        frameClient,
        getFactoryArgs: () => kernelAccount.getFactoryArgs(),
        mode: "checkout",
        session
      })
      return createKernelPasskeySliceAccountClient({
        account: kernelAccount.address,
        chainId: walletChain.id,
        transport: createSliceKernelPasskeyTransport({
          account: executionAccount,
          bundlerUrl: getSliceBundlerApiUrl(window.location.origin),
          chain: walletChain,
          client: publicClient
        })
      })
    },
    [checkoutExecution, getFrameClient, publicClient, walletChain]
  )

  const activateExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      snapshot,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
      session: SliceWalletFrameSession
      snapshot: SliceWalletCheckoutExecutionDelegationSnapshot
      stored: Extract<StoredSliceWalletExecutionSession, { kind: "checkout" }>
    }) => {
      const client = await buildExecutionClient({
        credential,
        kernelAccount,
        session,
        stored
      })
      setExecutionSession({
        allowanceUsdMicros: BigInt(snapshot.allowanceUsdMicros),
        ...(snapshot.budgetPeriodSec === undefined
          ? {}
          : { budgetPeriodSec: snapshot.budgetPeriodSec }),
        expiresAt: new Date(snapshot.expiresAt),
        remainingUsdMicros: BigInt(snapshot.remainingUsdMicros),
        sliceAccountClient: client
      })
    },
    [buildExecutionClient, setExecutionSession]
  )

  const hydrateExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    }) => {
      try {
        const stored = await readStoredExecutionSession(
          kernelAccount.address,
          "checkout"
        )
        if (stored?.kind !== "checkout" || !checkoutExecution) return
        const frameClient = await getFrameClient()
        const frameResult = await frameClient.request({
          method: "getSession",
          params: {
            account: kernelAccount.address,
            chainId: walletChain.id,
            grantKind: "checkout"
          }
        })
        if (frameResult === null || typeof frameResult !== "object") {
          await clearStoredExecutionSession(kernelAccount.address, "checkout")
          return
        }
        const session = parseSliceWalletFrameSession(
          frameResult as SliceWalletProtocolValue
        )
        const { delegation: snapshot } = await fetchCheckoutDelegation({
          delegationId: stored.delegationId,
          frameClient,
          session
        })
        const apiPolicy =
          snapshot?.walletPolicy === undefined
            ? null
            : parseSerializedWalletPolicyDescriptor(snapshot.walletPolicy)
        if (
          snapshot?.signerScheme !== "p256" ||
          snapshot.permissionId?.toLowerCase() !==
            session.permissionId.toLowerCase() ||
          apiPolicy === null ||
          getWalletPolicyHash(apiPolicy) !==
            getWalletPolicyHash(session.policy) ||
          snapshot.coSignerAddress.toLowerCase() !==
            stored.coSignerAddress.toLowerCase() ||
          snapshot.signerAddress.toLowerCase() !==
            stored.signerAddress.toLowerCase() ||
          session.signerId.toLowerCase() !==
            stored.signerAddress.toLowerCase() ||
          session.permissionId.toLowerCase() !==
            stored.permissionId.toLowerCase()
        ) {
          await clearStoredExecutionSession(kernelAccount.address, "checkout")
          await frameClient
            .request({
              method: "clearSession",
              params: {
                account: kernelAccount.address,
                chainId: walletChain.id,
                grantKind: "checkout"
              }
            })
            .catch(() => undefined)
          return
        }
        await activateExecutionSession({
          credential,
          kernelAccount,
          session,
          snapshot,
          stored
        })
      } catch {
        // Missing isolated signer state leaves checkout root-signed.
      }
    },
    [
      activateExecutionSession,
      checkoutExecution,
      fetchCheckoutDelegation,
      getFrameClient,
      walletChain.id
    ]
  )

  const buildManagementExecutionClient = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      stored
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
      session: SliceWalletFrameSession
      stored: Extract<
        StoredSliceWalletExecutionSession,
        { kind: "store_management" }
      >
    }) => {
      const frameClient = await getFrameClient()
      const executionAccount = await createSliceWalletPermissionAccount({
        address: kernelAccount.address,
        accountIndex: BigInt(credential.accountIndex),
        client: publicClient,
        credential: {
          credentialIdHash: credential.credentialIdHash,
          publicKey: credential.publicKey
        },
        enableSignature: stored.enableSignature,
        frameClient,
        getFactoryArgs: () => kernelAccount.getFactoryArgs(),
        mode: "management",
        session
      })
      return createKernelPasskeySliceAccountClient({
        account: kernelAccount.address,
        chainId: walletChain.id,
        transport: createSliceKernelPasskeyTransport({
          account: executionAccount,
          bundlerUrl: getSliceBundlerApiUrl(window.location.origin),
          chain: walletChain,
          client: publicClient
        })
      })
    },
    [getFrameClient, publicClient, walletChain]
  )

  const activateManagementExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount,
      session,
      stored,
      assertCurrent
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
      session: SliceWalletFrameSession
      stored: Extract<
        StoredSliceWalletExecutionSession,
        { kind: "store_management" }
      >
      assertCurrent?: () => void
    }) => {
      const client = await buildManagementExecutionClient({
        credential,
        kernelAccount,
        session,
        stored
      })
      assertCurrent?.()
      setManagementExecutionSession({
        expiresAt: new Date(stored.expiresAt),
        slicerAddress: stored.slicerAddress,
        slicerId: stored.slicerId,
        sliceAccountClient: client
      })
    },
    [buildManagementExecutionClient, setManagementExecutionSession]
  )

  const hydrateManagementExecutionSession = useCallback(
    async ({
      credential,
      kernelAccount,
      control
    }: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
      control: SliceWalletManagementLifecycleControl
    }) => {
      const pending = await readStoredPendingReplacementStrict(
        kernelAccount.address,
        "store_management"
      )
      control.assertCurrent()
      const guard = getManagementHydrationGuard({
        pendingPhase: pending.ok ? (pending.value?.phase ?? null) : null,
        readable: pending.ok
      })
      if (guard === "storage-unavailable") {
        setManagementExecutionSession(null)
        control.markStorageUnavailable()
        return
      }
      if (guard === "skip") {
        setManagementExecutionSession(null)
        return
      }
      if (!storeManagement) {
        setManagementExecutionSession(null)
        control.markError("transport-unavailable")
        return
      }
      await hydrateStoredManagementExecutionSession({
        account: kernelAccount.address,
        activate: ({ session, stored }) =>
          activateManagementExecutionSession({
            assertCurrent: control.assertCurrent,
            credential,
            kernelAccount,
            session,
            stored
          }),
        chainId: walletChain.id,
        control,
        fetchDelegation: storeManagement.fetchDelegation,
        getFrameClient,
        setSessionNull: () => setManagementExecutionSession(null)
      })
    },
    [
      activateManagementExecutionSession,
      getFrameClient,
      setManagementExecutionSession,
      storeManagement,
      walletChain.id
    ]
  )

  return {
    activateExecutionSession,
    activateManagementExecutionSession,
    hydrateExecutionSession,
    hydrateManagementExecutionSession
  }
}
