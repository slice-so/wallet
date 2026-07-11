import { type Hex, hexToBytes, isHex, keccak256, stringToHex } from "viem"
import type {
  RegisterSliceWalletCredentialInput,
  SliceWalletCredentialRegistrationKind,
  SliceWalletRegistryChallenge,
  SliceWalletRegistryCredential
} from "./types/registry"

const base64UrlToBytes = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export const getSliceWalletCredentialIdHash = (credentialId: string): Hex => {
  const bytes = base64UrlToBytes(credentialId)
  if (bytes.length < 13) {
    throw new Error(
      "Wallet credential id must contain at least 100 bits of entropy."
    )
  }
  return keccak256(bytes)
}

export const formatSliceWalletExistingCredentialAuthorization = ({
  accountAddress,
  accountIndex,
  challenge,
  credentialIdHash,
  factoryVersion,
  publicKey
}: {
  accountAddress: string
  accountIndex: number
  challenge: Hex
  credentialIdHash: Hex
  factoryVersion: string
  publicKey: Hex
}) =>
  [
    "Slice Wallet Root Credential",
    "",
    "Authorize this credential as a root for the existing wallet.",
    "",
    "Version: 1",
    `Account: ${accountAddress.toLowerCase()}`,
    `Credential ID Hash: ${credentialIdHash}`,
    `Public Key Hash: ${keccak256(publicKey)}`,
    `Factory Version: ${factoryVersion}`,
    `Account Index: ${accountIndex}`,
    `Challenge: ${challenge}`
  ].join("\n")

const readJson = async <T>(
  responsePromise: Response | Promise<Response>
): Promise<T> => {
  const response = await responsePromise
  if (!response.ok) throw new Error(await response.text())
  return (await response.json()) as T
}

export const createSliceWalletRegistryClient = ({
  baseUrl,
  fetch: fetchImpl = fetch
}: {
  baseUrl: string
  fetch?: typeof fetch
}) => {
  const url = (path: string) => new URL(path, baseUrl)
  return {
    createChallenge: (
      registrationKind: SliceWalletCredentialRegistrationKind,
      accountAddress?: string
    ) =>
      readJson<SliceWalletRegistryChallenge>(
        fetchImpl(url("/v1/registry/challenges"), {
          body: JSON.stringify({
            ...(accountAddress === undefined ? {} : { accountAddress }),
            registrationKind
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      ),
    getCredential: async (credentialIdHash: Hex) => {
      if (
        !isHex(credentialIdHash, { strict: true }) ||
        hexToBytes(credentialIdHash).length !== 32
      ) {
        throw new Error("Credential id hash must be 32-byte hex.")
      }
      const response = await fetchImpl(
        url(`/v1/registry/credentials/${credentialIdHash}`)
      )
      if (response.status === 404) return null
      return readJson<SliceWalletRegistryCredential>(response)
    },
    registerCredential: (input: RegisterSliceWalletCredentialInput) =>
      readJson<SliceWalletRegistryCredential>(
        fetchImpl(url("/v1/registry/credentials"), {
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      )
  }
}

export const getSliceWalletRegistryProofChallenge = ({
  challenge,
  credentialIdHash,
  publicKey,
  registrationKind
}: {
  challenge: Hex
  credentialIdHash: Hex
  publicKey: Hex
  registrationKind: SliceWalletCredentialRegistrationKind
}) =>
  // This commits the assertion to the submitted credential tuple. WebAuthn
  // assertions do not attest that an authenticator assigned an id to a key;
  // immutable first-registration remains protected by the trusted ceremony
  // registering the high-entropy id before disclosing it.
  keccak256(
    stringToHex(
      [
        "Slice Wallet Credential Registration v1",
        registrationKind,
        challenge,
        credentialIdHash,
        keccak256(publicKey)
      ].join("\n")
    )
  )
