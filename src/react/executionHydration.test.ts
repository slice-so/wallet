import { describe, expect, test } from "bun:test"
import type {
  SliceWalletFrameSession,
  SliceWalletSignerFrameClient
} from "../types/frame"
import type { StoredSliceWalletExecutionSession } from "../types/react"
import { hydrateStoredManagementExecutionSession } from "./managementHydration"
import { createManagementLifecycle } from "./managementLifecycle"

const account = "0x0000000000000000000000000000000000000001" as const
const stored = {
  accountAddress: account,
  delegationId: "delegation",
  enableSignature: "0x12",
  expiresAt: "2099-01-01T00:00:00.000Z",
  kind: "store_management",
  permissionId:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  signerAddress: "0x0000000000000000000000000000000000000002",
  slicerAddress: "0x0000000000000000000000000000000000000003",
  slicerId: 7
} satisfies StoredSliceWalletExecutionSession
const frameSession = {
  account,
  chainId: 8453,
  expiresAt: 4_070_908_800,
  grantKind: "management",
  permissionId: stored.permissionId,
  policy: {
    account,
    calls: [],
    chainId: 8453,
    grantKind: "management",
    validAfter: 0,
    validUntil: 4_070_908_800,
    version: 1
  },
  publicKey: "0x1234",
  signerId: stored.signerAddress
} satisfies SliceWalletFrameSession

const createControl = () => {
  const lifecycle = createManagementLifecycle({
    chainId: 8453,
    hydrate: async () => undefined,
    onIdentityChange: () => undefined
  })
  lifecycle.setAccount(account)
  return lifecycle
}

describe("management execution hydration", () => {
  test("keeps stored state and exposes a retryable delegation-fetch failure", async () => {
    let cleared = 0
    let frameRequests = 0
    let sessionClears = 0
    const lifecycle = createControl()
    const frameClient = {
      destroy: () => undefined,
      request: async () => {
        frameRequests += 1
        return null
      }
    } as SliceWalletSignerFrameClient

    await lifecycle.runHydration(account, (control) =>
      hydrateStoredManagementExecutionSession({
        account,
        activate: async () => undefined,
        chainId: 8453,
        clearStoredSession: async () => {
          cleared += 1
        },
        control,
        fetchDelegation: async () => {
          throw new Error("offline")
        },
        getFrameClient: async () => frameClient,
        readStoredSession: async () => ({ status: "found", value: stored }),
        setSessionNull: () => {
          sessionClears += 1
        }
      })
    )

    expect(cleared).toBe(0)
    expect(frameRequests).toBe(1)
    expect(sessionClears).toBe(1)
    expect(lifecycle.getSnapshot()).toEqual({
      error: "transport-unavailable",
      status: "settled"
    })
  })

  test("cleans an authoritative mismatch and exposes the repair outcome", async () => {
    let cleared = 0
    let frameRequests = 0
    const lifecycle = createControl()
    const frameClient = {
      destroy: () => undefined,
      request: async () => {
        frameRequests += 1
        return frameSession
      }
    } as SliceWalletSignerFrameClient

    await lifecycle.runHydration(account, (control) =>
      hydrateStoredManagementExecutionSession({
        account,
        activate: async () => undefined,
        chainId: 8453,
        clearStoredSession: async () => {
          cleared += 1
        },
        control,
        fetchDelegation: async () => ({
          delegation: {
            appOrigin: "https://example.com",
            delegationId: "delegation",
            expiresAt: "2099-01-01T00:00:00.000Z",
            permissionId: stored.permissionId,
            signerAddress: stored.signerAddress,
            signerPublicKey: "0x1234",
            signerScheme: "p256",
            slicerId: 9,
            walletPolicy: {
              account,
              calls: [],
              chainId: 8453,
              grantKind: "management",
              validAfter: 0,
              validUntil: 1,
              version: 1
            }
          }
        }),
        getFrameClient: async () => frameClient,
        readStoredSession: async () => ({ status: "found", value: stored }),
        setSessionNull: () => undefined
      })
    )

    expect(cleared).toBe(1)
    expect(frameRequests).toBe(2)
    expect(lifecycle.getSnapshot()).toEqual({
      error: "session-invalid",
      status: "settled"
    })
  })

  test("reports validity cleanup performed while reading stored state", async () => {
    const lifecycle = createControl()

    await lifecycle.runHydration(account, (control) =>
      hydrateStoredManagementExecutionSession({
        account,
        activate: async () => undefined,
        chainId: 8453,
        control,
        fetchDelegation: async () => ({ delegation: null }),
        getFrameClient: async () =>
          ({
            destroy: () => undefined,
            request: async () => null
          }) as SliceWalletSignerFrameClient,
        readStoredSession: async () => ({ status: "invalid" }),
        setSessionNull: () => undefined
      })
    )

    expect(lifecycle.getSnapshot()).toEqual({
      error: "session-invalid",
      status: "settled"
    })
  })
})
