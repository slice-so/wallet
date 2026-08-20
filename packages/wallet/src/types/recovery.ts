import type { Address, Hex } from "viem"
import type {
  SliceTimelockPolicyParameters,
  SliceWalletRegisteredRootCredential
} from "../protocol/index"
import type { SliceWalletPublicClient } from "./account"
import type { SliceWalletRegistryCredential } from "./registry"

export type SliceRecoveryProposalStatus =
  | "none"
  | "pending"
  | "executed"
  | "cancelled"

export type CreateRecoveryPermissionAccountParameters = {
  accountIndex: bigint
  address: Address
  chainId: number
  client: SliceWalletPublicClient
  credential: SliceWalletRegisteredRootCredential
  enableSignature?: Hex
  factoryVersion?: string
  getFactoryArgs?: () => Promise<{
    factory?: Address | undefined
    factoryData?: Hex | undefined
  }>
  recoveryPrivateKey?: Hex
  recoverySignerAddress: Address
  /** Must match the policy originally installed on an already-deployed account. Registry-created counterfactual accounts use the canonical default. */
  recoveryTimelock?: SliceTimelockPolicyParameters
}

export type CreateDeployedRecoveryPermissionAccountParameters = {
  accountIndex: bigint
  address: Address
  chainId: number
  client: SliceWalletPublicClient
  factoryVersion?: string
  recoveryPrivateKey: Hex
  recoverySignerAddress: Address
  /** Must match the policy originally installed on the account. */
  recoveryTimelock?: SliceTimelockPolicyParameters
}

export type SliceWalletRecoveryCodePayload = {
  account: Address
  accountIndex: number
  chainId: number
  credentialIdHash: Hex
  credentialPublicKey: Hex
  recoveryPrivateKey: Hex
}

export type RecoveryUserOperationGas = {
  callGasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  preVerificationGas: bigint
  verificationGasLimit: bigint
}

export type SliceWalletRecoveryBundlePayload = {
  account: Address
  accountIndex: string
  chainId: number
  credentialId: string
  credentialPublicKey: Hex
  factory: Address
  factoryVersion: string
  recoveryPermissionId: Hex
  recoveryPrivateKey: Hex
  recoverySignerAddress: Address
}

export type SliceWalletRecoveryCall = {
  data: Hex
  to: Address
  value: bigint
}

export type SliceWalletRecoveryBundleEnvelope = {
  account: Address
  chainId: number
  cipher: {
    ciphertext: Hex
    iv: Hex
    name: "AES-256-GCM"
    tagLength: 128
  }
  kdf: {
    iterations: number
    memoryKiB: number
    name: "argon2id"
    parallelism: number
    salt: Hex
  }
}

export type SliceWalletArgon2id = (input: {
  iterations: number
  memoryKiB: number
  parallelism: number
  passphrase: string
  salt: Uint8Array
}) => Promise<Uint8Array>

export type SliceWalletRecoveryJsonValue =
  | boolean
  | null
  | number
  | string
  | readonly SliceWalletRecoveryJsonValue[]
  | { readonly [key: string]: SliceWalletRecoveryJsonValue }

export type SliceWalletRecoveryHandoffAuthorizationRequest = {
  account: Address
  accountIndex: number
  challenge: Hex
  chainId: number
  credentialIdHash: Hex
  factoryVersion: string
  message: string
  nonce: Hex
  publicKey: Hex
  type: "slice-wallet:recovery-root-authorization"
  version: 1
}

export type SliceWalletRecoveryHandoffAuthorizationResponse = {
  nonce: Hex
  recoveryPermissionId: Hex
  recoverySignerAddress: Address
  rootSignature: Hex
  type: "slice-wallet:recovery-root-signature"
  version: 1
}

export type SliceWalletRecoveryHandoffCredentialResponse = {
  credentialId: string
  nonce: Hex
  registry: SliceWalletRegistryCredential
  type: "slice-wallet:recovery-credential"
  version: 1
}

export type SliceWalletRecoveryHandoffErrorResponse = {
  message: string
  nonce: Hex
  type: "slice-wallet:recovery-error"
  version: 1
}
