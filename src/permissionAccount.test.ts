import { describe, expect, it } from "bun:test"
import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import { createPublicClient, custom, zeroAddress } from "viem"
import { base } from "viem/chains"
import { sliceWalletKernelAddresses } from "./constants"
import {
  buildSliceWalletPermissionInstallCalls,
  buildSliceWalletPermissionRevocationCalls,
  isSliceWalletPermissionInstalled
} from "./permissionAccount"
import { createNativeTransferCallRule } from "./policy"
import type { SliceWalletFrameSession } from "./types"
import { resolveSliceWalletValidationInstallConfig } from "./validationLifecycle"

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

const createClient = ({
  getCode,
  multicall
}: {
  getCode: () => Promise<`0x${string}` | undefined>
  multicall: () => Promise<
    readonly [
      number,
      { hook: `0x${string}`; nonce: number },
      {
        permissionFlag: `0x${string}`
        policyData: readonly `0x${string}`[]
        signer: `0x${string}`
      },
      boolean
    ]
  >
}) =>
  Object.assign(
    createPublicClient({
      chain: base,
      transport: custom({
        request: async () => {
          throw new Error("Unexpected raw RPC request.")
        }
      })
    }),
    { getCode, multicall }
  ) as KernelSmartAccountImplementation["client"]

describe("Kernel permission lifecycle", () => {
  it("requires execute-selector authorization for an installed permission", () => {
    expect(
      isSliceWalletPermissionInstalled({
        configuredSigner: signer,
        expectedSigner: signer,
        selectorAllowed: false
      })
    ).toBe(false)
    expect(
      isSliceWalletPermissionInstalled({
        configuredSigner: signer,
        expectedSigner: signer,
        selectorAllowed: true
      })
    ).toBe(true)
  })

  it("derives install nonces from Kernel lifecycle state", () => {
    expect(
      resolveSliceWalletValidationInstallConfig({
        currentNonce: 4,
        validationNonce: 0
      })
    ).toEqual({
      hook: "0x0000000000000000000000000000000000000000",
      nonce: 4
    })
    expect(
      resolveSliceWalletValidationInstallConfig({
        currentNonce: 4,
        validationNonce: 3
      }).nonce
    ).toBe(3)
  })

  it("does not treat a selector-checkpointed permission as installed", async () => {
    const client = createClient({
      getCode: async () => "0x01",
      multicall: async () => [
        4,
        { hook: zeroAddress, nonce: 3 },
        {
          permissionFlag: "0x0000",
          policyData: [],
          signer: sliceWalletKernelAddresses.webAuthnSignerV004
        },
        false
      ]
    })

    const result = await buildSliceWalletPermissionInstallCalls({
      account,
      client,
      session
    })
    expect(result.calls).toHaveLength(1)
  })

  it("fails revocation reads loudly for a deployed account", async () => {
    const readFailure = new Error("RPC unavailable")
    const client = createClient({
      getCode: async () => "0x01",
      multicall: async () => {
        throw readFailure
      }
    })

    await expect(
      buildSliceWalletPermissionRevocationCalls({ account, client, session })
    ).rejects.toBe(readFailure)
  })
})
