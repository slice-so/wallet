import { describe, expect, it, mock } from "bun:test"
import { createPublicClient, custom, type Hex, hashMessage } from "viem"
import { base } from "viem/chains"
import type { SliceWalletProtocolValue } from "../types"
import { createSliceWalletCeremonyKernelAccount } from "./rootAccountClient"

const accountAddress = "0x1000000000000000000000000000000000000001" as const
const credential = {
  credentialIdHash: `0x${"11".repeat(32)}` as Hex,
  publicKey: `0x04${"22".repeat(64)}` as Hex
}
const ceremonySignature = `0x01${"33".repeat(20)}${"44".repeat(32)}` as Hex

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
})
