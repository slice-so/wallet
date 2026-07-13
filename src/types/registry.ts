import type { Address, Hex } from "viem"

export type SliceWalletCredentialRegistrationKind =
  | "existing_account"
  | "initial"

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
  challenge: Hex
  expiresAt: string
  registrationKind: SliceWalletCredentialRegistrationKind
}

export type RegisterSliceWalletCredentialInput = {
  accountAddress?: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  challenge: Hex
  credentialId: string
  credentialProof: SliceWalletCredentialProof
  publicKey: Hex
  recoverySignerAddress?: Address
  registrationKind: SliceWalletCredentialRegistrationKind
  rootSignature?: Hex
}
