import type { Address, Hex } from "viem"

export type SliceWalletP256KeyPair = {
  privateKey: CryptoKey
  publicKey: CryptoKey
  publicKeyHex: Hex
  signerId: Address
}
