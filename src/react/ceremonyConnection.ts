"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Chain } from "viem"
import {
  connectSliceWalletAccount,
  connectSliceWalletSignerFrame,
  createSliceWalletCeremonyBroker,
  type createSliceWalletCeremonyKernelAccount,
  requestSliceWalletSession
} from "../index"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletSignerFrameClient
} from "../types"
import type { SliceWalletCeremonyMode } from "../types/ceremony"
import type {
  SliceWalletCredentialRecord,
  SliceWalletExecutionSession,
  SliceWalletManagementExecutionSession,
  SliceWalletNotifications,
  SliceWalletPendingAction,
  SliceWalletProviderAdapters,
  SliceWalletProviderProps,
  SliceWalletStatus
} from "../types/react"
import {
  storeSliceWalletMetadata,
  toSliceWalletCredentialRecord
} from "./accountHydration"
import type { useSliceWalletSessionIntegration } from "./sessionIntegration"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

export const useSliceWalletCeremonyConnection = (
  normalizedIdOrigin: string
) => {
  const ceremonyBrokerRef = useRef<SliceWalletCeremonyBroker | null>(null)
  if (ceremonyBrokerRef.current === null) {
    ceremonyBrokerRef.current = createSliceWalletCeremonyBroker()
  }
  const ceremonyBroker = ceremonyBrokerRef.current
  const [pendingCeremony, setPendingCeremony] = useState(
    ceremonyBroker.getPending()
  )
  const frameClientRef = useRef<SliceWalletSignerFrameClient | null>(null)
  const frameClientPromiseRef =
    useRef<Promise<SliceWalletSignerFrameClient> | null>(null)
  const frameClientDisposedRef = useRef(false)

  useEffect(
    () => ceremonyBroker.subscribe(setPendingCeremony),
    [ceremonyBroker]
  )
  useEffect(() => () => ceremonyBroker.cancel(), [ceremonyBroker])

  const getFrameClient = useCallback(async () => {
    if (frameClientRef.current !== null) return frameClientRef.current
    const pending =
      frameClientPromiseRef.current ??
      connectSliceWalletSignerFrame({
        document,
        frameUrl: new URL("/frame", normalizedIdOrigin).href,
        window
      })
    frameClientPromiseRef.current = pending
    try {
      const client = await pending
      if (frameClientDisposedRef.current) {
        client.destroy()
        throw new Error("Slice wallet frame client was disposed.")
      }
      frameClientRef.current = client
      return client
    } finally {
      if (frameClientPromiseRef.current === pending) {
        frameClientPromiseRef.current = null
      }
    }
  }, [normalizedIdOrigin])

  useEffect(() => {
    frameClientDisposedRef.current = false
    return () => {
      frameClientDisposedRef.current = true
      const pending = frameClientPromiseRef.current
      frameClientPromiseRef.current = null
      frameClientRef.current?.destroy()
      frameClientRef.current = null
      void pending?.then(
        (client) => client.destroy(),
        () => undefined
      )
    }
  }, [])

  return { ceremonyBroker, getFrameClient, pendingCeremony }
}

