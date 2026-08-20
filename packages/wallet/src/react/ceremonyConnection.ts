"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Chain } from "viem"
import { createSliceWalletCeremonyBroker } from "../ceremony/broker"
import type { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
import { acquireSliceWalletSignerFrame } from "../frame/client"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletSignerFrameClient
} from "../types"
import type {
  SliceWalletConnectionAdapter,
  SliceWalletCredentialRecord,
  SliceWalletManagementLifecycle,
  SliceWalletNotifications,
  SliceWalletPendingAction
} from "../types/react"

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
  managementLifecycle,
  managementEnabled,
  notifications,
  setError,
  setPendingAction,
  connection,
  walletChain
}: {
  activeWalletRef: {
    current: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    } | null
  }
  managementLifecycle: SliceWalletManagementLifecycle
  managementEnabled: boolean
  notifications?: SliceWalletNotifications
  setError: (value: string | null) => void
  setPendingAction: (value: SliceWalletPendingAction) => void
  connection: SliceWalletConnectionAdapter
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

  const connectWallet = useCallback(async () => {
    await connection.connect(walletChain.id)
    notifications?.success?.("Slice wallet ready")
  }, [connection, notifications, walletChain.id])

  const signInWallet = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet) throw new Error("Unlock your Slice wallet first.")
    try {
      await (await connection.getProvider()).requestSession()
      if (managementEnabled) {
        await managementLifecycle.retryHydration(
          activeWallet.kernelAccount.address
        )
      }
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
    connection,
    managementEnabled,
    managementLifecycle,
    notifications,
    setError
  ])

  const switchAccount = useCallback(async () => {
    setPendingAction("login")
    setError(null)
    try {
      await (await connection.getProvider()).switchAccount()
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
  }, [connection, notifications, setError, setPendingAction])

  return {
    createWallet: () => runWalletAction("create", connectWallet),
    loginWallet: () => runWalletAction("login", connectWallet),
    signInWallet,
    switchAccount
  }
}
