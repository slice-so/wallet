import { useCallback, useEffect, useRef, useState } from "react"
import { isAddressEqual } from "viem"
import type {
  SliceWalletCeremonySessionResult,
  SliceWalletSessionAdapter,
  SliceWalletSessionSnapshot
} from "../types/session"

const validateSnapshot = ({
  account,
  audience,
  chainId,
  snapshot
}: {
  account: `0x${string}`
  audience: string
  chainId: number
  snapshot: SliceWalletSessionSnapshot
}) => {
  if (
    !isAddressEqual(snapshot.account, account) ||
    snapshot.audience !== audience ||
    snapshot.chainId !== chainId ||
    new Date(snapshot.expiresAt) <= new Date()
  ) {
    throw new Error("Slice Wallet session does not match the active wallet.")
  }
  return snapshot
}

export const useSliceWalletSessionIntegration = ({
  account,
  adapter,
  audience,
  chainId,
  warn
}: {
  account: `0x${string}` | null
  adapter?: SliceWalletSessionAdapter
  audience?: string
  chainId: number
  warn: (message: string) => void
}) => {
  const [session, setSession] = useState<SliceWalletSessionSnapshot | null>(
    null
  )
  const [sessionError, setSessionError] = useState<string | null>(null)
  const generation = useRef(0)
  const previousIdentity = useRef<string | null>(null)

  const revoke = useCallback(async () => {
    generation.current += 1
    setSession(null)
    setSessionError(null)
    if (adapter === undefined) return
    try {
      await adapter.end()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Session revocation failed."
      warn(message)
    }
  }, [adapter, warn])

  useEffect(() => {
    const identity =
      account === null || audience === undefined
        ? null
        : `${account.toLowerCase()}:${chainId}:${audience}`
    if (
      previousIdentity.current !== null &&
      previousIdentity.current !== identity &&
      session !== null
    ) {
      void revoke()
    }
    previousIdentity.current = identity
  }, [account, audience, chainId, revoke, session])

  useEffect(() => {
    if (account === null || adapter === undefined || audience === undefined) {
      setSession(null)
      return
    }
    const capturedGeneration = ++generation.current
    void adapter
      .fetch()
      .then((snapshot) => {
        if (capturedGeneration !== generation.current) return
        setSession(
          snapshot === null
            ? null
            : validateSnapshot({ account, audience, chainId, snapshot })
        )
        setSessionError(null)
      })
      .catch((error) => {
        if (capturedGeneration !== generation.current) return
        setSession(null)
        setSessionError(
          error instanceof Error ? error.message : "Session hydration failed."
        )
      })
  }, [account, adapter, audience, chainId])

  const complete = useCallback(
    async (
      result: SliceWalletCeremonySessionResult | undefined,
      selectedAccount: `0x${string}` | null = account
    ) => {
      if (
        result?.status !== "granted" ||
        selectedAccount === null ||
        adapter === undefined ||
        audience === undefined
      ) {
        if (result !== undefined && result.status !== "granted") {
          setSessionError(`Session ${result.status.replaceAll("_", " ")}.`)
        }
        return
      }
      const capturedGeneration = ++generation.current
      try {
        const snapshot = validateSnapshot({
          account: selectedAccount,
          audience,
          chainId,
          snapshot: await adapter.complete(result)
        })
        if (capturedGeneration !== generation.current) return
        setSession(snapshot)
        setSessionError(null)
      } catch (error) {
        if (capturedGeneration !== generation.current) return
        setSession(null)
        setSessionError(
          error instanceof Error ? error.message : "Session completion failed."
        )
      }
    },
    [account, adapter, audience, chainId]
  )

  return { complete, revoke, session, sessionError }
}
