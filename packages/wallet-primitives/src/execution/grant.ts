import { type Address, type Hex, stringToBytes } from "viem"
import {
  walletExecutionPermissionExecutionScope,
  walletExecutionPermissionStoreManagementScope
} from "../executionPermission"
import {
  formatSliceWalletExecutionGrantMessage,
  hashSliceWalletCoSignRequest,
  hashSliceWalletSessionRequest
} from "../frame/messages"
import {
  getSliceWalletP256SignerId,
  hashSliceWalletWeightedP256Proposal,
  verifySliceWalletP256
} from "../p256Server"
import {
  getWalletPermissionId,
  parseSerializedWalletPolicyDescriptor,
  serializeWalletPolicyDescriptor
} from "../policy"
import type { SliceWalletFrameSession } from "../types/frame"
import type { WalletPolicyDescriptor } from "../types/policy"
import { parseWalletAllowanceUsdMicros } from "./allowance"
import {
  assertSliceCheckoutPolicyDescriptor,
  assertSliceStoreManagementPolicyDescriptor
} from "./commerce/policies"

type SliceWalletExecutionGrantKind = "checkout" | "management"

export const resolveSliceWalletExecutionPolicy = ({
  grantKind,
  serializedPolicy
}: {
  grantKind: SliceWalletExecutionGrantKind
  serializedPolicy: Parameters<typeof parseSerializedWalletPolicyDescriptor>[0]
}) => {
  const parsed = parseSerializedWalletPolicyDescriptor(serializedPolicy)
  if (grantKind === "checkout") {
    return assertSliceCheckoutPolicyDescriptor(parsed)
  }
  return assertSliceStoreManagementPolicyDescriptor(parsed)
}

const resolveSliceWalletExecutionIdentity = ({
  policy,
  publicKey
}: {
  policy: WalletPolicyDescriptor
  publicKey: Hex
}) => {
  const signerId = getSliceWalletP256SignerId(publicKey)
  return {
    permissionId: getWalletPermissionId(policy, signerId),
    signerId
  }
}

const createSliceWalletExecutionSession = ({
  account,
  chainId,
  checkout,
  expiresAt,
  grantKind,
  policy,
  publicKey
}: {
  account: Address
  chainId: number
  checkout?: SliceWalletFrameSession["checkout"]
  expiresAt: number
  grantKind: SliceWalletExecutionGrantKind
  policy: WalletPolicyDescriptor
  publicKey: Hex
}): SliceWalletFrameSession => {
  const normalizedCheckout =
    checkout === undefined
      ? undefined
      : {
          ...checkout,
          allowanceUsdMicros: parseWalletAllowanceUsdMicros(
            checkout.allowanceUsdMicros
          )
        }
  const { permissionId, signerId } = resolveSliceWalletExecutionIdentity({
    policy,
    publicKey
  })
  return {
    account,
    chainId,
    ...(normalizedCheckout === undefined
      ? {}
      : { checkout: normalizedCheckout }),
    expiresAt,
    grantKind,
    permissionId,
    policy,
    publicKey,
    signerId
  }
}

export const prepareSliceWalletExecutionGrant = ({
  account,
  appOrigin,
  chainId,
  checkout,
  expiresAt,
  grantKind,
  nonce,
  policy,
  publicKey
}: {
  account: Address
  appOrigin: string
  chainId: number
  checkout?: SliceWalletFrameSession["checkout"]
  expiresAt: number
  grantKind: SliceWalletExecutionGrantKind
  nonce: Hex
  policy: WalletPolicyDescriptor
  publicKey: Hex
}) => {
  if ((grantKind === "checkout") !== (checkout !== undefined)) {
    throw new Error("Checkout grants require checkout metadata.")
  }
  const session = createSliceWalletExecutionSession({
    account,
    chainId,
    ...(checkout === undefined ? {} : { checkout }),
    expiresAt,
    grantKind,
    policy,
    publicKey
  })
  return {
    message: formatSliceWalletExecutionGrantMessage({
      appOrigin,
      expiresAt,
      nonce,
      scopes: [
        grantKind === "checkout"
          ? walletExecutionPermissionExecutionScope
          : walletExecutionPermissionStoreManagementScope
      ],
      session
    }),
    serializedPolicy: serializeWalletPolicyDescriptor(policy),
    session
  }
}

export const verifySliceWalletExecutionP256Proof = ({
  message,
  publicKey,
  signature
}: {
  message: Uint8Array | string
  publicKey: Hex
  signature: Hex
}) =>
  verifySliceWalletP256({
    message: typeof message === "string" ? stringToBytes(message) : message,
    publicKey,
    signature
  })

export const getSliceWalletExecutionCoSignProofHashes = ({
  accountNonce,
  appOrigin,
  callData,
  challenge,
  challengeExpiresAt,
  challengeIssuedAt,
  delegationId,
  session,
  validUntil,
  windowEndExclusive,
  windowId,
  windowStart,
  userOperationHash
}: {
  accountNonce: bigint
  appOrigin: string
  callData: Hex
  challenge: Hex
  challengeExpiresAt: number
  challengeIssuedAt: number
  delegationId: string
  session: SliceWalletFrameSession
  validUntil: number
  windowEndExclusive: number
  windowId: string
  windowStart: number
  userOperationHash: Hex
}) => {
  const proposalHash = hashSliceWalletWeightedP256Proposal({
    account: session.account,
    callData,
    chainId: session.chainId,
    nonce: accountNonce,
    permissionId: session.permissionId,
    validUntil
  })
  return {
    proofDigest: hashSliceWalletCoSignRequest({
      accountNonce,
      appOrigin,
      challenge,
      challengeExpiresAt,
      challengeIssuedAt,
      delegationId,
      proposalHash,
      session,
      validUntil,
      windowEndExclusive,
      windowId,
      windowStart,
      userOperationHash
    }),
    proposalHash
  }
}

export const getSliceWalletExecutionSessionProofHash = ({
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
  hashSliceWalletSessionRequest({
    action,
    appOrigin,
    challenge,
    delegationId,
    expiresAt,
    session
  })

export const resolveStoredSliceWalletCheckoutSession = ({
  account,
  allowanceUsdMicros,
  budgetPeriodSec,
  chainId,
  coSignerAddress,
  expiresAt,
  permissionId,
  publicKey,
  serializedPolicy,
  signerId
}: {
  account: Address
  allowanceUsdMicros: string
  budgetPeriodSec?: number
  chainId: number
  coSignerAddress: Address
  expiresAt: number
  permissionId: Hex
  publicKey: Hex
  serializedPolicy: Parameters<typeof parseSerializedWalletPolicyDescriptor>[0]
  signerId: Address
}): SliceWalletFrameSession | null => {
  try {
    const policy = resolveSliceWalletExecutionPolicy({
      grantKind: "checkout",
      serializedPolicy
    })
    const session = createSliceWalletExecutionSession({
      account,
      chainId,
      checkout: {
        allowanceUsdMicros,
        ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
        coSignerAddress
      },
      expiresAt,
      grantKind: "checkout",
      policy,
      publicKey
    })
    if (
      session.signerId.toLowerCase() !== signerId.toLowerCase() ||
      session.permissionId.toLowerCase() !== permissionId.toLowerCase()
    ) {
      return null
    }
    return session
  } catch {
    return null
  }
}
