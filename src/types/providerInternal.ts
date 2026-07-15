import type { Address, Chain, Hex } from "viem"
import type { SliceWalletCeremonyMode } from "./ceremony"
import type { WalletCall } from "./policy"
import type {
  SliceWalletGenericGrant,
  SliceWalletProviderValue
} from "./provider"

export type SliceWalletProviderConfig = {
  announce?: boolean
  bundlerUrl: string
  ceremonyMode?: SliceWalletCeremonyMode
  chain: Chain
  document?: Document
  fetch?: typeof fetch
  idOrigin: string
  paymasterUrl?: string
  requireAdmittedChain?: boolean
  rpcUrl: string
  storage?: Storage
  window?: Window
}

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
  paymasterService?: SliceWalletRequestPaymasterService
}

export type SliceWalletPaymasterContextValue = Exclude<
  SliceWalletProviderValue,
  bigint | undefined
>

export type SliceWalletCanonicalPaymasterContext = {
  canonicalHash: Hex
  canonicalJson: string
  value: SliceWalletPaymasterContextValue
}

export type SliceWalletRequestPaymasterService = {
  context?: SliceWalletCanonicalPaymasterContext
  url?: string
}

export type ParsedSliceWalletTransaction = {
  call: WalletCall
  from: Address
}
