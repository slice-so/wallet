import type { DelegationChain } from "@slicekit/erc8128"
import type { Address, Hex } from "viem"
import type { SliceWalletProtocolValue } from "./frame"

export type SliceWalletPreparedSession = {
  claims: SliceWalletProtocolValue
  authorizationId?: Hex
  pendingId?: string
  sessionSigner: Address
}

export type SliceWalletSessionConnectInput = {
  prepare?: () => Promise<SliceWalletPreparedSession>
  prepared?: SliceWalletPreparedSession
  signal?: AbortSignal
}

export type SliceWalletCeremonySessionRequestMessage =
  | {
      status: "none" | "preparing"
      type: "slice-wallet:ceremony-session-request"
    }
  | {
      request: SliceWalletPreparedSession
      status: "prepared"
      type: "slice-wallet:ceremony-session-request"
    }
  | {
      status: "preparation_failed"
      type: "slice-wallet:ceremony-session-request"
    }

export type SliceWalletCeremonySessionResult =
  | {
      expiresAt: string
      delegation: DelegationChain
      pendingId?: string
      sessionSigner: Address
      status: "granted"
    }
  | {
      status: "cancelled" | "preparation_failed" | "timed_out"
    }

export type SliceWalletSessionConnectResult = {
  account: Address
  session?: SliceWalletCeremonySessionResult
}
