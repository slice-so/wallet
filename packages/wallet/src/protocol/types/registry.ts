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

export type RegisterSliceWalletCredentialInput = {
  accountAddress?: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  accountIndex: number
  challenge: Hex
  chainId: number
  credentialId: string
  credentialProof: SliceWalletCredentialProof
  factoryVersion?: string
  publicKey: Hex
  recoverySignerAddress?: Address
  registrationKind: SliceWalletCredentialRegistrationKind
  rootSignature?: Hex
}
