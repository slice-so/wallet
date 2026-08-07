import { describe, expect, test } from "bun:test"
import { createSliceStoreManagementPolicyDescriptor } from "../execution"
import { generateSliceWalletP256KeyPair } from "../p256"
import {
  getWalletPermissionId,
  serializeWalletPolicyDescriptor
} from "../policy"
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
  signerAddress: "0x0000000000000000000000000000000000000002"
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
  test("marks a missing local session invalid when its p256 delegation is active", async () => {
    let cleared = 0
    let frameClients = 0
    let sessionClears = 0
    const lifecycle = createControl()

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
            signerPublicKey: null,
            signerScheme: "p256",
            walletPolicy: null
          }
        }),
        getFrameClient: async () => {
          frameClients += 1
          throw new Error("not expected")
        },
        readStoredSession: async () => ({ status: "missing" }),
        setSessionNull: () => {
          sessionClears += 1
        }
      })
    )

    expect(cleared).toBe(0)
    expect(frameClients).toBe(0)
    expect(sessionClears).toBe(1)
    expect(lifecycle.getSnapshot()).toEqual({
      error: "session-invalid",
      status: "settled"
    })
  })

  test("settles a missing local session cleanly without a delegation", async () => {
    let cleared = 0
    let sessionClears = 0
    const lifecycle = createControl()

    await lifecycle.runHydration(account, (control) =>
      hydrateStoredManagementExecutionSession({
        account,
        activate: async () => undefined,
        chainId: 8453,
        clearStoredSession: async () => {
          cleared += 1
        },
        control,
        fetchDelegation: async () => ({ delegation: null }),
        getFrameClient: async () => {
          throw new Error("not expected")
        },
        readStoredSession: async () => ({ status: "missing" }),
        setSessionNull: () => {
          sessionClears += 1
        }
      })
    )

    expect(cleared).toBe(0)
    expect(sessionClears).toBe(1)
    expect(lifecycle.getSnapshot()).toEqual({
      error: null,
      status: "settled"
    })
  })

  test("settles a missing local session cleanly when delegation lookup fails", async () => {
    let cleared = 0
    let sessionClears = 0
    const lifecycle = createControl()

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
        getFrameClient: async () => {
          throw new Error("not expected")
        },
        readStoredSession: async () => ({ status: "missing" }),
        setSessionNull: () => {
          sessionClears += 1
        }
      })
    )

    expect(cleared).toBe(0)
    expect(sessionClears).toBe(1)
    expect(lifecycle.getSnapshot()).toEqual({
      error: null,
      status: "settled"
    })
  })

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

  test("settles an expired local session cleanly for root routing", async () => {
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
        readStoredSession: async () => ({
          reason: "expired",
          status: "invalid"
        }),
        setSessionNull: () => undefined
      })
    )

    expect(lifecycle.getSnapshot()).toEqual({
      error: null,
      status: "settled"
    })
  })

  test("clears a stored session cleanly when its delegation was revoked", async () => {
    let cleared = 0
    let frameClears = 0
    const lifecycle = createControl()
    const frameClient = {
      destroy: () => undefined,
      request: async (request) => {
        if (request.method === "clearSession") frameClears += 1
        return request.method === "getSession" ? frameSession : null
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
        fetchDelegation: async () => ({ delegation: null }),
        getFrameClient: async () => frameClient,
        readStoredSession: async () => ({ status: "found", value: stored }),
        setSessionNull: () => undefined
      })
    )

    expect(cleared).toBe(1)
    expect(frameClears).toBe(1)
    expect(lifecycle.getSnapshot()).toEqual({
      error: null,
      status: "settled"
    })
  })

  test("hydrates the account-wide stored management session", async () => {
    const keyPair = await generateSliceWalletP256KeyPair()
    const policy = createSliceStoreManagementPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 4_070_908_800,
      startsAt: 0
    })
    const session = {
      account,
      chainId: 8453,
      expiresAt: policy.validUntil,
      grantKind: "management",
      permissionId: getWalletPermissionId(policy, keyPair.signerId),
      policy,
      publicKey: keyPair.publicKeyHex,
      signerId: keyPair.signerId
    } satisfies SliceWalletFrameSession
    const storedSession = {
      accountAddress: account,
      delegationId: "delegation",
      enableSignature: "0x12",
      expiresAt: "2099-01-01T00:00:00.000Z",
      kind: "store_management",
      permissionId: session.permissionId,
      signerAddress: session.signerId
    } satisfies StoredSliceWalletExecutionSession
    let activated = false

    await hydrateStoredManagementExecutionSession({
      account,
      activate: async () => {
        activated = true
      },
      chainId: 8453,
      control: {
        assertCurrent: () => undefined,
        markError: () => undefined,
        markStorageUnavailable: () => undefined
      },
      fetchDelegation: async () => ({
        delegation: {
          appOrigin: "https://example.com",
          delegationId: storedSession.delegationId,
          expiresAt: storedSession.expiresAt,
          permissionId: session.permissionId,
          signerAddress: session.signerId,
          signerPublicKey: session.publicKey,
          signerScheme: "p256",
          walletPolicy: serializeWalletPolicyDescriptor(session.policy)
        }
      }),
      getFrameClient: async () =>
        ({
          destroy: () => undefined,
          request: async () => session
        }) as SliceWalletSignerFrameClient,
      readStoredSession: async () => ({
        status: "found",
        value: storedSession
      }),
      setSessionNull: () => undefined
    })

    expect(activated).toBe(true)
  })
})
