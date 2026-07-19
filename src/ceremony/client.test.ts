import { describe, expect, it, mock } from "bun:test"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../p256Server"
import { createErc20ApproveCallRule, getWalletPermissionId } from "../policy"
import type {
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue
} from "../types"
import { createSliceWalletCeremonyBroker } from "./broker"
import {
  authorizeSliceWalletSession,
  authorizeSliceWalletSessions
} from "./client"

const account = "0x1000000000000000000000000000000000000001" as Address
const coSigner = "0x2000000000000000000000000000000000000002" as Address
const token = "0x3000000000000000000000000000000000000003" as Address
const spender = "0x4000000000000000000000000000000000000004" as Address
const publicKey = `0x04${"11".repeat(64)}` as Hex
const signerId = getSliceWalletP256SignerId(publicKey)
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
    nonce: `0x${"22".repeat(32)}` as Hex,
    scopes: ["wallet_execution"],
    signerProof: `0x${"33".repeat(64)}` as Hex
  },
  rootCredential: {
    credentialIdHash: `0x${"44".repeat(32)}` as Hex,
    publicKey: `0x04${"55".repeat(64)}` as Hex
  },
  session
} as const satisfies SliceWalletPermissionAuthorization

const createPopupWindow = ({
  responseForAttempt = () => ({
    authorization,
    type: "slice-wallet:ceremony-authorization" as const
  })
}: {
  responseForAttempt?: (attempt: number) =>
    | {
        authorization: SliceWalletPermissionAuthorization
        type: "slice-wallet:ceremony-authorization"
      }
    | {
        authorizations: readonly SliceWalletPermissionAuthorization[]
        type: "slice-wallet:ceremony-authorizations"
      }
    | {
        reason: "visibility_unstable"
        type: "slice-wallet:popup-required"
      }
} = {}) => {
  const close = mock(() => undefined)
  let attempt = 0
  const popup = Object.assign(new MessageChannel().port1, {
    close,
    postMessage: ((
      message: SliceWalletProtocolValue,
      _targetOrigin: string,
      transfer?: readonly Transferable[]
    ) => {
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message)
      ) {
        throw new Error("Ceremony connect message is invalid.")
      }
      const input = message as {
        readonly [key: string]: SliceWalletProtocolValue
      }
      const port = transfer?.[0]
      if (typeof input.nonce !== "string" || !(port instanceof MessagePort)) {
        throw new Error("Ceremony connect channel is invalid.")
      }
      attempt += 1
      setTimeout(
        () =>
          port.postMessage({
            nonce: input.nonce,
            ...responseForAttempt(attempt),
            version: 1
          }),
        20
      )
    }) as Window["postMessage"]
  })
  let onMessage:
    | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
    | null = null
  const window = Object.assign(Object.create(null) as Window, {
    addEventListener: (_type: "message", listener: typeof onMessage) => {
      onMessage = listener
    },
    crypto: globalThis.crypto,
    isSecureContext: true,
    location: {
      hostname: "shop.example",
      origin: "https://shop.example",
      protocol: "https:"
    },
    navigator: {
      userActivation: { isActive: true },
      userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36"
    },
    open: mock(() => popup),
    removeEventListener: (_type: "message", listener: typeof onMessage) => {
      if (onMessage === listener) onMessage = null
    }
  })
  return { close, popup, ready: () => onMessage, window }
}

const waitForPendingCeremony = async (
  broker: ReturnType<typeof createSliceWalletCeremonyBroker>
) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (broker.getPending() !== null) return
    await Bun.sleep(1)
  }
  throw new Error("The ceremony was not deferred.")
}

