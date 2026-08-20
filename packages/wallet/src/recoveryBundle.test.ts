import { describe, expect, it } from "bun:test"
import { concatBytes, stringToBytes, toBytes } from "viem"
import { sliceWalletCurrentDeploymentProfileId } from "./protocol/index"
import {
  decryptSliceWalletRecoveryBundle,
  encryptSliceWalletRecoveryBundle,
  parseSliceWalletRecoveryBundle
} from "./recoveryBundle"
import type {
  SliceWalletArgon2id,
  SliceWalletRecoveryBundlePayload
} from "./types"

const testKdf: SliceWalletArgon2id = async ({
  iterations,
  memoryKiB,
  parallelism,
  passphrase,
  salt
}) => {
  const input = concatBytes([
    stringToBytes(passphrase),
    salt,
    toBytes(iterations, { size: 4 }),
    toBytes(memoryKiB, { size: 4 }),
    toBytes(parallelism, { size: 4 })
  ])
  const copy = new Uint8Array(input.length)
  copy.set(input)
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer))
}

const payload = {
  account: "0x1111111111111111111111111111111111111111",
  accountIndex: "0",
  chainId: 8453,
  credentialId: "credential-id",
  credentialPublicKey: `0x04${"22".repeat(64)}`,
  factory: "0xa299a4efee7bbfb2ea5668b30218c45fff78356c",
  factoryVersion: "Kernel 0.4.0",
  recoveryPermissionId: "0x12345678",
  recoveryPrivateKey: `0x${"33".repeat(32)}`,
  recoverySignerAddress: "0x3333333333333333333333333333333333333333"
} as const satisfies SliceWalletRecoveryBundlePayload

describe("Slice Wallet recovery bundle", () => {
  it("round-trips an authenticated payload without exposing the key", async () => {
    const bundle = await encryptSliceWalletRecoveryBundle({
      argon2id: testKdf,
      passphrase: "correct horse battery staple",
      payload
    })
    expect(JSON.stringify(bundle)).not.toContain(payload.recoveryPrivateKey)
    await expect(
      decryptSliceWalletRecoveryBundle({
        argon2id: testKdf,
        bundle,
        passphrase: "correct horse battery staple"
      })
    ).resolves.toEqual({
      ...payload,
      factoryVersion: sliceWalletCurrentDeploymentProfileId
    })
  })

  it("rejects a wrong passphrase, AAD tampering, and unknown fields", async () => {
    const bundle = await encryptSliceWalletRecoveryBundle({
      argon2id: testKdf,
      passphrase: "correct horse battery staple",
      payload
    })
    await expect(
      decryptSliceWalletRecoveryBundle({
        argon2id: testKdf,
        bundle,
        passphrase: "incorrect horse battery staple"
      })
    ).rejects.toBeDefined()
    await expect(
      decryptSliceWalletRecoveryBundle({
        argon2id: testKdf,
        bundle: { ...bundle, chainId: 1 },
        passphrase: "correct horse battery staple"
      })
    ).rejects.toBeDefined()
    expect(() =>
      parseSliceWalletRecoveryBundle({ ...bundle, privateKey: "0x01" })
    ).toThrow("invalid field set")
    expect(() =>
      parseSliceWalletRecoveryBundle({
        ...bundle,
        kdf: { ...bundle.kdf, memoryKiB: 1024 * 1024 }
      })
    ).toThrow("unsupported")
  })
})
