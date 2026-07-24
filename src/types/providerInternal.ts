import type { Address, Chain, Hex } from "viem"
import type { SliceWalletCeremonyMode } from "./ceremony"
import type { WalletCall } from "./policy"
import type {
  SliceWalletPermissionGrant,
  SliceWalletProviderValue
} from "./provider"
import type {
  SliceWalletCeremonySessionResult,
  SliceWalletSessionConnectInput
} from "./session"

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
  grantPermissions?: import("./provider").SliceWalletParameters["grantPermissions"]
  idOrigin: string
  requireAdmittedChain?: boolean
  session?: {
    audience: string
    onSession?: (
      result: SliceWalletCeremonySessionResult | undefined
    ) => void | Promise<void>
    prepare: NonNullable<SliceWalletSessionConnectInput["prepare"]>
    scopes?: readonly string[]
    ttlSeconds?: number
  }
  storage?: Storage
  window?: Window
}

export type StoredGenericGrant = Omit<SliceWalletPermissionGrant, "version"> & {
  enableSignature: Hex
  policy: import("./policy").SerializedWalletPolicyDescriptor
  publicKey: Hex
  signerId: Address
}

export type StoredGenericGrantRotationPhase =
  | "prepared"
  | "submitting"
  | "submitted"
  | "installed"
  | "predecessor-disabled"
  | "frame-committed"
  | "active-grant-committed"

export type StoredGenericGrantRotation = {
  installationUserOperationHash?: Hex
  phase: StoredGenericGrantRotationPhase
  predecessor: StoredGenericGrant
  replacement: StoredGenericGrant
  version: 1
}

export type StoredWalletCall = {
  chainId: number
  createdAt: number
  id: string
  userOperationHash: Hex
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
