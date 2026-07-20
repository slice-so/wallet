import type { Address, Hex } from "viem"

export type SliceWalletPreparedSession = {
  audience: string
  nonce?: string
  pendingId?: string
  scopes?: readonly string[]
  sessionSigner: Address
  ttlSeconds?: number
}

export type SliceWalletSessionConnectInput = {
  audience: string
  prepare?: () => Promise<
    Omit<SliceWalletPreparedSession, "audience" | "scopes" | "ttlSeconds">
  >
  prepared?: Omit<
    SliceWalletPreparedSession,
    "audience" | "scopes" | "ttlSeconds"
  >
  scopes?: readonly string[]
  signal?: AbortSignal
  ttlSeconds?: number
}

export type SliceWalletCeremonySessionRequestMessage =
  | {
      status: "none" | "preparing"
      type: "slice-wallet:ceremony-session-request"
      version: 1
    }
  | {
      request: SliceWalletPreparedSession
      status: "prepared"
      type: "slice-wallet:ceremony-session-request"
      version: 1
    }
  | {
      status: "preparation_failed"
      type: "slice-wallet:ceremony-session-request"
      version: 1
    }

export type SliceWalletCeremonySessionResult =
  | {
      expiresAt: string
      grantMessage: string
      pendingId?: string
      sessionSigner: Address
      signature: Hex
      status: "granted"
    }
  | {
      status: "cancelled" | "preparation_failed" | "timed_out"
    }

export type SliceWalletSessionSnapshot = {
  account: Address
  audience: string
  chainId: number
  expiresAt: string
  sessionSigner: Address
}

export type SliceWalletSessionAdapter = {
  complete: (
    result: Extract<SliceWalletCeremonySessionResult, { status: "granted" }>
  ) => Promise<SliceWalletSessionSnapshot>
  end: () => Promise<void>
  fetch: () => Promise<SliceWalletSessionSnapshot | null>
  prepare: () => Promise<{
    nonce?: string
    pendingId?: string
    sessionSigner: Address
  }>
}

export type SliceWalletSessionConnectResult = {
  account: Address
  session?: SliceWalletCeremonySessionResult
}
