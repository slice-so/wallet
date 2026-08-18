import { resolveSliceWalletDeployment } from "@slicekit/wallet-primitives/kernel"
import {
  type Address,
  bytesToHex,
  type Hex,
  hexToBytes,
  isAddress,
  isHex
} from "viem"
import type {
  SliceWalletArgon2id,
  SliceWalletRecoveryBundleEnvelope,
  SliceWalletRecoveryBundlePayload,
  SliceWalletRecoveryJsonValue
} from "./types/recovery"

export const sliceWalletRecoveryKdfParameters = {
  iterations: 3,
  memoryKiB: 64 * 1024,
  parallelism: 1
} as const

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder("utf-8", { fatal: true })

const toArrayBuffer = (value: Uint8Array) => {
  const copy = new Uint8Array(value.length)
  copy.set(value)
  return copy.buffer
}

const recoveryAad = ({
  account,
  chainId,
  kdf
}: Pick<SliceWalletRecoveryBundleEnvelope, "account" | "chainId" | "kdf">) =>
  textEncoder.encode(
    JSON.stringify({
      account: account.toLowerCase(),
      chainId,
      kdf: {
        iterations: kdf.iterations,
        memoryKiB: kdf.memoryKiB,
        name: kdf.name,
        parallelism: kdf.parallelism,
        salt: kdf.salt.toLowerCase()
      }
    })
  )

const deriveAesKey = async ({
  argon2id,
  envelope,
  passphrase
}: {
  argon2id: SliceWalletArgon2id
  envelope: Pick<SliceWalletRecoveryBundleEnvelope, "kdf">
  passphrase: string
}) => {
  if (passphrase.length < 24) {
    throw new Error("Recovery passphrase must contain at least 24 characters.")
  }
  const rawKey = await argon2id({
    iterations: envelope.kdf.iterations,
    memoryKiB: envelope.kdf.memoryKiB,
    parallelism: envelope.kdf.parallelism,
    passphrase,
    salt: hexToBytes(envelope.kdf.salt)
  })
  if (rawKey.length !== 32) {
    throw new Error("Argon2id must derive exactly 32 bytes.")
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  )
}

const jsonRecord = (
  value: SliceWalletRecoveryJsonValue,
  label: string
): { readonly [key: string]: SliceWalletRecoveryJsonValue } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as { readonly [key: string]: SliceWalletRecoveryJsonValue }
}

const exactKeys = (
  value: { readonly [key: string]: SliceWalletRecoveryJsonValue },
  keys: readonly string[]
) => {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  ) {
    throw new Error("Recovery bundle contains an invalid field set.")
  }
}

const stringField = (
  value: SliceWalletRecoveryJsonValue | undefined,
  label: string
) => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`)
  return value
}

const integerField = (
  value: SliceWalletRecoveryJsonValue | undefined,
  label: string
) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer.`)
  }
  return value
}

const addressField = (
  value: SliceWalletRecoveryJsonValue | undefined,
  label: string
) => {
  const parsed = stringField(value, label)
  if (!isAddress(parsed)) throw new Error(`${label} must be an address.`)
  return parsed as Address
}

const hexField = (
  value: SliceWalletRecoveryJsonValue | undefined,
  label: string,
  bytes?: number
) => {
  const parsed = stringField(value, label)
  if (
    !isHex(parsed, { strict: true }) ||
    (bytes !== undefined && hexToBytes(parsed).length !== bytes)
  ) {
    throw new Error(`${label} must be valid hex.`)
  }
  return parsed as Hex
}

export const parseSliceWalletRecoveryBundle = (
  value: string | SliceWalletRecoveryJsonValue
): SliceWalletRecoveryBundleEnvelope => {
  const parsed =
    typeof value === "string"
      ? (JSON.parse(value) as SliceWalletRecoveryJsonValue)
      : value
  const input = jsonRecord(parsed, "Recovery bundle")
  exactKeys(input, ["account", "chainId", "cipher", "kdf"])
  const kdf = jsonRecord(input.kdf ?? null, "Recovery KDF")
  exactKeys(kdf, ["iterations", "memoryKiB", "name", "parallelism", "salt"])
  const cipher = jsonRecord(input.cipher ?? null, "Recovery cipher")
  exactKeys(cipher, ["ciphertext", "iv", "name", "tagLength"])
  if (
    kdf.name !== "argon2id" ||
    cipher.name !== "AES-256-GCM" ||
    cipher.tagLength !== 128
  ) {
    throw new Error("Recovery bundle algorithms are unsupported.")
  }
  const envelope: SliceWalletRecoveryBundleEnvelope = {
    account: addressField(input.account, "Recovery account"),
    chainId: integerField(input.chainId, "Recovery chain id"),
    cipher: {
      ciphertext: hexField(cipher.ciphertext, "Recovery ciphertext"),
      iv: hexField(cipher.iv, "Recovery IV", 12),
      name: "AES-256-GCM",
      tagLength: 128
    },
    kdf: {
      iterations: integerField(kdf.iterations, "Recovery KDF iterations"),
      memoryKiB: integerField(kdf.memoryKiB, "Recovery KDF memory"),
      name: "argon2id",
      parallelism: integerField(kdf.parallelism, "Recovery KDF parallelism"),
      salt: hexField(kdf.salt, "Recovery KDF salt", 16)
    }
  }
  if (
    envelope.chainId <= 0 ||
    hexToBytes(envelope.cipher.ciphertext).length < 17
  ) {
    throw new Error("Recovery bundle parameters are invalid.")
  }
  if (
    envelope.kdf.iterations !== sliceWalletRecoveryKdfParameters.iterations ||
    envelope.kdf.memoryKiB !== sliceWalletRecoveryKdfParameters.memoryKiB ||
    envelope.kdf.parallelism !== sliceWalletRecoveryKdfParameters.parallelism
  ) {
    throw new Error("Recovery bundle KDF parameters are unsupported.")
  }
  return envelope
}

