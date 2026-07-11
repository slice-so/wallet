import type { Policy, PolicyFlags } from "@zerodev/permissions"
import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import type { Address, Hex } from "viem"
import type { SliceWalletRegisteredRootCredential } from "./account"
import type { SliceWalletRegistryCredential } from "./registry"

export type SliceRecoveryProposalStatus =
  | "none"
  | "pending"
  | "executed"
  | "cancelled"

export type SliceTimelockPolicyParameters = {
  delaySec?: number
  expirationSec?: number
  guardian?: Address
  policyAddress?: Address
  policyFlag?: PolicyFlags
}

export type SliceTimelockPolicy = Policy & {
  sliceTimelockPolicyParams: {
    delaySec: number
    expirationSec: number
    guardian: Address
    policyAddress: Address
    policyFlag: PolicyFlags
    type: "slice-timelock"
  }
}

export type CreateRecoveryPermissionAccountParameters = {
  address: Address
  chainId: number
  client: KernelSmartAccountImplementation["client"]
  credential: SliceWalletRegisteredRootCredential
  enableSignature?: Hex
  getFactoryArgs?: () => Promise<{
    factory?: Address | undefined
    factoryData?: Hex | undefined
  }>
  recoveryPrivateKey?: Hex
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
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
  metaFactory: Address
  recoveryPermissionId: Hex
  recoveryPrivateKey: Hex
  runbookVersion: 1
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
  version: 1
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
