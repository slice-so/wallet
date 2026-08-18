import { argon2id } from "hash-wasm"
import type { SliceWalletArgon2id } from "./types"

export const recoveryArgon2id: SliceWalletArgon2id = async ({
  iterations,
  memoryKiB,
  parallelism,
  passphrase,
  salt
}) => {
  return argon2id({
    hashLength: 32,
    iterations,
    memorySize: memoryKiB,
    outputType: "binary",
    parallelism,
    password: passphrase,
    salt
  })
}
