import type { Address, Hex } from "viem"

export type SliceWalletCredentialRegistrationKind =
  | "device"
  | "existing_account"
  | "initial"
  | "sub_account"

export type SliceWalletCredentialProof = {
  authenticatorData: Hex
  clientDataJSON: string
  r: string
  s: string
  userVerificationRequired: true
}

export type SliceWalletRegistryCredential = {
  accountAddress: Address
  accountIndex: number
  createdAt: string
  credentialIdHash: Hex
  factoryVersion: string
  publicKey: Hex
  recoveryPermissionId: Hex | null
  recoverySignerAddress: Address | null
  registrationKind: SliceWalletCredentialRegistrationKind
}

export type SliceWalletRegistryChallenge = {
  accountIndex: number
  challenge: Hex
  chainId: number
  expiresAt: string
  registrationKind: SliceWalletCredentialRegistrationKind
}

export type RegisterSliceWalletCredentialInput = {
  accountAddress?: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  accountIndex: number
  challenge: Hex
  chainId: number
  credentialId: string
  credentialProof: SliceWalletCredentialProof
  publicKey: Hex
  recoverySignerAddress?: Address
  registrationKind: SliceWalletCredentialRegistrationKind
  rootSignature?: Hex
}

export type SliceWalletCredentialListChallenge = {
  challenge: Hex
  chainId: number
  expiresAt: string
  purpose: "credential-list"
}

export type SliceWalletCredentialAccountsChallenge = {
  challenge: Hex
  chainId: number
  expiresAt: string
  purpose: "credential-accounts"
}

export type SliceWalletCredentialAccountsAssertion = {
  authenticatorData: Hex
  clientDataJSON: string
  r: string
  s: string
  userVerificationRequired: true
}

export type SliceWalletCredentialRowClassification = {
  credential: SliceWalletRegistryCredential
  status: "active" | "inactive" | "unavailable"
}

export type SliceWalletCredentialListAuthorization = {
  accountAddress: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  challenge: Hex
  chainId: number
  expiresAt: string
  signature: Hex
}
