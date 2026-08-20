import type { Address, Hex } from "viem"
import type { SliceWalletCredentialRegistrationKind } from "../protocol/index"

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
