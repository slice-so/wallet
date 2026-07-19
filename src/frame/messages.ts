import { encodeAbiParameters, type Hex, keccak256, stringToHex } from "viem"
import { encodeWalletPolicyDescriptor, getWalletPolicyHash } from "../policy"
import type { SliceWalletFrameSession } from "../types/frame"

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
    `Scopes: ${[...new Set(scopes)].sort().join(",")}`,
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
  delegationId,
  expiresAt,
  proposalHash,
  session,
  userOperationHash
}: {
  accountNonce: bigint
  appOrigin: string
  challenge: Hex
  delegationId: string
  expiresAt: number
  proposalHash: Hex
  session: SliceWalletFrameSession
  userOperationHash: Hex
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
        { name: "accountNonce", type: "uint256" },
        { name: "expiresAt", type: "uint48" }
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
        accountNonce,
        expiresAt
      ]
    )
  )

export const getSliceWalletPolicyBytes = (session: SliceWalletFrameSession) =>
  encodeWalletPolicyDescriptor(session.policy)