const parsePayload = (value: SliceWalletRecoveryJsonValue) => {
  const input = jsonRecord(value, "Recovery payload")
  exactKeys(input, [
    "account",
    "accountIndex",
    "chainId",
    "credentialId",
    "credentialPublicKey",
    "factory",
    "factoryVersion",
    "recoveryPermissionId",
    "recoveryPrivateKey",
    "recoverySignerAddress"
  ])
  const payload: SliceWalletRecoveryBundlePayload = {
    account: addressField(input.account, "Recovery payload account"),
    accountIndex: stringField(input.accountIndex, "Recovery account index"),
    chainId: integerField(input.chainId, "Recovery payload chain id"),
    credentialId: stringField(input.credentialId, "Recovery credential id"),
    credentialPublicKey: hexField(
      input.credentialPublicKey,
      "Recovery credential public key",
      65
    ),
    factory: addressField(input.factory, "Recovery factory"),
    factoryVersion: stringField(
      input.factoryVersion,
      "Recovery factory version"
    ),
    recoveryPermissionId: hexField(
      input.recoveryPermissionId,
      "Recovery permission id",
      4
    ),
    recoveryPrivateKey: hexField(
      input.recoveryPrivateKey,
      "Recovery private key",
      32
    ),
    recoverySignerAddress: addressField(
      input.recoverySignerAddress,
      "Recovery signer address"
    )
  }
  if (
    !/^\d+$/.test(payload.accountIndex) ||
    payload.credentialId.length === 0 ||
    !payload.credentialPublicKey.startsWith("0x04")
  ) {
    throw new Error("Recovery payload metadata is invalid.")
  }
  const deployment = resolveSliceWalletDeployment({
    chainId: payload.chainId,
    factoryVersion: payload.factoryVersion
  })
  if (deployment.factory.toLowerCase() !== payload.factory.toLowerCase()) {
    throw new Error("Recovery payload factory does not match its profile.")
  }
  return { ...payload, factoryVersion: deployment.profile.id }
}

export const encryptSliceWalletRecoveryBundle = async ({
  argon2id,
  passphrase,
  payload
}: {
  argon2id: SliceWalletArgon2id
  passphrase: string
  payload: SliceWalletRecoveryBundlePayload
}): Promise<SliceWalletRecoveryBundleEnvelope> => {
  const deployment = resolveSliceWalletDeployment({
    chainId: payload.chainId,
    factoryVersion: payload.factoryVersion
  })
  if (deployment.factory.toLowerCase() !== payload.factory.toLowerCase()) {
    throw new Error("Recovery payload factory does not match its profile.")
  }
  const canonicalPayload = {
    ...payload,
    factoryVersion: deployment.profile.id
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const kdf = {
    ...sliceWalletRecoveryKdfParameters,
    name: "argon2id" as const,
    salt: bytesToHex(salt)
  }
  const base = {
    account: canonicalPayload.account,
    chainId: canonicalPayload.chainId,
    kdf
  }
  const key = await deriveAesKey({ argon2id, envelope: { kdf }, passphrase })
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: toArrayBuffer(recoveryAad(base)),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
      tagLength: 128
    },
    key,
    textEncoder.encode(JSON.stringify(canonicalPayload))
  )
  return {
    ...base,
    cipher: {
      ciphertext: bytesToHex(new Uint8Array(ciphertext)),
      iv: bytesToHex(iv),
      name: "AES-256-GCM",
      tagLength: 128
    }
  }
}

export const decryptSliceWalletRecoveryBundle = async ({
  argon2id,
  bundle,
  passphrase
}: {
  argon2id: SliceWalletArgon2id
  bundle: string | SliceWalletRecoveryBundleEnvelope
  passphrase: string
}) => {
  const envelope = parseSliceWalletRecoveryBundle(bundle)
  const key = await deriveAesKey({ argon2id, envelope, passphrase })
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: toArrayBuffer(recoveryAad(envelope)),
      iv: toArrayBuffer(hexToBytes(envelope.cipher.iv)),
      name: "AES-GCM",
      tagLength: envelope.cipher.tagLength
    },
    key,
    toArrayBuffer(hexToBytes(envelope.cipher.ciphertext))
  )
  const payload = parsePayload(
    JSON.parse(textDecoder.decode(plaintext)) as SliceWalletRecoveryJsonValue
  )
  if (
    payload.account.toLowerCase() !== envelope.account.toLowerCase() ||
    payload.chainId !== envelope.chainId
  ) {
    throw new Error(
      "Recovery payload does not match its authenticated envelope."
    )
  }
  return payload
}

export const generateSliceWalletRecoveryPassphrase = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return (
    bytesToHex(bytes)
      .slice(2)
      .match(/.{1,8}/g)
      ?.join("-") ?? ""
  )
}