describe("authorizeSliceWalletSession", () => {
  it("keeps the consent timeout separate from popup readiness", async () => {
    const harness = createPopupWindow()
    const resultPromise = authorizeSliceWalletSession({
      idOrigin: "https://id.slice.so",
      popupReadyTimeoutMs: 5,
      session,
      timeoutMs: 100,
      window: harness.window
    })
    queueMicrotask(() => {
      harness.ready()?.(
        new MessageEvent("message", {
          data: { type: "slice-wallet:ceremony-ready", version: 1 },
          origin: "https://id.slice.so",
          source: harness.popup
        })
      )
    })
    await expect(resultPromise).resolves.toEqual(authorization)
    expect(harness.close).toHaveBeenCalledTimes(1)
  })

  it("defers an activation-expired grant and resumes the exact session", async () => {
    const broker = createSliceWalletCeremonyBroker()
    const harness = createPopupWindow()
    harness.window.navigator.userActivation = {
      hasBeenActive: true,
      isActive: false
    }

    const original = authorizeSliceWalletSession({
      ceremonyBroker: broker,
      idOrigin: "https://id.slice.so",
      session,
      timeoutMs: 100,
      window: harness.window
    })
    await waitForPendingCeremony(broker)
    expect(broker.getPending()).toMatchObject({
      kind: "grant",
      reason: "user_activation_expired"
    })

    const continuation = broker.continueInPopup()
    queueMicrotask(() => {
      harness.ready()?.(
        new MessageEvent("message", {
          data: { type: "slice-wallet:ceremony-ready", version: 1 },
          origin: "https://id.slice.so",
          source: harness.popup
        })
      )
    })

    await expect(continuation).resolves.toEqual(authorization)
    await expect(original).resolves.toEqual(authorization)
  })

  it("treats popup_required as terminal for the dialog and resumes in a popup", async () => {
    const broker = createSliceWalletCeremonyBroker()
    const harness = createPopupWindow({
      responseForAttempt: (attempt) =>
        attempt === 1
          ? {
              reason: "visibility_unstable",
              type: "slice-wallet:popup-required"
            }
          : {
              authorization,
              type: "slice-wallet:ceremony-authorization"
            }
    })
    const original = authorizeSliceWalletSession({
      ceremonyBroker: broker,
      idOrigin: "https://id.slice.so",
      session,
      timeoutMs: 100,
      window: harness.window
    })
    queueMicrotask(() => {
      harness.ready()?.(
        new MessageEvent("message", {
          data: { type: "slice-wallet:ceremony-ready", version: 1 },
          origin: "https://id.slice.so",
          source: harness.popup
        })
      )
    })
    await waitForPendingCeremony(broker)
    expect(broker.getPending()).toMatchObject({
      kind: "grant",
      reason: "visibility_unstable"
    })

    const continuation = broker.continueInPopup()
    queueMicrotask(() => {
      harness.ready()?.(
        new MessageEvent("message", {
          data: { type: "slice-wallet:ceremony-ready", version: 1 },
          origin: "https://id.slice.so",
          source: harness.popup
        })
      )
    })

    await expect(continuation).resolves.toEqual(authorization)
    await expect(original).resolves.toEqual(authorization)
    expect(harness.close).toHaveBeenCalledTimes(2)
  })

  it("rejects a multichain batch whose policy differs", async () => {
    const secondPublicKey = `0x04${"66".repeat(64)}` as Hex
    const secondSignerId = getSliceWalletP256SignerId(secondPublicKey)
    const secondPolicy = {
      ...policy,
      calls: [
        createErc20ApproveCallRule({ maximumAmount: 1_000n, spender, token })
      ],
      chainId: 10
    } as const
    await expect(
      authorizeSliceWalletSessions({
        idOrigin: "https://id.slice.so",
        sessions: [
          session,
          {
            ...session,
            chainId: 10,
            permissionId: getWalletPermissionId(secondPolicy, secondSignerId),
            policy: secondPolicy,
            publicKey: secondPublicKey,
            signerId: secondSignerId
          }
        ],
        window: harnesslessWindow
      })
    ).rejects.toThrow("same policy")
  })

  it("forces direct broker-less batch iframe requests into a popup", async () => {
    const harness = createPopupWindow({
      responseForAttempt: () => ({
        authorizations: [authorization],
        type: "slice-wallet:ceremony-authorizations"
      })
    })
    const result = authorizeSliceWalletSessions({
      ceremonyMode: "iframe",
      document: Object.create(null) as Document,
      idOrigin: "https://id.slice.so",
      sessions: [session],
      timeoutMs: 100,
      window: harness.window
    })
    queueMicrotask(() => {
      harness.ready()?.(
        new MessageEvent("message", {
          data: { type: "slice-wallet:ceremony-ready", version: 1 },
          origin: "https://id.slice.so",
          source: harness.popup
        })
      )
    })

    await expect(result).resolves.toEqual([authorization])
    expect(harness.window.open).toHaveBeenCalledTimes(1)
  })
})

const harnesslessWindow = Object.assign(Object.create(null) as Window, {
  crypto: globalThis.crypto,
  location: { origin: "https://shop.example" },
  navigator: { userActivation: { isActive: false } },
  open: () => null
})
