import type { Address, Hex } from "viem"
import type { SliceWalletGenericGrant, WalletCall } from "./index"

export type StoredGenericGrant = SliceWalletGenericGrant & {
  enableSignature: Hex
  version: 1
}

export type StoredWalletCall = {
  chainId: number
  createdAt: number
  id: string
  userOperationHash: Hex
  version: 1
}

export type ParsedSliceWalletSendCalls = {
  calls: readonly WalletCall[]
  id?: string
}

export type ParsedSliceWalletTransaction = {
  call: WalletCall
  from: Address
}
