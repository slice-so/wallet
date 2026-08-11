import {
  type Address,
  encodeAbiParameters,
  type Hex,
  isAddress,
  isHex,
  keccak256,
  stringToHex
} from "viem"
import { assertSliceWalletAccountIndex } from "../accountIndex"
import { assertSliceWalletGrantScope } from "../grantScope"
import { encodeWalletPolicyDescriptor, getWalletPolicyHash } from "../policy"
import type { SliceWalletFrameSession } from "../types/frame"

const appPermissionRequestDomain = keccak256(
  stringToHex("Slice Wallet App Permission Request v1")
)
const appPermissionRootAuthorizationDomain = keccak256(
  stringToHex("Slice Wallet App Permission Root Authorization v1")
)
const appPermissionRegistrationDomain = keccak256(
  stringToHex("Slice Wallet App Permission P256 Registration v1")
)
const appPermissionIdentityAbi = [
  { name: "domain", type: "bytes32" },
  { name: "originHash", type: "bytes32" },
  { name: "account", type: "address" },
  { name: "accountIndex", type: "uint8" },
  { name: "chainId", type: "uint256" },
  { name: "signerId", type: "address" },
  { name: "publicKeyHash", type: "bytes32" },
  { name: "permissionId", type: "bytes4" },
  { name: "policyHash", type: "bytes32" }
] as const

const normalizeAppPermissionOrigin = (value: string) => {
  const url = new URL(value)
  const isLoopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  if (
    (url.protocol !== "https:" && !isLoopback) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Application permission origin is invalid.")
  }
  return url.origin
}

const appPermissionFixedHex = (value: Hex, size: number, label: string) => {
  if (
    !isHex(value, { strict: true }) ||
    value !== value.toLowerCase() ||
    value.length !== 2 + size * 2
  ) {
    throw new Error(`${label} must be canonical ${size}-byte hex.`)
  }
  return value
}

const appPermissionIdentityEncoding = ({
  accountAddress,
  accountIndex,
  appOrigin,
  chainId,
  permissionId,
  policyHash,
  signerAddress,
  signerPublicKey
}: {
  accountAddress: Address
  accountIndex: number
  appOrigin: string
  chainId: number
  permissionId: Hex
  policyHash: Hex
  signerAddress: Address
  signerPublicKey: Hex
}) => {
  if (
    !isAddress(accountAddress) ||
    !isAddress(signerAddress) ||
    !Number.isSafeInteger(chainId) ||
    chainId <= 0
  ) {
    throw new Error("Application permission identity is invalid.")
  }
  const publicKey = appPermissionFixedHex(
    signerPublicKey,
    65,
    "Permission signer public key"
  )
  if (!publicKey.startsWith("0x04")) {
    throw new Error("Permission signer public key must be uncompressed.")
  }
  return [
    keccak256(stringToHex(normalizeAppPermissionOrigin(appOrigin))),
    accountAddress,
    assertSliceWalletAccountIndex(accountIndex),
    BigInt(chainId),
    signerAddress,
    keccak256(publicKey),
    appPermissionFixedHex(permissionId, 4, "Permission id"),
    appPermissionFixedHex(policyHash, 32, "Permission policy hash")
  ] as const
}

export const hashSliceWalletAppPermissionRequestFields = (
  identity: Parameters<typeof appPermissionIdentityEncoding>[0]
) =>
  keccak256(
    encodeAbiParameters(appPermissionIdentityAbi, [
      appPermissionRequestDomain,
      ...appPermissionIdentityEncoding(identity)
    ])
  )

const hashSliceWalletAppPermissionAuthorizationFields = (
  domain: Hex,
  input: Parameters<typeof appPermissionIdentityEncoding>[0] & {
    action: "register"
    challenge: Hex
    challengeExpiresAt: number
    requestHash: Hex
  }
) => {
  if (
    !Number.isSafeInteger(input.challengeExpiresAt) ||
    input.challengeExpiresAt <= 0
  ) {
    throw new Error("Application permission challenge expiry is invalid.")
  }
  const requestHash = appPermissionFixedHex(
    input.requestHash,
    32,
    "Permission request hash"
  )
  if (requestHash !== hashSliceWalletAppPermissionRequestFields(input)) {
    throw new Error("Application permission request hash does not match.")
  }
  return keccak256(
    encodeAbiParameters(
      [
        ...appPermissionIdentityAbi,
        { name: "actionHash", type: "bytes32" },
        { name: "requestHash", type: "bytes32" },
        { name: "challenge", type: "bytes32" },
        { name: "challengeExpiresAt", type: "uint48" }
      ],
      [
        domain,
        ...appPermissionIdentityEncoding(input),
        keccak256(stringToHex(input.action)),
        requestHash,
        appPermissionFixedHex(input.challenge, 32, "Permission challenge"),
        input.challengeExpiresAt
      ]
    )
  )
}

export const hashSliceWalletAppPermissionRootAuthorizationFields = (
  input: Parameters<typeof hashSliceWalletAppPermissionAuthorizationFields>[1]
) =>
  hashSliceWalletAppPermissionAuthorizationFields(
    appPermissionRootAuthorizationDomain,
    input
  )

export const hashSliceWalletAppPermissionRegistrationFields = (
  input: Parameters<typeof hashSliceWalletAppPermissionAuthorizationFields>[1]
) =>
  hashSliceWalletAppPermissionAuthorizationFields(
    appPermissionRegistrationDomain,
    input
  )

