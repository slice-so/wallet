"use client"

import { type Config, connect } from "@wagmi/core"
import { useCallback, useEffect, useRef, useState } from "react"
import type { Chain } from "viem"
import {
  acquireSliceWalletSignerFrame,
  createSliceWalletCeremonyBroker,
  type createSliceWalletCeremonyKernelAccount
} from "../index"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletProvider,
  SliceWalletSignerFrameClient
} from "../types"
import type {
  SliceWalletCredentialRecord,
  SliceWalletNotifications,
  SliceWalletPendingAction
} from "../types/react"
import { sliceWalletConnectorId } from "../wagmi"
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
      acquireSliceWalletSignerFrame({
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
  hydrateManagementExecutionSession,
  managementEnabled,
  notifications,
  sessionIntegration,
  setError,
  setPendingAction,
  wagmiConfig,
  walletChain
}: {
  activeWalletRef: {
    current: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    } | null
  }
  hydrateManagementExecutionSession: (wallet: {
    credential: SliceWalletCredentialRecord
    kernelAccount: RootAccount
  }) => Promise<void>
  managementEnabled: boolean
  notifications?: SliceWalletNotifications
  sessionIntegration: ReturnType<typeof useSliceWalletSessionIntegration>
  setError: (value: string | null) => void
  setPendingAction: (value: SliceWalletPendingAction) => void
  wagmiConfig: Config
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
        setError(message)
        notifications?.error?.(message)
        return false
      } finally {
        setPendingAction(null)
      }
    },
    [notifications, setError, setPendingAction]
  )

  const getSliceConnector = useCallback(() => {
    const connector = wagmiConfig.connectors.find(
      (candidate) => candidate.id === sliceWalletConnectorId
    )
    if (connector === undefined) {
      throw new Error("Slice Wallet connector is not configured.")
    }
    return connector
  }, [wagmiConfig.connectors])

  const getSliceProvider = useCallback(async () => {
    const provider = await getSliceConnector().getProvider()
    if (provider === undefined) {
      throw new Error("Slice Wallet provider is unavailable.")
    }
    return provider as SliceWalletProvider
  }, [getSliceConnector])

  const connectWallet = useCallback(async () => {
    const result = await connect(wagmiConfig, {
      chainId: walletChain.id,
      connector: getSliceConnector()
    })
    const account = result.accounts[0]
    if (account === undefined) throw new Error("Slice Wallet did not connect.")
    notifications?.success?.("Slice wallet ready")
  }, [getSliceConnector, notifications, wagmiConfig, walletChain.id])

  const signInWallet = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet) throw new Error("Unlock your Slice wallet first.")
    try {
      await (await getSliceProvider()).requestSession()
      await sessionIntegration.refresh()
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
    getSliceProvider,
    hydrateManagementExecutionSession,
    managementEnabled,
    notifications,
    sessionIntegration,
    setError
  ])

  const switchAccount = useCallback(async () => {
    setPendingAction("login")
    setError(null)
    try {
      await (await getSliceProvider()).switchAccount()
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
  }, [getSliceProvider, notifications, setError, setPendingAction])

  return {
    createWallet: () => runWalletAction("create", connectWallet),
    loginWallet: () => runWalletAction("login", connectWallet),
    signInWallet,
    switchAccount
  }
}
