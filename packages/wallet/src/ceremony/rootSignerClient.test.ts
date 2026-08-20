import { describe, expect, it, mock } from "bun:test"
import type { Address, Hex } from "viem"
import type { SliceWalletProtocolValue } from "../protocol/index"
import type { SliceWalletRootSignatureRequest } from "../types"
import { createSliceWalletCeremonyBroker } from "./broker"
import { parseSliceWalletCeremonyRootSignRequest } from "./protocol"
import { createSliceWalletCeremonyRootSigner } from "./rootSignerClient"

const account = "0x7100000000000000000000000000000000000001" as Address
const expectedHash = `0x${"11".repeat(32)}` as Hex
const signature = `0x${"22".repeat(64)}` as Hex

describe("root signer ceremony continuation", () => {
  it("rejects a root user operation for a different account before opening a ceremony", async () => {
    const open = mock(() => null)
    const rootSigner = createSliceWalletCeremonyRootSigner({
      account,
      chainId: 8453,
      idOrigin: "https://id.slice.so",
      window: Object.assign(Object.create(null) as Window, {
        crypto: globalThis.crypto,
        open
      })
    })

    await expect(
      rootSigner(expectedHash, "user_operation", {
        purpose: "user_operation",
        userOperation: {
          callData: "0x",
          callGasLimit: 1n,
          maxFeePerGas: 2n,
          maxPriorityFeePerGas: 1n,
          nonce: 3n,
          preVerificationGas: 4n,
          sender: "0x7200000000000000000000000000000000000002",
          verificationGasLimit: 5n
        }
      })
    ).rejects.toThrow(
      "Root user operation sender does not match the wallet account."
    )
    expect(open).not.toHaveBeenCalled()
  })

  it("resumes with the exact prepared signing request after activation expires", async () => {
    const broker = createSliceWalletCeremonyBroker()
    const request = {
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
    } as const satisfies SliceWalletRootSignatureRequest
    let receivedRequest: SliceWalletRootSignatureRequest | undefined
    let onMessage:
      | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
      | null = null
    const popup = Object.assign(Object.create(null) as WindowProxy, {
      close: mock(() => undefined),
      closed: false,
      postMessage: (
        message: SliceWalletProtocolValue,
        _targetOrigin: string,
        transfer: Transferable[]
      ) => {
        if (
          typeof message !== "object" ||
          message === null ||
          !("nonce" in message)
        ) {
          throw new Error("The root ceremony connect request is invalid.")
        }
        const port = transfer[0]
        if (!(port instanceof MessagePort)) {
          throw new Error("The root ceremony message port is missing.")
        }
        port.addEventListener(
          "message",
          (event: MessageEvent<SliceWalletProtocolValue>) => {
            const rootRequest = parseSliceWalletCeremonyRootSignRequest(
              event.data
            )
            receivedRequest = rootRequest.request
            port.postMessage({
              hash: expectedHash,
              nonce: rootRequest.nonce,
              signature,
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
      addEventListener: (packetType: string, listener: typeof onMessage) => {
        if (packetType === "message") onMessage = listener
      },
      crypto: globalThis.crypto,
      matchMedia: () => ({ matches: false }),
      navigator: {
        userActivation: { isActive: false },
        userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36"
      },
      open: mock(() => {
        queueMicrotask(() =>
          onMessage?.(
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
      removeEventListener: (packetType: string, listener: typeof onMessage) => {
        if (packetType === "message" && onMessage === listener) onMessage = null
      }
    })
    const rootSigner = createSliceWalletCeremonyRootSigner({
      account,
      ceremonyBroker: broker,
      chainId: 8453,
      idOrigin: "https://id.slice.so",
      window
    })

    const original = rootSigner(expectedHash, "user_operation", request)
    await Promise.resolve()
    expect(broker.getPending()).toMatchObject({
      kind: "root_sign",
      reason: "user_activation_expired"
    })
    await expect(broker.continueInPopup()).resolves.toBe(signature)
    await expect(original).resolves.toBe(signature)
    expect(receivedRequest).toEqual(request)
  })
})
