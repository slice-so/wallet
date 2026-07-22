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

type IntegrationConfig = {
  account: `0x${string}` | null
  adapter?: SliceWalletSessionAdapter
  audience?: string
  chainId: number
  warn: (message: string) => void
}

type IntegrationState = {
  session: SliceWalletSessionSnapshot | null
  sessionError: string | null
}

export const createSliceWalletSessionIntegration = ({
  onChange
}: {
  onChange: (state: IntegrationState) => void
}) => {
  let config: IntegrationConfig = {
    account: null,
    chainId: 0,
    warn: () => undefined
  }
  let generation = 0
  let previousIdentity: string | null = null
  let state: IntegrationState = { session: null, sessionError: null }

  const updateState = (next: IntegrationState) => {
    state = next
    onChange(state)
  }

  const endSession = async ({
    adapter,
    warn
  }: Pick<IntegrationConfig, "adapter" | "warn">) => {
    if (adapter === undefined) return
    try {
      await adapter.end()
    } catch (error) {
      warn(
        error instanceof Error ? error.message : "Session revocation failed."
      )
    }
  }

  const revoke = async () => {
    generation += 1
    updateState({ session: null, sessionError: null })
    await endSession(config)
  }

  const configure = (nextConfig: IntegrationConfig) => {
    const previousConfig = config
    const identity =
      nextConfig.account === null || nextConfig.audience === undefined
        ? null
        : `${nextConfig.account.toLowerCase()}:${nextConfig.chainId}:${nextConfig.audience}`
    const shouldEndPreviousSession =
      previousIdentity !== null && previousIdentity !== identity
    config = nextConfig
    previousIdentity = identity
    if (
      config.account === null ||
      config.adapter === undefined ||
      config.audience === undefined
    ) {
      generation += 1
      updateState({ session: null, sessionError: null })
      if (shouldEndPreviousSession) void endSession(previousConfig)
      return
    }
    const capturedGeneration = ++generation
    const { account, adapter, audience, chainId } = config
    if (shouldEndPreviousSession) {
      updateState({ session: null, sessionError: null })
    }
    void (
      shouldEndPreviousSession
        ? endSession(previousConfig).then(() => adapter.fetch())
        : adapter.fetch()
    )
      .then((snapshot) => {
        if (capturedGeneration !== generation) return
        updateState({
          session:
            snapshot === null
              ? null
              : validateSnapshot({ account, audience, chainId, snapshot }),
          sessionError: null
        })
      })
      .catch((error) => {
        if (capturedGeneration !== generation) return
        updateState({
          session: null,
          sessionError:
            error instanceof Error ? error.message : "Session hydration failed."
        })
      })
  }

  const complete = async (
    result: SliceWalletCeremonySessionResult | undefined,
    selectedAccount: `0x${string}` | null = config.account
  ) => {
    if (
      result?.status !== "granted" ||
      selectedAccount === null ||
      config.adapter === undefined ||
      config.audience === undefined
    ) {
      if (result !== undefined && result.status !== "granted") {
        updateState({
          ...state,
          sessionError: `Session ${result.status.replaceAll("_", " ")}.`
        })
      }
      return
    }
    const capturedGeneration = ++generation
    try {
      const snapshot = validateSnapshot({
        account: selectedAccount,
        audience: config.audience,
        chainId: config.chainId,
        snapshot: await config.adapter.complete(result)
      })
      if (capturedGeneration !== generation) return
      updateState({ session: snapshot, sessionError: null })
    } catch (error) {
      if (capturedGeneration !== generation) return
      updateState({
        session: null,
        sessionError:
          error instanceof Error ? error.message : "Session completion failed."
      })
    }
  }

  const refresh = async () => {
    if (
      config.account === null ||
      config.adapter === undefined ||
      config.audience === undefined
    ) {
      updateState({ session: null, sessionError: null })
      return
    }
    const capturedGeneration = ++generation
    const { account, adapter, audience, chainId } = config
    try {
      const snapshot = await adapter.fetch()
      if (capturedGeneration !== generation) return
      updateState({
        session:
          snapshot === null
            ? null
            : validateSnapshot({ account, audience, chainId, snapshot }),
        sessionError: null
      })
    } catch (error) {
      if (capturedGeneration !== generation) return
      updateState({
        session: null,
        sessionError:
          error instanceof Error ? error.message : "Session refresh failed."
      })
    }
  }

  return { complete, configure, getState: () => state, refresh, revoke }
}

export const useSliceWalletSessionIntegration = (config: IntegrationConfig) => {
  const { account, adapter, audience, chainId, warn } = config
  const [state, setState] = useState<IntegrationState>({
    session: null,
    sessionError: null
  })
  const integrationRef = useRef<
    ReturnType<typeof createSliceWalletSessionIntegration> | undefined
  >(undefined)
  integrationRef.current ??= createSliceWalletSessionIntegration({
    onChange: setState
  })
  const integration = integrationRef.current

  useEffect(
    () => integration.configure({ account, adapter, audience, chainId, warn }),
    [account, adapter, audience, chainId, warn, integration]
  )

  const complete = useCallback(
    (...args: Parameters<typeof integration.complete>) =>
      integration.complete(...args),
    [integration]
  )
  const revoke = useCallback(() => integration.revoke(), [integration])
  const refresh = useCallback(() => integration.refresh(), [integration])

  return { complete, refresh, revoke, ...state }
}
