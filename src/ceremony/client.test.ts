import { describe, expect, it, mock } from "bun:test"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../p256Server"
import { createErc20ApproveCallRule, getWalletPermissionId } from "../policy"
import type {
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types"
import { authorizeSliceWalletSession } from "./client"

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
    rootSignature: "0x02",
    scopes: ["wallet_execution"],
    signerProof: `0x${"33".repeat(64)}` as Hex
  },
  session
} as const satisfies SliceWalletPermissionAuthorization

const createWindow = ({
  isActive,
  open
}: {
  isActive: boolean
  open: (...args: Parameters<Window["open"]>) => object | null
}) =>
  Object.assign(Object.create(null) as Window, {
    crypto: globalThis.crypto,
    location: { origin: "https://shop.example" },
    navigator: { userActivation: { isActive } },
    open
  })

const createFrameClient = () => {
  const visibility: boolean[] = []
  const client: SliceWalletSignerFrameClient = {
    destroy: () => undefined,
    request: async () => authorization,
    setContinuationVisible: (visible) => visibility.push(visible)
  }
  return { client, visibility }
}

describe("authorizeSliceWalletSession", () => {
  it("uses the frame continuation without attempting a popup after activation expires", async () => {
    const open = mock(() => null)
    const { client, visibility } = createFrameClient()

    const result = await authorizeSliceWalletSession({
      frameClient: client,
      idOrigin: "https://id.slice.so",
      session,
      timeoutMs: 100,
      window: createWindow({ isActive: false, open })
    })

    expect(result).toEqual(authorization)
    expect(open).not.toHaveBeenCalled()
    expect(visibility).toEqual([true, false])
  })

  it("uses the frame continuation when the browser blocks an active popup", async () => {
    const open = mock(() => null)
    const { client, visibility } = createFrameClient()

    const result = await authorizeSliceWalletSession({
      frameClient: client,
      idOrigin: "https://id.slice.so",
      session,
      timeoutMs: 100,
      window: createWindow({ isActive: true, open })
    })

    expect(result).toEqual(authorization)
    expect(open).toHaveBeenCalledTimes(1)
    expect(visibility).toEqual([true, false])
  })

  it("keeps the user consent timeout separate from popup readiness", async () => {
    const close = mock(() => undefined)
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
        setTimeout(
          () =>
            port.postMessage({
              authorization,
              nonce: input.nonce,
              type: "slice-wallet:ceremony-authorization",
              version: 1
            }),
          20
        )
      }) as Window["postMessage"]
    })
    const open = mock(() => popup)
    let onMessage:
      | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
      | null = null
    const browserWindow = Object.assign(
      createWindow({ isActive: true, open }),
      {
        addEventListener: ((_type: "message", listener: typeof onMessage) => {
          onMessage = listener
        }) as Window["addEventListener"],
        removeEventListener: ((
          _type: "message",
          listener: typeof onMessage
        ) => {
          if (onMessage === listener) onMessage = null
        }) as Window["removeEventListener"]
      }
    )
    const { client } = createFrameClient()

    const resultPromise = authorizeSliceWalletSession({
      frameClient: client,
      idOrigin: "https://id.slice.so",
      popupReadyTimeoutMs: 5,
      session,
      timeoutMs: 100,
      window: browserWindow
    })
    queueMicrotask(() => {
      onMessage?.(
        new MessageEvent("message", {
          data: { type: "slice-wallet:ceremony-ready", version: 1 },
          origin: "https://id.slice.so",
          source: popup
        })
      )
    })

    await expect(resultPromise).resolves.toEqual(authorization)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