export const useSliceWalletCeremonyActions = ({
  activeWalletRef,
  activateCredential,
  adapters,
  ceremonyBroker,
  ceremonyMode,
  credentialStorageKey,
  hydrateManagementExecutionSession,
  managementEnabled,
  normalizedIdOrigin,
  notifications,
  sessionConfig,
  sessionIntegration,
  setAccountAddress,
  setError,
  setExecutionSession,
  setHasStoredCredential,
  setManagementExecutionSession,
  setPendingAction,
  setSliceAccountClient,
  setStatus,
  walletChain
}: {
  activeWalletRef: {
    current: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    } | null
  }
  activateCredential: (
    credential: SliceWalletCredentialRecord
  ) => Promise<{ kernelAccount: RootAccount }>
  adapters: SliceWalletProviderAdapters
  ceremonyBroker: SliceWalletCeremonyBroker
  ceremonyMode: SliceWalletCeremonyMode
  credentialStorageKey: string
  hydrateManagementExecutionSession: (wallet: {
    credential: SliceWalletCredentialRecord
    kernelAccount: RootAccount
  }) => Promise<void>
  managementEnabled: boolean
  normalizedIdOrigin: string
  notifications?: SliceWalletNotifications
  sessionConfig: SliceWalletProviderProps["session"]
  sessionIntegration: ReturnType<typeof useSliceWalletSessionIntegration>
  setAccountAddress: (value: null) => void
  setError: (value: string | null) => void
  setExecutionSession: (value: SliceWalletExecutionSession | null) => void
  setHasStoredCredential: (value: boolean) => void
  setManagementExecutionSession: (
    value: SliceWalletManagementExecutionSession | null
  ) => void
  setPendingAction: (value: SliceWalletPendingAction) => void
  setSliceAccountClient: (value: null) => void
  setStatus: (value: SliceWalletStatus) => void
  walletChain: Chain
}) => {
  const runWalletAction = useCallback(
    async (
      action: Exclude<SliceWalletPendingAction, null>,
      task: () => Promise<void>
    ) => {
      setPendingAction(action)
      setError(null)
      try {
        await task()
        return true
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to use Slice wallet."
        activeWalletRef.current = null
        setAccountAddress(null)
        setExecutionSession(null)
        setManagementExecutionSession(null)
        setSliceAccountClient(null)
        setError(message)
        setStatus("error")
        notifications?.error?.(message)
        return false
      } finally {
        setPendingAction(null)
      }
    },
    [
      activeWalletRef,
      notifications,
      setAccountAddress,
      setError,
      setExecutionSession,
      setManagementExecutionSession,
      setPendingAction,
      setSliceAccountClient,
      setStatus
    ]
  )

  const connectWallet = useCallback(async () => {
    const connected = await connectSliceWalletAccount({
      ceremonyBroker,
      ceremonyMode,
      chainId: walletChain.id,
      document,
      idOrigin: normalizedIdOrigin,
      ...(sessionConfig === undefined
        ? {}
        : {
            session: {
              audience: sessionConfig.audience,
              prepare: sessionConfig.adapter.prepare,
              ...(sessionConfig.scopes === undefined
                ? {}
                : { scopes: sessionConfig.scopes }),
              ...(sessionConfig.ttlSeconds === undefined
                ? {}
                : { ttlSeconds: sessionConfig.ttlSeconds })
            }
          }),
      window
    })
    if (connected.recovery === undefined) {
      throw new Error("Complete recovery enrollment before connecting.")
    }
    const record = toSliceWalletCredentialRecord(connected)
    if (
      record.recoveryPermissionId !== null &&
      (record.recoveryPermissionId.toLowerCase() !==
        connected.recovery.permissionId.toLowerCase() ||
        record.recoverySignerAddress?.toLowerCase() !==
          connected.recovery.signerAddress.toLowerCase())
    ) {
      throw new Error("Recovery permission does not match its ceremony.")
    }
    await activateCredential(record)
    storeSliceWalletMetadata(credentialStorageKey, record)
    setHasStoredCredential(true)
    await sessionIntegration.complete(
      connected.session,
      connected.accountAddress
    )
    notifications?.success?.("Slice wallet ready")
  }, [
    activateCredential,
    ceremonyBroker,
    ceremonyMode,
    credentialStorageKey,
    normalizedIdOrigin,
    notifications,
    sessionConfig,
    sessionIntegration,
    setHasStoredCredential,
    walletChain.id
  ])

  const switchAccount = useCallback(async () => {
    setPendingAction("login")
    setError(null)
    try {
      await connectWallet()
      return true
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to switch Slice wallet accounts."
      setError(message)
      notifications?.error?.(message)
      return false
    } finally {
      setPendingAction(null)
    }
  }, [connectWallet, notifications, setError, setPendingAction])

  const signInWallet = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet) throw new Error("Unlock your Slice wallet first.")
    if (sessionConfig !== undefined) {
      const result = await requestSliceWalletSession({
        account: activeWallet.kernelAccount.address,
        ceremonyBroker,
        ceremonyMode,
        chainId: walletChain.id,
        document,
        idOrigin: normalizedIdOrigin,
        session: {
          audience: sessionConfig.audience,
          prepare: sessionConfig.adapter.prepare,
          ...(sessionConfig.scopes === undefined
            ? {}
            : { scopes: sessionConfig.scopes }),
          ...(sessionConfig.ttlSeconds === undefined
            ? {}
            : { ttlSeconds: sessionConfig.ttlSeconds })
        },
        window
      })
      await sessionIntegration.complete(
        result,
        activeWallet.kernelAccount.address
      )
      return
    }
    if (adapters.signInWithWallet === undefined) {
      throw new Error("Wallet sign-in is not configured.")
    }
    try {
      await adapters.signInWithWallet({
        address: activeWallet.kernelAccount.address,
        signMessage: (message) =>
          activeWallet.kernelAccount.signMessage({ message })
      })
      if (managementEnabled)
        await hydrateManagementExecutionSession(activeWallet)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to sign in."
      setError(message)
      notifications?.error?.(message)
      throw caughtError
    }
  }, [
    activeWalletRef,
    adapters,
    ceremonyBroker,
    ceremonyMode,
    hydrateManagementExecutionSession,
    managementEnabled,
    normalizedIdOrigin,
    notifications,
    sessionConfig,
    sessionIntegration,
    setError,
    walletChain.id
  ])

  return {
    createWallet: () => runWalletAction("create", connectWallet),
    loginWallet: () => runWalletAction("login", connectWallet),
    signInWallet,
    switchAccount
  }
}
