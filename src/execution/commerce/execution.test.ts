import { describe, expect, it } from "bun:test"
import {
  walletExecutionPermissionExecutionScope,
  walletExecutionPermissionStoreManagementScope
} from "@slicekit/delegation-contract"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../../p256Server"
import { getWalletPermissionId } from "../../policy"
import type { SliceWalletPermissionAuthorization } from "../../types/frame"
import {
  createSliceWalletCheckoutExecutionClient,
  createSliceWalletManagementExecutionClient
} from "./execution"
import {
  createSliceCheckoutPolicyDescriptor,
  createSliceStoreManagementPolicyDescriptor
} from "./policies"

const account = "0x1000000000000000000000000000000000000001" as Address
const coSigner = "0x2000000000000000000000000000000000000002" as Address
const token = "0x4000000000000000000000000000000000000004" as Address
const publicKey = `0x04${"11".repeat(64)}` as Hex
const rootCredential = {
  credentialIdHash: `0x${"55".repeat(32)}` as Hex,
  publicKey: `0x04${"66".repeat(64)}` as Hex
}
const signer = getSliceWalletP256SignerId(publicKey)
const now = Math.floor(Date.now() / 1_000)
const policy = createSliceCheckoutPolicyDescriptor({
  account,
  chainId: 8453,
  expiresAt: now + 3_600,
  startsAt: now - 1,
  tokenAddresses: [token]
})
const permissionId = getWalletPermissionId(policy, signer)
const authorization = {
  accountIndex: 3,
  appOrigin: "https://store.example",
  enableSignature: "0x01",
  executionGrant: {
    expiresAt: policy.validUntil,
    nonce: `0x${"22".repeat(32)}` as Hex,
    scopes: [walletExecutionPermissionExecutionScope],
    signerProof: `0x${"44".repeat(64)}` as Hex
  },
  rootCredential,
  session: {
    account,
    chainId: 8453,
    checkout: {
      allowanceUsdMicros: "100000000",
      coSignerAddress: coSigner
    },
    expiresAt: policy.validUntil,
    grantKind: "checkout",
    permissionId,
    policy,
    publicKey,
    signerId: signer
  }
} satisfies SliceWalletPermissionAuthorization

describe("Slice checkout execution client", () => {
  it("requests co-signer configuration for the selected chain", async () => {
    let requestUrl = ""
    const client = createSliceWalletCheckoutExecutionClient({
      apiUrl: "https://api.example",
      fetch: async (input) => {
        requestUrl = input.toString()
        return Response.json({ coSignerAddress: coSigner })
      }
    })

    await expect(client.getConfiguration(31337)).resolves.toEqual({
      coSignerAddress: coSigner
    })
    expect(new URL(requestUrl).searchParams.get("chainId")).toBe("31337")
  })

  it("serializes only ceremony-authorized grant fields", async () => {
    let requestBody = ""
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? "")
      return new Response(
        JSON.stringify({
          allowanceUsdMicros: "100000000",
          coSignerAddress: coSigner,
          delegationId: "delegation-1",
          expiresAt: new Date(policy.validUntil * 1_000).toISOString(),
          permissionId,
          previousSessions: [],
          requiresFinalization: false,
          signerAddress: signer
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    }
    const client = createSliceWalletCheckoutExecutionClient({
      apiUrl: "https://api.example",
      fetch: fetchImpl
    })

    await client.registerAuthorization(authorization)
    const body = JSON.parse(requestBody) as {
      accountAddress: Address
      accountIndex: number
      appOrigin: string
      enableSignature: Hex
      permissionId: Hex
      privateKey?: Hex
      rootCredentialIdHash: Hex
      rootPublicKey: Hex
      signerId: Address
      signerScheme: string
    }
    expect(body).toMatchObject({
      accountAddress: account,
      accountIndex: 3,
      appOrigin: "https://store.example",
      enableSignature: "0x01",
      permissionId,
      rootCredentialIdHash: rootCredential.credentialIdHash,
      rootPublicKey: rootCredential.publicKey,
      signerId: signer,
      signerScheme: "p256"
    })
    expect(body.privateKey).toBeUndefined()
  })

  it("uses challenge-bound proof routes and hex-serializes user operations", async () => {
    const bodies: string[] = []
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.endsWith("/challenge")) {
        return Response.json({
          challenge: `0x${"55".repeat(32)}`,
          challengeExpiresAt: now + 120,
          challengeIssuedAt: now,
          validUntil: now + 120,
          windowEndExclusive: now + 86_400,
          windowId: "lifetime",
          windowStart: now - 100
        })
      }
      bodies.push(String(init?.body ?? ""))
      return Response.json({
        coSignature: `0x${"66".repeat(65)}`,
        proposalHash: `0x${"77".repeat(32)}`,
        remainingUsdMicros: "99000000",
        userOperationHash: `0x${"88".repeat(32)}`,
        validUntil: now + 120
      })
    }
    const client = createSliceWalletCheckoutExecutionClient({
      apiUrl: "https://api.example",
      fetch: fetchImpl
    })
    const challenge = await client.createChallenge("delegation-1")
    await client.coSign({
      ...challenge,
      delegationId: "delegation-1",
      proofSignature: `0x${"99".repeat(64)}`,
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
    })

    const body = JSON.parse(bodies[0] ?? "") as {
      challengeExpiresAt: number
      userOperation: { nonce: string }
      windowId: string
    }
    expect(body.challengeExpiresAt).toBe(now + 120)
    expect(body.userOperation.nonce).toBe("0x3")
    expect(body.windowId).toBe("lifetime")
  })

  it("surfaces a non-final replacement so the caller can renew its proof", async () => {
    const client = createSliceWalletCheckoutExecutionClient({
      apiUrl: "https://api.example",
      fetch: async () =>
        Response.json({ error: "revocation_not_final" }, { status: 409 })
    })
    await expect(
      client.finalizeReplacement({
        challenge: `0x${"55".repeat(32)}`,
        delegationId: "delegation-1",
        expectedDisableCallHash: `0x${"66".repeat(32)}`,
        expiresAt: now + 120,
        proofSignature: `0x${"77".repeat(64)}`,
        userOperationHash: `0x${"88".repeat(32)}`
      })
    ).rejects.toMatchObject({ code: "revocation_not_final", status: 409 })
  })
})

