import { describe, expect, it } from "bun:test"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../p256Server"
import { createErc20ApproveCallRule, getWalletPermissionId } from "../policy"
import type { SliceWalletProtocolValue } from "../types"
import {
  parseSliceWalletBridgeRecord,
  parseSliceWalletCeremonyAccountResponse,
  parseSliceWalletCeremonyResponse,
  parseSliceWalletCeremonyRootSignRequest,
  parseSliceWalletPermissionAuthorization
} from "./protocol"

const account = "0x1000000000000000000000000000000000000001" as Address
const coSigner = "0x2000000000000000000000000000000000000002" as Address
const token = "0x3000000000000000000000000000000000000003" as Address
const spender = "0x4000000000000000000000000000000000000004" as Address
const publicKey = `0x04${"11".repeat(64)}` as Hex
const rootCredential = {
  credentialIdHash: `0x${"44".repeat(32)}` as Hex,
  publicKey: `0x04${"55".repeat(64)}` as Hex
}
const signerId = getSliceWalletP256SignerId(publicKey)
const nonce = `0x${"22".repeat(32)}` as Hex
const policy = {
  account,
  calls: [createErc20ApproveCallRule({ maximumAmount: 100n, spender, token })],
  chainId: 8453,
  grantKind: "checkout",
  validAfter: 100,
  validUntil: 200,
  version: 1
} as const
const session = {
  account,
  chainId: 8453,
  checkout: {
    allowanceUsdMicros: "100000000",
    coSignerAddress: coSigner
  },
  expiresAt: 200,
  grantKind: "checkout",
  permissionId: getWalletPermissionId(policy, signerId),
  policy,
  publicKey,
  signerId
} as const
const authorization = {
  appOrigin: "https://shop.example",
  enableSignature: "0x01",
  executionGrant: {
    expiresAt: 200,
    nonce,
    scopes: ["wallet_execution"],
    signerProof: `0x${"33".repeat(64)}`
  },
  rootCredential,
  session
} as const satisfies SliceWalletProtocolValue

const managementPolicy = {
  ...policy,
  grantKind: "management"
} as const
const managementSession = {
  account: session.account,
  chainId: session.chainId,
  expiresAt: session.expiresAt,
  grantKind: "management",
  permissionId: getWalletPermissionId(managementPolicy, signerId),
  policy: managementPolicy,
  publicKey: session.publicKey,
  signerId: session.signerId
} as const
const managementAuthorization = {
  ...authorization,
  executionGrant: {
    ...authorization.executionGrant,
    scopes: ["store_management"]
  },
  session: managementSession
} as const satisfies SliceWalletProtocolValue

describe("wallet ceremony protocol parser", () => {
  it("accepts a terminal account cancellation response", () => {
    expect(
      parseSliceWalletCeremonyAccountResponse({
        code: "authorization_failed",
        message: "User rejected the request",
        nonce,
        type: "slice-wallet:ceremony-error",
        version: 1
      })
    ).toMatchObject({
      code: "authorization_failed",
      type: "slice-wallet:ceremony-error"
    })
  })

  it("accepts a canonical checkout authorization", () => {
    expect(
      parseSliceWalletPermissionAuthorization(authorization)
    ).toMatchObject({
      appOrigin: "https://shop.example",
      session: { account, signerId }
    })
  })

  it("accepts a non-empty batch of per-chain authorizations", () => {
    expect(
      parseSliceWalletCeremonyResponse({
        authorizations: [authorization],
        nonce,
        type: "slice-wallet:ceremony-authorizations",
        version: 1
      })
    ).toMatchObject({
      authorizations: [{ session: { chainId: 8453 } }],
      type: "slice-wallet:ceremony-authorizations"
    })
    expect(() =>
      parseSliceWalletCeremonyResponse({
        authorizations: [],
        nonce,
        type: "slice-wallet:ceremony-authorizations",
        version: 1
      })
    ).toThrow("batch response")
  })

  it("requires an execution proof for management authorizations", () => {
    expect(
      parseSliceWalletPermissionAuthorization(managementAuthorization)
    ).toMatchObject({ session: { grantKind: "management" } })
    const { executionGrant: _executionGrant, ...withoutProof } =
      managementAuthorization
    expect(() => parseSliceWalletPermissionAuthorization(withoutProof)).toThrow(
      "does not match the wallet grant kind"
    )
  })

  it("rejects parent-controlled authority fields and inconsistent sessions", () => {
    expect(() =>
      parseSliceWalletPermissionAuthorization({
        ...authorization,
        privateKey: "0x01"
      })
    ).toThrow("unknown field")
    expect(() =>
      parseSliceWalletPermissionAuthorization({
        ...authorization,
        session: { ...session, permissionId: "0x12345678" }
      })
    ).toThrow("does not match its policy")
    expect(() =>
      parseSliceWalletPermissionAuthorization({
        appOrigin: authorization.appOrigin,
        enableSignature: authorization.enableSignature,
        rootCredential,
        session
      })
    ).toThrow("does not match the wallet grant kind")
  })

  it("rejects malformed bridge records without trusting nested data", () => {
    const challenge = {
      account,
      chainId: 8453,
      grantKind: "checkout",
      nonce,
      type: "slice-wallet:bridge-challenge",
      version: 1
    } as const
    expect(() => parseSliceWalletBridgeRecord(null, challenge)).toThrow(
      "must be an object"
    )
    expect(() =>
      parseSliceWalletBridgeRecord(
        {
          nonce,
          origin: "https://shop.example",
          session: { ...session, account: coSigner },
          type: "slice-wallet:bridge-record",
          version: 1
        },
        challenge
      )
    ).toThrow("does not match its policy")
    expect(() =>
      parseSliceWalletBridgeRecord(
        {
          nonce: `0x${"44".repeat(32)}`,
          origin: "https://shop.example",
          session,
          type: "slice-wallet:bridge-record",
          version: 1
        },
        challenge
      )
    ).toThrow("invalid")
    expect(() =>
      parseSliceWalletBridgeRecord(
        {
          nonce,
          origin: "https://shop.example/path",
          session,
          type: "slice-wallet:bridge-record",
          version: 1
        },
        challenge
      )
    ).toThrow("normalized origin")
  })

  it("accepts complete root requests and rejects parent-provided digests", () => {
    const request = {
      account,
      chainId: 8453,
      nonce,
      request: {
        purpose: "user_operation",
        userOperation: {
          callData: "0x1234",
          callGasLimit: 1n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
          nonce: 3n,
          preVerificationGas: 4n,
          sender: account,
          verificationGasLimit: 5n
        }
      },
      type: "slice-wallet:root-sign-request",
      version: 1
    } as const satisfies SliceWalletProtocolValue

    expect(parseSliceWalletCeremonyRootSignRequest(request)).toMatchObject({
      account,
      request: { purpose: "user_operation" }
    })
    expect(() =>
      parseSliceWalletCeremonyRootSignRequest({
        ...request,
        hash: nonce
      })
    ).toThrow("unknown field")
  })
})
