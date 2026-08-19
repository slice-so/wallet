import { describe, expect, it, mock } from "bun:test"
import type { SliceWalletProtocolValue } from "@slicekit/wallet-primitives/server"
import { createPublicClient, custom, type Hex, hashMessage } from "viem"
import { base } from "viem/chains"
import { createSliceWalletCeremonyBroker } from "./broker"
import { createSliceWalletCeremonyKernelAccount } from "./rootAccountClient"

const accountAddress = "0x1000000000000000000000000000000000000001" as const
const credential = {
  credentialIdHash: `0x${"11".repeat(32)}` as Hex,
  publicKey: `0x04${"22".repeat(64)}` as Hex
}
const ceremonySignature = `0x01${"33".repeat(20)}${"44".repeat(32)}` as Hex

const waitForPendingCeremony = async (
  broker: ReturnType<typeof createSliceWalletCeremonyBroker>
) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (broker.getPending() !== null) return
    await Bun.sleep(1)
  }
  throw new Error("The root ceremony was not deferred.")
}

describe("Slice wallet ceremony account", () => {
  it("returns an account message signature without wrapping it a second time", async () => {
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
        _message: SliceWalletProtocolValue,
        _targetOrigin: string,
        transfer: Transferable[]
      ) => {
        const port = transfer[0]
        if (!(port instanceof MessagePort)) {
          throw new Error("The ceremony channel is missing its message port.")
        }
        port.addEventListener(
          "message",
          (event: MessageEvent<SliceWalletProtocolValue>) => {
            const request = event.data as {
              nonce: Hex
              request: { message: string; purpose: "message" }
            }
            port.postMessage({
              hash: hashMessage(request.request.message),
              nonce: request.nonce,
              signature: ceremonySignature,
              type: "slice-wallet:root-signature",
              version: 1
            })
          },
          { once: true }
        )
        port.start()
      }
    })
    const window = Object.assign(Object.create(null) as Window, {
      addEventListener: ((
        _type: "message",
        listener: typeof onWindowMessage
      ) => {
        onWindowMessage = listener
      }) as Window["addEventListener"],
      crypto: globalThis.crypto,
      matchMedia: () => ({ matches: false }),
      navigator: { userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36" },
      open: mock(() => {
        queueMicrotask(() =>
          onWindowMessage?.(
            Object.assign(
              Object.create(null) as MessageEvent<SliceWalletProtocolValue>,
              {
                data: {
                  type: "slice-wallet:ceremony-ready",
                  version: 1
                },
                origin: "https://id.slice.so",
                source: popup
              }
            )
          )
        )
        return popup
      }),
      removeEventListener: ((
        _type: "message",
        listener: typeof onWindowMessage
      ) => {
        if (onWindowMessage === listener) onWindowMessage = null
      }) as Window["removeEventListener"]
    })
    const client = createPublicClient({
      chain: base,
      transport: custom({
        request: async ({ method }) => {
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })
    const account = await createSliceWalletCeremonyKernelAccount({
      address: accountAddress,
      chainId: base.id,
      client,
      credential,
      idOrigin: "https://id.slice.so",
      window
    })

    await expect(
      account.signMessage({ message: "Slice Wallet Delegation" })
    ).resolves.toBe(ceremonySignature)
  })

  it("forwards the broker, iframe mode, and document to the root signer", async () => {
    let onWindowMessage:
      | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
      | null = null
    const source = Object.assign(Object.create(null) as WindowProxy, {
      postMessage: (
        _message: SliceWalletProtocolValue,
        _targetOrigin: string,
        transfer: Transferable[]
      ) => {
        const port = transfer[0]
        if (!(port instanceof MessagePort)) {
          throw new Error("The ceremony channel is missing its message port.")
        }
        port.addEventListener(
          "message",
          (event: MessageEvent<SliceWalletProtocolValue>) => {
            const request = event.data as { nonce: Hex }
            port.postMessage({
              nonce: request.nonce,
              reason: "capability_unsupported",
              type: "slice-wallet:popup-required",
              version: 1
            })
          },
          { once: true }
        )
        port.start()
      }
    })
    const iframe = Object.assign(Object.create(null) as HTMLIFrameElement, {
      allow: "",
      contentWindow: source,
      referrerPolicy: "",
      sandbox: { add: () => undefined },
      src: "",
      style: {},
      title: ""
    })
    const dialog = Object.assign(Object.create(null) as HTMLDivElement, {
      appendChild: mock(() => iframe),
      dataset: {},
      remove: mock(() => undefined),
      setAttribute: mock(() => undefined),
      style: {}
    })
    const document = Object.assign(Object.create(null) as Document, {
      body: { appendChild: mock(() => dialog) },
      createElement: ((tagName: string) =>
        tagName === "iframe" ? iframe : dialog) as Document["createElement"]
    })
    const open = mock(() => null)
    const window = Object.assign(Object.create(null) as Window, {
      addEventListener: ((type: string, listener: EventListener) => {
        if (type === "message") {
          onWindowMessage = listener as (
            event: MessageEvent<SliceWalletProtocolValue>
          ) => void
        }
      }) as Window["addEventListener"],
      crypto: globalThis.crypto,
      isSecureContext: true,
      location: {
        hostname: "shop.slice.so",
        origin: "https://shop.slice.so",
        protocol: "https:"
      },
      navigator: {
        userActivation: { isActive: true },
        userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36"
      },
      open,
      removeEventListener: mock(() => undefined)
    })
    const broker = createSliceWalletCeremonyBroker()
    const client = createPublicClient({
      chain: base,
      transport: custom({
        request: async ({ method }) => {
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })
    const account = await createSliceWalletCeremonyKernelAccount({
      address: accountAddress,
      ceremonyBroker: broker,
      ceremonyMode: "iframe",
      chainId: base.id,
      client,
      credential,
      document,
      idOrigin: "https://id.slice.so",
      window
    })

    const signature = account.signMessage({ message: "Forward parameters" })
    queueMicrotask(() =>
      onWindowMessage?.(
        Object.assign(
          Object.create(null) as MessageEvent<SliceWalletProtocolValue>,
          {
            data: {
              type: "slice-wallet:ceremony-ready",
              version: 1
            },
            origin: "https://id.slice.so",
            source
          }
        )
      )
    )
    await waitForPendingCeremony(broker)

    expect(iframe.src).toContain("/dialog/root")
    expect(open).toHaveBeenCalledTimes(0)
    expect(broker.getPending()).toMatchObject({
      kind: "root_sign",
      reason: "capability_unsupported"
    })

    broker.cancel()
    await expect(signature).rejects.toThrow("cancelled")
  })
})
