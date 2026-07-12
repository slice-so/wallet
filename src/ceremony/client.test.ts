import { describe, expect, it, mock } from "bun:test"
import type { Address, Hex } from "viem"
import { getSliceWalletP256SignerId } from "../p256Server"
import { createErc20ApproveCallRule, getWalletPermissionId } from "../policy"
import type {
  SliceWalletPermissionAuthorization,
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
  open: Window["open"]
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
})
