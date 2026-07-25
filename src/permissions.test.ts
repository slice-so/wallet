import { describe, expect, mock, test } from "bun:test"
import type { Address, Hex } from "viem"
import {
  createSliceWalletPermissionRequest,
  erc20ApprovePermission,
  erc20TransferFromPermission,
  erc20TransferPermission,
  getPermissions,
  grantPermissions,
  nativeTransferPermission,
  SliceWalletPermissionUnsupportedWalletError,
  sliceWalletPermissionActions
} from "./permissions"
import type {
  SliceWalletPermissionGrant,
  SliceWalletProvider,
  SliceWalletProviderValue
} from "./types"

const account = "0x1000000000000000000000000000000000000001" as Address
const recipient = "0x2000000000000000000000000000000000000002" as Address
const token = "0x3000000000000000000000000000000000000003" as Address
const now = 1_800_000_000

const permissionRequest = createSliceWalletPermissionRequest(
  {
    expiry: now + 3_600,
    rateLimit: { count: 2, intervalSec: 300 },
    rules: [
      nativeTransferPermission({ maximumValue: 10n, recipient }),
      erc20TransferPermission({
        maximumAmount: 15n,
        recipient,
        token
      }),
      erc20ApprovePermission({
        maximumAmount: 20n,
        spender: recipient,
        token
      }),
      erc20TransferFromPermission({
        account,
        maximumAmount: 25n,
        recipient,
        token
      })
    ]
  },
  now
)

const grant: SliceWalletPermissionGrant = {
  account,
  chainId: 8453,
  createdAt: now,
  expiresAt: now + 3_600,
  permissionId: "0x12345678",
  permissions: permissionRequest.permissions,
  version: "1"
}

const capabilities = {
  "0x2105": {
    slicePermissions: {
      supportedTemplates: [
        "native-transfer",
        "erc20-transfer",
        "erc20-approve",
        "erc20-transfer-from"
      ],
      version: "1"
    }
  }
} as const

const createProvider = (supportsPermissions = true) => {
  const request = mock(
    async ({
      method
    }: Parameters<Pick<SliceWalletProvider, "request">["request"]>[0]) => {
      let result: SliceWalletProviderValue | undefined
      if (method === "eth_accounts") result = [account]
      else if (method === "eth_chainId") result = "0x2105"
      else if (method === "wallet_getCapabilities") {
        result = supportsPermissions ? capabilities : { "0x2105": {} }
      } else if (method === "wallet_getSessionPermissions") result = [grant]
      else if (method === "wallet_grantPermissions") result = grant
      return result
    }
  )
  return {
    provider: { request } satisfies Pick<SliceWalletProvider, "request">,
    request
  }
}

describe("published Slice permission SDK", () => {
  test("builds canonical wire permissions from domain values", () => {
    expect(permissionRequest).toEqual({
      expiry: now + 3_600,
      permissions: [
        {
          data: {
            maximumValue: "0xa",
            recipient,
            template: "native-transfer"
          },
          policies: [
            {
              data: { count: 2, intervalSec: 300 },
              type: "rate-limit"
            }
          ],
          type: "slice-call"
        },
        {
          data: {
            maximumAmount: "0xf",
            recipient,
            template: "erc20-transfer",
            token
          },
          policies: [
            {
              data: { count: 2, intervalSec: 300 },
              type: "rate-limit"
            }
          ],
          type: "slice-call"
        },
        {
          data: {
            maximumAmount: "0x14",
            spender: recipient,
            template: "erc20-approve",
            token
          },
          policies: [
            {
              data: { count: 2, intervalSec: 300 },
              type: "rate-limit"
            }
          ],
          type: "slice-call"
        },
        {
          data: {
            account,
            maximumAmount: "0x19",
            recipient,
            template: "erc20-transfer-from",
            token
          },
          policies: [
            {
              data: { count: 2, intervalSec: 300 },
              type: "rate-limit"
            }
          ],
          type: "slice-call"
        }
      ]
    } as const)
    expect(() =>
      createSliceWalletPermissionRequest(
        {
          expiry: now + 3_600,
          rateLimit: { count: 101, intervalSec: 300 },
          rules: [nativeTransferPermission({ maximumValue: 1n, recipient })]
        },
        now
      )
    ).toThrow("1 to 100")
  })

  test("discovers support before using lifecycle methods", async () => {
    const { provider, request } = createProvider()
    await expect(
      grantPermissions(provider, permissionRequest)
    ).resolves.toEqual(grant)
    await expect(getPermissions(provider)).resolves.toEqual([grant])
    expect(request).toHaveBeenCalledWith({
      method: "wallet_grantPermissions",
      params: [permissionRequest]
    })

    const unsupported = createProvider(false).provider
    await expect(getPermissions(unsupported)).rejects.toBeInstanceOf(
      SliceWalletPermissionUnsupportedWalletError
    )
    const missingMethod = {
      request: mock(async ({ method }) => {
        if (method === "eth_accounts") return [account]
        if (method === "eth_chainId") return "0x2105"
        throw new Error("Method not found")
      })
    } satisfies Pick<SliceWalletProvider, "request">
    await expect(getPermissions(missingMethod)).rejects.toBeInstanceOf(
      SliceWalletPermissionUnsupportedWalletError
    )
  })

  test("exposes the same lifecycle through a Viem client extension", async () => {
    const { provider } = createProvider()
    const actions = sliceWalletPermissionActions(provider as never)
    await expect(actions.getPermissions()).resolves.toEqual([grant])
    await expect(actions.rotatePermission("0x12345678" as Hex)).rejects.toThrow(
      "Slice permission grant must be an object"
    )
  })
})
