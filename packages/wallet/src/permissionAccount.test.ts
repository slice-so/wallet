import { describe, expect, test } from "bun:test"
import { createPublicClient, custom, decodeFunctionData } from "viem"
import { base } from "viem/chains"
import { isSliceWalletPermissionInstalled } from "./permissionAccount"
import {
  buildSliceWalletPermissionInstallCalls,
  buildSliceWalletPermissionRevocationCalls,
  createNativeTransferCallRule,
  type SliceWalletFrameSession
} from "./protocol/index"
import { kernelAccountAbi } from "./protocol/kernel"

const signer = "0x1111111111111111111111111111111111111111" as const
const account = "0x2222222222222222222222222222222222222222" as const
const session = {
  account,
  chainId: base.id,
  expiresAt: 2_000_000_000,
  grantKind: "generic",
  permissionId: "0x12345678",
  policy: {
    account,
    calls: [
      createNativeTransferCallRule({ maximumValue: 1n, recipient: signer })
    ],
    chainId: base.id,
    grantKind: "generic",
    rateLimit: { count: 1, intervalSec: 60 },
    validAfter: 1_999_996_400,
    validUntil: 2_000_000_000,
    version: 1
  },
  publicKey: `0x04${"33".repeat(64)}`,
  signerId: "0x4444444444444444444444444444444444444444"
} satisfies SliceWalletFrameSession

const undeployedClient = createPublicClient({
  chain: base,
  transport: custom({
    async request({ method }) {
      if (method === "eth_getCode") return "0x"
      throw new Error(`Unexpected RPC request: ${method}`)
    }
  })
})

describe("Kernel v4 permission lifecycle", () => {
  test("matches configured permission identity", () => {
    expect(
      isSliceWalletPermissionInstalled({
        configuredSigner: signer,
        expectedSigner: signer,
        selectorAllowed: true
      })
    ).toBe(true)
    expect(
      isSliceWalletPermissionInstalled({
        configuredSigner: signer,
        expectedSigner: signer,
        selectorAllowed: false
      })
    ).toBe(false)
  })

  test("installs policies before the signer in one package batch", async () => {
    const result = await buildSliceWalletPermissionInstallCalls({
      account,
      client: undeployedClient,
      session
    })
    expect(result.calls).toHaveLength(1)
    const decoded = decodeFunctionData({
      abi: kernelAccountAbi,
      data: result.calls[0]?.data ?? "0x"
    })
    expect(decoded.functionName).toBe("installModule")
    if (decoded.functionName !== "installModule") {
      throw new Error("Expected a Kernel module installation call.")
    }
    const installs = decoded.args[0]
    if (typeof installs === "bigint") {
      throw new Error("Expected a Kernel installation package batch.")
    }
    expect(installs.map((install) => install.moduleType)).toEqual([
      5n,
      5n,
      5n,
      6n
    ])
  })

  test("burns an unused enable authorization with the install nonce", async () => {
    const result = await buildSliceWalletPermissionRevocationCalls({
      account,
      client: undeployedClient,
      enableNonce: 0n,
      session
    })
    expect(result.calls).toHaveLength(1)
    const decoded = decodeFunctionData({
      abi: kernelAccountAbi,
      data: result.calls[0]?.data ?? "0x"
    })
    expect(decoded.functionName).toBe("setNonce")
    expect(decoded.args).toEqual([0n, 1n])
  })
})
