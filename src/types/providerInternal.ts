import type { Address, Chain, Hex } from "viem"
import type { SliceWalletCeremonyMode } from "./ceremony"
import type { WalletCall } from "./policy"
import type {
  SliceWalletGenericGrant,
  SliceWalletProviderValue
} from "./provider"

export type SliceWalletProviderChainConfig = {
  bundlerUrl: string
  chain: Chain
  paymasterUrl?: string
  rpcUrl: string
}

export type SliceWalletProviderConfig = {
  announce?: boolean
  ceremonyMode?: SliceWalletCeremonyMode
  chains: readonly SliceWalletProviderChainConfig[]
  defaultChainId: number
  document?: Document
  fetch?: typeof fetch
  idOrigin: string
  requireAdmittedChain?: boolean
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
  chainId: number
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
  chainId?: number
  from: Address
}
