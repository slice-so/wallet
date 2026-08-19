import type { Address, Hex } from "viem"
import type { WalletGrantKind, WalletPolicyDescriptor } from "./policy"

export type SliceWalletProtocolValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | readonly SliceWalletProtocolValue[]
  | { readonly [key: string]: SliceWalletProtocolValue }

export type SliceWalletCheckoutGrant = {
  allowanceUsdMicros: string
  budgetPeriodSec?: number
  coSignerAddress: Address
}

export type SliceWalletFrameSession = {
  account: Address
  chainId: number
  checkout?: SliceWalletCheckoutGrant
  expiresAt: number
  grantKind: WalletGrantKind
  permissionId: Hex
  policy: WalletPolicyDescriptor
  publicKey: Hex
  signerId: Address
}

export type SliceWalletFrameSessionKey = Pick<
  SliceWalletFrameSession,
  "account" | "chainId" | "grantKind"
>

export type SliceWalletPermissionAuthorization = {
  accountIndex: number
  accountFactory?: Address
  accountFactoryData?: Hex
  appOrigin: string
  enableSignature: Hex
  executionGrant?: {
    expiresAt: number
    nonce: Hex
    scopes: readonly string[]
    signerProof: Hex
  }
  rootCredential: {
    credentialIdHash: Hex
    publicKey: Hex
  }
  session: SliceWalletFrameSession
}
