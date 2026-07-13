import { argon2id } from "hash-wasm"
import { hexToBytes } from "viem"
import type { SliceWalletArgon2id } from "./types"

export const recoveryArgon2id: SliceWalletArgon2id = async ({
  iterations,
  memoryKiB,
  parallelism,
  passphrase,
  salt
}) => {
  const value = await argon2id({
    hashLength: 32,
    iterations,
    memorySize: memoryKiB,
    outputType: "hex",
    parallelism,
    password: passphrase,
    salt
  })
  return hexToBytes(`0x${value}`)
}
