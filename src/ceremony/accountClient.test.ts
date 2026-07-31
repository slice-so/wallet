import { describe, expect, it, mock } from "bun:test"
import type { Hex } from "viem"
import type {
  SliceWalletCeremonySessionResult,
  SliceWalletProtocolValue
} from "../types"
import { connectSliceWalletAccount } from "./accountClient"

const account = "0x1111111111111111111111111111111111111111" as const
const credentialIdHash = `0x${"22".repeat(32)}` as const
const publicKey = `0x04${"33".repeat(64)}` as const

const createWindow = (
  respond: (
    message: SliceWalletProtocolValue,
    reply: (session: SliceWalletCeremonySessionResult) => void,
    reject: () => void
  ) => void
) => {
  let onWindowMessage:
    | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
    | null = null
  let closed = false
  const popup = Object.assign(Object.create(null) as WindowProxy, {
    close: mock(() => {
      closed = true
    }),
    get closed() {
      return closed
    },
    postMessage: (
      message: SliceWalletProtocolValue,
      _targetOrigin: string,
      transfer: Transferable[]
    ) => {
      const port = transfer[0]
      if (!(port instanceof MessagePort)) {
        throw new Error("The ceremony channel is missing its message port.")
      }
      const nonce = (message as { nonce: Hex }).nonce
      const reply = (session: SliceWalletCeremonySessionResult) =>
        port.postMessage({
          account,
          accountIndex: 0,
          credentialIdHash,
          nonce,
          session,
          type: "slice-wallet:ceremony-account",
          version: 1
        })
      const reject = () =>
        port.postMessage({
          code: "authorization_failed",
          message: "User rejected the request",
          nonce,
          type: "slice-wallet:ceremony-error",
          version: 1
        })
      port.addEventListener(
        "message",
        (event: MessageEvent<SliceWalletProtocolValue>) =>
          respond(event.data, reply, reject)
      )
      port.start()
    }
  })
  return Object.assign(Object.create(null) as Window, {
    addEventListener: (type: string, listener: EventListener) => {
      if (type === "message") {
        onWindowMessage = listener as (
          event: MessageEvent<SliceWalletProtocolValue>
        ) => void
      }
    },
    crypto: globalThis.crypto,
    matchMedia: () => ({ matches: false }),
    navigator: {
      userActivation: { isActive: true },
      userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36"
    },
    open: mock(() => {
      queueMicrotask(() =>
        onWindowMessage?.(
          Object.assign(
            Object.create(null) as MessageEvent<SliceWalletProtocolValue>,
            {
              data: { type: "slice-wallet:ceremony-ready", version: 1 },
              origin: "https://id.slice.so",
              source: popup
            }
          )
        )
      )
      return popup
    }),
    removeEventListener: (type: string, listener: EventListener) => {
      if (type === "message" && onWindowMessage === listener) {
        onWindowMessage = null
      }
    }
  })
}

const registryFetch = Object.assign(
  mock(
    (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
      Promise.resolve(
        Response.json({
          accountAddress: account,
          accountIndex: 0,
          createdAt: new Date().toISOString(),
          credentialIdHash,
          factoryVersion: "0.3.3",
          publicKey,
          recoveryPermissionId: null,
          recoverySignerAddress: null,
          registrationKind: "initial"
        })
      )
  ),
  { preconnect: globalThis.fetch.preconnect }
) satisfies typeof fetch

describe("Slice wallet account session coordination", () => {
  it("rejects cancellation without waiting for session preparation", async () => {
    const window = createWindow((message, _reply, reject) => {
      if (
        typeof message === "object" &&
        message !== null &&
        !Array.isArray(message) &&
        (message as { status?: string }).status === "preparing"
      ) {
        reject()
      }
    })

    const connection = connectSliceWalletAccount({
      chainId: 8453,
      fetch: registryFetch,
      idOrigin: "https://id.slice.so",
      session: {
        prepare: () => new Promise(() => undefined)
      },
      timeoutMs: 100,
      window
    })

    await expect(connection).rejects.toThrow("User rejected the request")
  })

  it("returns preparation_failed when preparation rejects", async () => {
    const window = createWindow((message, reply) => {
      if (
        typeof message === "object" &&
        message !== null &&
        !Array.isArray(message) &&
        (message as { status?: string }).status === "preparation_failed"
      ) {
        reply({ status: "preparation_failed" })
      }
    })

    const connected = await connectSliceWalletAccount({
      chainId: 8453,
      fetch: registryFetch,
      idOrigin: "https://id.slice.so",
      session: {
        prepare: async () => {
          throw new Error("nonce service unavailable")
        }
      },
      timeoutMs: 100,
      window
    })

    expect(connected.session).toEqual({ status: "preparation_failed" })
  })

  it("returns timed_out when consent preparation misses the coordinator window", async () => {
    let replied = false
    const window = createWindow((message, reply) => {
      if (
        !replied &&
        typeof message === "object" &&
        message !== null &&
        !Array.isArray(message) &&
        (message as { status?: string }).status === "preparing"
      ) {
        replied = true
        setTimeout(() => reply({ status: "timed_out" }), 5)
      }
    })

    const connected = await connectSliceWalletAccount({
      chainId: 8453,
      fetch: registryFetch,
      idOrigin: "https://id.slice.so",
      session: {
        prepare: async () => {
          await Bun.sleep(15)
          return {
            claims: {},
            nonce: "abcdefghijklmnop",
            pendingId: "pending",
            sessionSigner: "0x4444444444444444444444444444444444444444"
          }
        }
      },
      timeoutMs: 100,
      window
    })

    expect(connected.session).toEqual({ status: "timed_out" })
  })
})
