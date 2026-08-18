import type { Address, Chain, Hex } from "viem"
import type { SliceWalletCeremonyMode } from "./ceremony"
import type { SerializedWalletPolicyDescriptor, WalletCall } from "./policy"
import type {
  SliceWalletParameters,
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
  grantPermissions?: SliceWalletParameters["grantPermissions"]
  idOrigin: string
  requireAdmittedChain?: boolean
  session?: {
    onSession?: (
      result: SliceWalletCeremonySessionResult | undefined
    ) => void | Promise<void>
    prepare: NonNullable<SliceWalletSessionConnectInput["prepare"]>
  }
  storage?: Storage
  window?: Window
}

export type StoredGenericGrant = Omit<SliceWalletPermissionGrant, "version"> & {
  enableSignature: Hex
  policy: SerializedWalletPolicyDescriptor
  publicKey: Hex
  signerId: Address
}

export type StoredGenericGrantRotationPhase =
  | "prepared"
  | "transport-pending"
  | "submitted"
  | "installed"
  | "predecessor-disabled"
  | "frame-committed"
  | "active-grant-committed"

type StoredGenericGrantInstallationUserOperationBase = {
  callData: Hex
  callGasLimit: Hex
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
  nonce: Hex
  preVerificationGas: Hex
  sender: Address
  signature: Hex
  verificationGasLimit: Hex
}

export type StoredGenericGrantInstallationUserOperation =
  StoredGenericGrantInstallationUserOperationBase &
    (
      | { factory?: never; factoryData?: never }
      | { factory: Address; factoryData: Hex }
    ) &
    (
      | {
          paymaster?: never
          paymasterData?: never
          paymasterPostOpGasLimit?: never
          paymasterVerificationGasLimit?: never
        }
      | {
          paymaster: Address
          paymasterData: Hex
          paymasterPostOpGasLimit: Hex
          paymasterVerificationGasLimit: Hex
        }
    )

export type StoredGenericGrantInstallation = {
  callDataHash: Hex
  entryPoint: Address
  nonce: Hex
  sender: Address
  userOperation: StoredGenericGrantInstallationUserOperation
  userOperationHash: Hex
}

type StoredGenericGrantRotationBase = {
  predecessor: StoredGenericGrant
  rebroadcastAttempts: number
  replacement: StoredGenericGrant
  version: 1
}

export type StoredGenericGrantRotation =
  | (StoredGenericGrantRotationBase & {
      installation?: never
      phase: "prepared"
    })
  | (StoredGenericGrantRotationBase & {
      installation: StoredGenericGrantInstallation
      phase: "submitted" | "transport-pending"
    })
  | (StoredGenericGrantRotationBase & {
      installation?: StoredGenericGrantInstallation
      phase:
        | "active-grant-committed"
        | "frame-committed"
        | "installed"
        | "predecessor-disabled"
    })

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
