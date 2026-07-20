import {
  createSessionGrantMessage,
  createSessionGrantNonce,
  defaultSessionGrantTtlSeconds
} from "@slicekit/erc8128/sessions"
import { type Address, type Hex, stringToHex } from "viem"
import type {
  SliceWalletCeremonySessionResult,
  SliceWalletProvider
} from "./types"

export const signSessionGrant = async (
  provider: Pick<SliceWalletProvider, "request">,
  {
    account,
    appOrigin,
    audience,
    chainId,
    nonce = createSessionGrantNonce(),
    scopes = [],
    sessionSigner,
    ttlSeconds = defaultSessionGrantTtlSeconds
  }: {
    account: Address
    appOrigin: string
    audience: string
    chainId: number
    nonce?: string
    scopes?: readonly string[]
    sessionSigner: Address
    ttlSeconds?: number
  }
): Promise<Extract<SliceWalletCeremonySessionResult, { status: "granted" }>> => {
  const issuedAt = Math.floor(Date.now() / 1_000)
  const expiresAt = issuedAt + ttlSeconds
  const grantMessage = createSessionGrantMessage({
    account,
    appOrigin,
    audience,
    chainId,
    expiresAt,
    issuedAt,
    nonce,
    scopes,
    sessionSigner
  })
  const signature = await provider.request({
    method: "personal_sign",
    params: [stringToHex(grantMessage), account]
  })
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    throw new Error("Wallet returned an invalid session grant signature.")
  }
  return {
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
    grantMessage,
    sessionSigner,
    signature: signature as Hex,
    status: "granted"
  }
}

export type * from "./types/session"
