import { type Hex, hexToBytes, isHex, keccak256, stringToHex } from "viem"
import { assertSliceWalletAccountIndex } from "./accountIndex"
import type {
  RegisterSliceWalletCredentialInput,
  SliceWalletCredentialAccountsAssertion,
  SliceWalletCredentialAccountsChallenge,
  SliceWalletCredentialListAuthorization,
  SliceWalletCredentialListChallenge,
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
  chainId,
  credentialIdHash,
  factoryVersion,
  publicKey,
  registrationKind = "existing_account"
}: {
  accountAddress: string
  accountIndex: number
  challenge: Hex
  chainId: number
  credentialIdHash: Hex
  factoryVersion: string
  publicKey: Hex
  registrationKind?: "device" | "existing_account"
}) =>
  [
    "Slice Wallet Root Credential",
    "",
    registrationKind === "device"
      ? "Authorize this credential as a root-equivalent device for the existing wallet."
      : "Authorize this credential as a root for the existing wallet.",
    "",
    "Version: 2",
    `Account: ${accountAddress.toLowerCase()}`,
    `Chain ID: ${chainId}`,
    `Credential ID Hash: ${credentialIdHash}`,
    `Public Key Hash: ${keccak256(publicKey)}`,
    `Factory Version: ${factoryVersion}`,
    `Account Index: ${accountIndex}`,
    `Challenge: ${challenge}`
  ].join("\n")

export const formatSliceWalletCredentialListAuthorization = ({
  accountAddress,
  challenge,
  chainId,
  expiresAt
}: Omit<SliceWalletCredentialListAuthorization, "signature">) =>
  [
    "Slice Wallet Credential List",
    "",
    "Authorize a private list of credentials registered to this wallet.",
    "",
    "Version: 1",
    `Account: ${accountAddress.toLowerCase()}`,
    `Chain ID: ${chainId}`,
    "Purpose: credential-list",
    `Expires At: ${expiresAt}`,
    `Nonce: ${challenge}`
  ].join("\n")

export class SliceWalletRegistryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string
  ) {
    super(`Slice wallet registry request failed with status ${status}.`)
  }
}

const readJson = async <T>(
  responsePromise: Response | Promise<Response>
): Promise<T> => {
  const response = await responsePromise
  if (!response.ok) {
    throw new SliceWalletRegistryRequestError(
      response.status,
      await response.text()
    )
  }
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
    createCredentialListChallenge: (accountAddress: string, chainId: number) =>
      readJson<SliceWalletCredentialListChallenge>(
        fetchImpl(url("/v1/registry/credential-list/challenges"), {
          body: JSON.stringify({ accountAddress, chainId }),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      ),
    createChallenge: (
      registrationKind: SliceWalletCredentialRegistrationKind,
      chainId: number,
      accountAddress?: string,
      credentialIdHash?: Hex,
      accountIndex?: number,
      challenge?: Hex
    ) =>
      readJson<SliceWalletRegistryChallenge>(
        fetchImpl(url("/v1/registry/challenges"), {
          body: JSON.stringify({
            ...(accountAddress === undefined ? {} : { accountAddress }),
            ...(credentialIdHash === undefined ? {} : { credentialIdHash }),
            ...(accountIndex === undefined
              ? {}
              : { accountIndex: assertSliceWalletAccountIndex(accountIndex) }),
            ...(challenge === undefined ? {} : { challenge }),
            chainId,
            registrationKind
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      ),
    lookupCredential: async ({
      accountAddress,
      credentialIdHash
    }: {
      accountAddress: string
      credentialIdHash: Hex
    }) => {
      if (
        !isHex(credentialIdHash, { strict: true }) ||
        hexToBytes(credentialIdHash).length !== 32
      ) {
        throw new Error("Credential id hash must be 32-byte hex.")
      }
      const response = await fetchImpl(url("/v1/registry/credentials/lookup"), {
        body: JSON.stringify({ accountAddress, credentialIdHash }),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
      if (response.status === 404) return null
      return readJson<SliceWalletRegistryCredential>(response)
    },
    createCredentialAccountsChallenge: (chainId: number) =>
      readJson<SliceWalletCredentialAccountsChallenge>(
        fetchImpl(url("/v1/registry/credential-accounts/challenges"), {
          body: JSON.stringify({ chainId }),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      ),
    listCredentialAccounts: ({
      assertionResponse,
      chainId,
      challenge,
      credentialId
    }: {
      assertionResponse: SliceWalletCredentialAccountsAssertion
      chainId: number
      challenge: Hex
      credentialId: string
    }) =>
      readJson<readonly SliceWalletRegistryCredential[]>(
        fetchImpl(url("/v1/registry/credential-accounts"), {
          body: JSON.stringify({
            assertionResponse,
            chainId,
            challenge,
            credentialId
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      ),
    listAuthorizedAccountCredentials: (
      authorization: SliceWalletCredentialListAuthorization
    ) =>
      readJson<readonly SliceWalletRegistryCredential[]>(
        fetchImpl(url("/v1/registry/credential-list"), {
          body: JSON.stringify(authorization),
          headers: { "content-type": "application/json" },
          method: "POST"
        })
      ),
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
  chainId,
  credentialIdHash,
  accountIndex,
  publicKey,
  recoverySignerAddress,
  registrationKind
}: {
  challenge: Hex
  accountIndex: number
  chainId: number
  credentialIdHash: Hex
  publicKey: Hex
  recoverySignerAddress?: `0x${string}`
  registrationKind: SliceWalletCredentialRegistrationKind
}) =>
  // This commits the assertion to the submitted credential tuple. WebAuthn
  // assertions do not attest that an authenticator assigned an id to a key;
  // immutable first-registration remains protected by the trusted ceremony
  // registering the high-entropy id before disclosing it.
  keccak256(
    stringToHex(
      [
        "Slice Wallet Credential Registration v3",
        registrationKind,
        String(chainId),
        challenge,
        credentialIdHash,
        String(assertSliceWalletAccountIndex(accountIndex)),
        keccak256(publicKey),
        recoverySignerAddress?.toLowerCase() ?? "none"
      ].join("\n")
    )
  )