export const formatSliceWalletExecutionGrantMessage = ({
  appOrigin,
  expiresAt,
  nonce,
  scopes,
  session
}: {
  appOrigin: string
  expiresAt: number
  nonce: Hex
  scopes: readonly string[]
  session: SliceWalletFrameSession
}) => {
  if (expiresAt !== session.expiresAt) {
    throw new Error("Grant expiration does not match the stored session.")
  }
  const checkoutLines =
    session.grantKind === "checkout"
      ? (() => {
          if (session.checkout === undefined) {
            throw new Error("Checkout grant metadata is missing.")
          }
          return [
            `Policy Co-signer: ${session.checkout.coSignerAddress.toLowerCase()}`,
            `Allowance USD Micros: ${session.checkout.allowanceUsdMicros}`,
            `Budget Period Seconds: ${session.checkout.budgetPeriodSec ?? "one-time"}`
          ]
        })()
      : []
  const canonicalScopes = scopes.map(assertSliceWalletGrantScope)

  return [
    "Slice Wallet Execution Grant",
    "",
    "Authorize this origin to use the constrained wallet permission shown above.",
    "",
    "Version: 1",
    `Origin: ${new URL(appOrigin).origin}`,
    `Account: ${session.account.toLowerCase()}`,
    `Chain ID: ${session.chainId}`,
    `Grant Kind: ${session.grantKind}`,
    "Signer Scheme: p256",
    `Signer ID: ${session.signerId.toLowerCase()}`,
    `Public Key Hash: ${keccak256(session.publicKey)}`,
    `Permission ID: ${session.permissionId}`,
    `Policy Hash: ${getWalletPolicyHash(session.policy)}`,
    ...checkoutLines,
    `Scopes: ${[...new Set(canonicalScopes)].sort().join(",")}`,
    `Expires At: ${new Date(expiresAt * 1000).toISOString()}`,
    `Nonce: ${nonce}`
  ].join("\n")
}

const coSignDomain = keccak256(stringToHex("Slice Wallet Checkout Co-sign v1"))
const sessionRequestDomain = keccak256(
  stringToHex("Slice Wallet Execution Session Request v1")
)

export const hashSliceWalletSessionRequest = ({
  action,
  appOrigin,
  challenge,
  delegationId,
  expiresAt,
  session
}: {
  action:
    | "finalize_replacement"
    | "predecessor_descriptors"
    | "revoke"
    | "status"
  appOrigin: string
  challenge: Hex
  delegationId: string
  expiresAt: number
  session: SliceWalletFrameSession
}) =>
  keccak256(
    encodeAbiParameters(
      [
        { name: "domain", type: "bytes32" },
        { name: "action", type: "string" },
        { name: "origin", type: "string" },
        { name: "account", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "delegationId", type: "string" },
        { name: "signerId", type: "address" },
        { name: "permissionId", type: "bytes4" },
        { name: "challenge", type: "bytes32" },
        { name: "expiresAt", type: "uint48" }
      ],
      [
        sessionRequestDomain,
        action,
        new URL(appOrigin).origin,
        session.account,
        BigInt(session.chainId),
        delegationId,
        session.signerId,
        session.permissionId,
        challenge,
        expiresAt
      ]
    )
  )

export const hashSliceWalletCoSignRequest = ({
  accountNonce,
  appOrigin,
  challenge,
  challengeExpiresAt,
  challengeIssuedAt,
  delegationId,
  proposalHash,
  session,
  userOperationHash,
  validUntil,
  windowEndExclusive,
  windowId,
  windowStart
}: {
  accountNonce: bigint
  appOrigin: string
  challenge: Hex
  challengeExpiresAt: number
  challengeIssuedAt: number
  delegationId: string
  proposalHash: Hex
  session: SliceWalletFrameSession
  userOperationHash: Hex
  validUntil: number
  windowEndExclusive: number
  windowId: string
  windowStart: number
}) =>
  keccak256(
    encodeAbiParameters(
      [
        { name: "domain", type: "bytes32" },
        { name: "origin", type: "string" },
        { name: "account", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "delegationId", type: "string" },
        { name: "signerId", type: "address" },
        { name: "permissionId", type: "bytes4" },
        { name: "userOperationHash", type: "bytes32" },
        { name: "proposalHash", type: "bytes32" },
        { name: "challenge", type: "bytes32" },
        { name: "challengeIssuedAt", type: "uint48" },
        { name: "challengeExpiresAt", type: "uint48" },
        { name: "windowId", type: "string" },
        { name: "windowStart", type: "uint48" },
        { name: "windowEndExclusive", type: "uint48" },
        { name: "validUntil", type: "uint48" },
        { name: "accountNonce", type: "uint256" }
      ],
      [
        coSignDomain,
        new URL(appOrigin).origin,
        session.account,
        BigInt(session.chainId),
        delegationId,
        session.signerId,
        session.permissionId,
        userOperationHash,
        proposalHash,
        challenge,
        challengeIssuedAt,
        challengeExpiresAt,
        windowId,
        windowStart,
        windowEndExclusive,
        validUntil,
        accountNonce
      ]
    )
  )

export const getSliceWalletPolicyBytes = (session: SliceWalletFrameSession) =>
  encodeWalletPolicyDescriptor(session.policy)