describe("Slice management execution client", () => {
  it("forwards only the root-authorized account-wide P-256 grant", async () => {
    const managementPolicy = createSliceStoreManagementPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: now + 3_600,
      sessionSignerAddress: signer,
      startsAt: now - 1
    })
    const managementPermissionId = getWalletPermissionId(
      managementPolicy,
      signer
    )
    const managementAuthorization = {
      accountIndex: 2,
      appOrigin: "https://dashboard.example",
      enableSignature: "0x01",
      executionGrant: {
        expiresAt: managementPolicy.validUntil,
        nonce: `0x${"22".repeat(32)}` as Hex,
        scopes: [walletExecutionPermissionStoreManagementScope],
        signerProof: `0x${"44".repeat(64)}` as Hex
      },
      rootCredential,
      session: {
        account,
        chainId: 8453,
        expiresAt: managementPolicy.validUntil,
        grantKind: "management",
        permissionId: managementPermissionId,
        policy: managementPolicy,
        publicKey,
        signerId: signer
      }
    } satisfies SliceWalletPermissionAuthorization
    let requestBody = ""
    const client = createSliceWalletManagementExecutionClient({
      apiUrl: "https://api.example",
      fetch: async (_input, init) => {
        requestBody = String(init?.body ?? "")
        return Response.json({
          delegationId: "management-1",
          expiresAt: new Date(
            managementPolicy.validUntil * 1_000
          ).toISOString(),
          permissionId: managementPermissionId,
          previousSessions: [],
          requiresFinalization: false,
          signerAddress: signer
        })
      }
    })
    await client.registerAuthorization(managementAuthorization)
    const body = JSON.parse(requestBody) as {
      accountIndex: number
      enableSignature: Hex
      grantKind: string
      privateKey?: string
      rootCredentialIdHash: Hex
      rootPublicKey: Hex
      signerScheme: string
    }
    expect(body).toMatchObject({
      accountIndex: 2,
      grantKind: "management",
      enableSignature: "0x01",
      rootCredentialIdHash: rootCredential.credentialIdHash,
      rootPublicKey: rootCredential.publicKey,
      signerScheme: "p256"
    })
    expect("slicerId" in body).toBe(false)
    expect("slicerAddress" in body).toBe(false)
    expect(body.privateKey).toBeUndefined()
  })
})
