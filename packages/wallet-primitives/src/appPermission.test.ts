import { describe, expect, test } from "bun:test"
import {
  hashSliceWalletAppPermissionFinalizeRevocationPayload,
  hashSliceWalletAppPermissionLifecycleRequest,
  hashSliceWalletAppPermissionLifecycleRootAuthorization,
  hashSliceWalletAppPermissionRegistration,
  hashSliceWalletAppPermissionRequest,
  normalizeSliceWalletAppOrigin,
  parseSliceWalletAppPermissionIdentity,
  parseSliceWalletAppPermissionRecord
} from "./appPermission"
import { getSliceWalletP256SignerId } from "./p256Server"
import {
  getWalletPermissionId,
  getWalletPolicyHash,
  serializeWalletPolicyDescriptor
} from "./policy"
import type {
  SliceWalletAppPermissionIdentity,
  SliceWalletAppPermissionJsonValue
} from "./types/appPermission"

const account = "0x1000000000000000000000000000000000000001" as const
const recipient = "0x2000000000000000000000000000000000000002" as const
const publicKey = `0x04${"11".repeat(64)}` as const
const signerAddress = getSliceWalletP256SignerId(publicKey)
const policyDescriptor = {
  account,
  calls: [
    {
      parameterRules: [],
      selector: "0x00000000" as const,
      target: recipient,
      valueLimit: 10n
    }
  ],
  chainId: 8453,
  grantKind: "generic" as const,
  rateLimit: { count: 1, intervalSec: 3_600 },
  validAfter: 1_800_000_000,
  validUntil: 1_800_003_600,
  version: 1 as const
}
const identity: SliceWalletAppPermissionIdentity = {
  accountAddress: account,
  accountIndex: 0,
  appOrigin: "https://xn--bcher-kva.example",
  chainId: 8453,
  permissionId: getWalletPermissionId(policyDescriptor, signerAddress),
  policy: {
    ...serializeWalletPolicyDescriptor(policyDescriptor),
    grantKind: "generic"
  },
  policyHash: getWalletPolicyHash(policyDescriptor),
  signerAddress,
  signerPublicKey: publicKey
}

describe("Slice wallet app-permission contract", () => {
  test("normalizes origins and recomputes every derived identity field", () => {
    expect(normalizeSliceWalletAppOrigin("https://bücher.example")).toBe(
      "https://xn--bcher-kva.example"
    )
    expect(
      parseSliceWalletAppPermissionIdentity(
        JSON.parse(
          JSON.stringify(identity)
        ) as SliceWalletAppPermissionJsonValue
      )
    ).toEqual(identity)

    expect(() =>
      parseSliceWalletAppPermissionIdentity({
        ...identity,
        permissionId: "0x00000000"
      } as SliceWalletAppPermissionJsonValue)
    ).toThrow("derived identity")
    expect(() =>
      parseSliceWalletAppPermissionIdentity({
        ...identity,
        displayOrigin: identity.appOrigin
      } as SliceWalletAppPermissionJsonValue)
    ).toThrow("unknown or missing")
    expect(
      parseSliceWalletAppPermissionRecord({
        ...identity,
        activatedAt: null,
        createdAt: new Date(policyDescriptor.validAfter * 1_000).toISOString(),
        expiresAt: new Date(policyDescriptor.validUntil * 1_000).toISOString(),
        id: "12345678-1234-1234-1234-123456789abc",
        revocationUserOperationHash: null,
        revokedAt: null,
        status: "authorized"
      })
    ).toMatchObject({ ...identity, status: "authorized" })
  })

  test("binds registration and lifecycle authorization to canonical requests", () => {
    const requestHash = hashSliceWalletAppPermissionRequest(identity)
    const registration = {
      ...identity,
      action: "register" as const,
      challenge: `0x${"22".repeat(32)}` as const,
      challengeExpiresAt: 1_800_000_120,
      requestHash
    }
    expect(hashSliceWalletAppPermissionRegistration(registration)).not.toBe(
      requestHash
    )
    expect(() =>
      hashSliceWalletAppPermissionRegistration({
        ...registration,
        requestHash: `0x${"00".repeat(32)}`
      })
    ).toThrow("request hash does not match")

    const payloadHash = hashSliceWalletAppPermissionFinalizeRevocationPayload({
      expectedDisableCallHash: `0x${"44".repeat(32)}`,
      permissionRowId: "permission-row",
      userOperationHash: `0x${"55".repeat(32)}`
    })
    const lifecycleRequestHash = hashSliceWalletAppPermissionLifecycleRequest({
      accountAddress: account,
      action: "finalize_revocation",
      chainId: 8453,
      payloadHash
    })
    expect(
      hashSliceWalletAppPermissionLifecycleRootAuthorization({
        accountAddress: account,
        action: "finalize_revocation",
        chainId: 8453,
        challenge: `0x${"33".repeat(32)}`,
        challengeExpiresAt: 1_800_000_120,
        payloadHash,
        requestHash: lifecycleRequestHash
      })
    ).not.toBe(lifecycleRequestHash)

    expect(payloadHash).not.toBe(lifecycleRequestHash)
  })
})
