import { describe, expect, mock, test } from "bun:test"
import { type Address, numberToHex } from "viem"
import { base, optimism } from "viem/chains"
import type { SliceWalletProviderValue } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { SliceWalletUserRejectedRequestError } from "../userRejectedRequest"
import { SliceWalletProviderRpcError } from "./errors"
import { createSliceWalletProviderInternal } from "./provider"

const account: Address = "0x0000000000000000000000000000000000000001"
const permissionId = "0x12345678" as const
const userOperationHash = `0x${"ab".repeat(32)}` as const
const transactionHash = `0x${"cd".repeat(32)}` as const

type ProviderDependencies = NonNullable<
  Parameters<typeof createSliceWalletProviderInternal>[1]
>
type ProviderRuntime = ReturnType<
  NonNullable<ProviderDependencies["createRuntime"]>
>

const browserWindow: Window = Object.create(null)
Object.defineProperty(browserWindow, "location", {
  value: { href: "https://portable.example/app" }
})

const config: SliceWalletProviderConfig = {
  chains: [
    {
      bundlerUrl: "https://bundler.example/base",
      chain: base,
      rpcUrl: "https://rpc.example/base"
    },
    {
      bundlerUrl: "https://bundler.example/op",
      chain: optimism,
      rpcUrl: "https://rpc.example/op"
    }
  ],
  defaultChainId: base.id,
  idOrigin: "https://id.slice.so",
  window: browserWindow
}

const publicGrant = {
  account,
  chainId: base.id,
  createdAt: 1_800_000_000,
  expiresAt: 1_800_003_600,
  permissionId,
  permissions: [],
  version: "1" as const
}

const createRuntime = () => {
  let connected = true
  let chainId: number = base.id
  const connect = mock(async () => {
    connected = true
    return { rootAccount: { address: account } }
  })
  const disconnect = mock(async () => {
    connected = false
  })
  const revokePermissions = mock(async () => {
    connected = false
    return true
  })
  const createGrant = mock(
    async (
      _grant: Parameters<ProviderRuntime["createGrant"]>[0],
      _options?: Parameters<ProviderRuntime["createGrant"]>[1]
    ) => ({
      account,
      chainId: base.id,
      createdAt: publicGrant.createdAt,
      expiresAt: publicGrant.expiresAt,
      permissionId,
      permissions: [],
      version: "1" as const
    })
  )
  const getGrants = mock(async () => [publicGrant])
  const revokeGrant = mock(async () => {})
  const requestExtension = mock(async () => ({
    status: "preparation_failed" as const
  }))
  const rotateGrant = mock(async () => publicGrant)
  const sendCalls = mock(async (_calls, requestedId?: string) => ({
    id: requestedId ?? "generated-id",
    userOperationHash
  }))
  const runtime = {
    get chainId() {
      return chainId
    },
    connect,
    connectWithExtension: mock(async () => ({
      wallet: { rootAccount: { address: account } }
    })),
    cancelPendingCeremony: mock(() => {}),
    continueInPopup: mock(async () => userOperationHash),
    createGrant,
    destroy: mock(() => {}),
    disconnect,
    forwardRpc: mock(async () => ({ handled: false as const })),
    getAccounts: mock(async () => (connected ? [account] : [])),
    getCallsStatus: mock(async (id: string) => ({
      atomic: true,
      chainId: numberToHex(base.id),
      id,
      status: 100 as const,
      version: "2.0.0" as const
    })),
    getGrants,
    paymasterAvailable: mock(() => false),
    pendingCeremony: null,
    revokeGrant,
    revokePermissions,
    requestExtension,
    subscribePendingCeremony: mock(() => () => undefined),
    rotateGrant,
    sendCalls,
    signMessage: mock(async () => userOperationHash),
    signTypedData: mock(async () => userOperationHash),
    supportedChainIds: [base.id, optimism.id],
    switchAccount: mock(async () => ({ rootAccount: { address: account } })),
    switchChain: mock((nextChainId: number) => {
      if (nextChainId !== base.id && nextChainId !== optimism.id) {
        throw new SliceWalletProviderRpcError(4902, "Unsupported chain.")
      }
      chainId = nextChainId
    }),
    waitForSuccessfulUserOperation: mock(async () => ({
      receipt: { transactionHash }
    }))
  } satisfies ProviderRuntime

  return {
    createGrant,
    disconnect,
    getGrants,
    revokeGrant,
    revokePermissions,
    requestExtension,
    rotateGrant,
    sendCalls,
    runtime
  }
}

const createProvider = () => {
  const fixture = createRuntime()
  return {
    ...fixture,
    provider: createSliceWalletProviderInternal(config, {
      createRuntime: () => fixture.runtime
    })
  }
}

const request = (
  provider: ReturnType<typeof createProvider>["provider"],
  method: string,
  params?: readonly SliceWalletProviderValue[]
) => provider.request({ method, ...(params === undefined ? {} : { params }) })

const expectRpcError = async (
  promise: Promise<SliceWalletProviderValue | undefined>,
  code: number
) => {
  try {
    await promise
    throw new Error("Expected provider RPC failure.")
  } catch (error) {
    expect(error).toBeInstanceOf(SliceWalletProviderRpcError)
    expect((error as SliceWalletProviderRpcError).code).toBe(code)
  }
}

describe("Slice Wallet provider dispatch", () => {
  test("preserves EIP-1193 user rejection errors", async () => {
    const { provider, runtime } = createProvider()
    const rejection = new SliceWalletUserRejectedRequestError()
    runtime.connect.mockImplementation(async () => {
      throw rejection
    })

    await expect(request(provider, "eth_requestAccounts")).rejects.toBe(
      rejection
    )
    expect(rejection.code).toBe(4001)
  })

  test("isolates throwing event listeners from RPC results and sibling listeners", async () => {
    const { provider } = createProvider()
    await request(provider, "wallet_disconnect")
    const nativeReportError = Object.getOwnPropertyDescriptor(
      globalThis,
      "reportError"
    )
    const listenerError = new Error("consumer listener failed")
    const reportError = mock(() => undefined)
    Object.defineProperty(globalThis, "reportError", {
      configurable: true,
      value: reportError
    })
    try {
      const accountEvents: string[][] = []
      provider.on("accountsChanged", () => {
        throw listenerError
      })
      provider.on("accountsChanged", (accounts) => {
        accountEvents.push([...accounts])
      })

      await expect(request(provider, "eth_requestAccounts")).resolves.toEqual([
        account
      ])
      expect(accountEvents).toEqual([[account]])
      expect(reportError).toHaveBeenCalledWith(listenerError)
    } finally {
      if (nativeReportError !== undefined) {
        Object.defineProperty(globalThis, "reportError", nativeReportError)
      }
    }
  })

  test("runs an opaque extension for an already-connected account without reconnecting", async () => {
    const { provider, requestExtension, runtime } = createProvider()
    const extension = { prepared: { kind: "slice-id" } } as const

    expect(await provider.requestExtension(extension)).toEqual({
      status: "preparation_failed"
    })
    expect(requestExtension).toHaveBeenCalledWith(extension)
    expect(runtime.connect).not.toHaveBeenCalled()
    expect(runtime.connectWithExtension).not.toHaveBeenCalled()
  })

  test("pins wallet_connect v1 and returns only granted capabilities", async () => {
    const { provider } = createProvider()

    expect(
      await request(provider, "wallet_connect", [
        { capabilities: {}, version: "1" }
      ])
    ).toEqual({ accounts: [{ address: account, capabilities: {} }] })

    await expectRpcError(
      request(provider, "wallet_connect", [
        { capabilities: { permissions: {} }, version: "1" }
      ]),
      5700
    )
    expect(
      await request(provider, "wallet_connect", [
        {
          capabilities: { signInWithEthereum: { optional: true } },
          version: "1"
        }
      ])
    ).toEqual({ accounts: [{ address: account, capabilities: {} }] })
    await expectRpcError(
      request(provider, "wallet_connect", [{ capabilities: {}, version: "2" }]),
      -32602
    )
  })

  test("uses the standalone parser for required and optional connect-time grants", async () => {
    const expiry = Math.floor(Date.now() / 1_000) + 3_600
    const grantPermissions = {
      expiry,
      permissions: [
        {
          data: {
            maximumValue: "0x1",
            recipient: account,
            template: "native-transfer"
          },
          policies: [
            {
              data: { count: 1, intervalSec: 60 },
              type: "rate-limit"
            }
          ],
          type: "slice-call"
        }
      ]
    } as const
    const { createGrant, provider } = createProvider()
    const connected = await request(provider, "wallet_connect", [
      {
        capabilities: { grantPermissions },
        version: "1"
      }
    ])
    expect(connected).toEqual({
      accounts: [
        {
          address: account,
          capabilities: {
            grantPermissions: {
              account,
              chainId: base.id,
              createdAt: publicGrant.createdAt,
              expiresAt: publicGrant.expiresAt,
              permissionId,
              permissions: [],
              version: "1"
            }
          }
        }
      ]
    })
    expect(createGrant.mock.calls[0]?.[1]).toEqual({ reuseMatching: true })

    const optional = createProvider()
    expect(
      await request(optional.provider, "wallet_connect", [
        {
          capabilities: {
            grantPermissions: {
              expiry,
              optional: true,
              permissions: []
            }
          },
          version: "1"
        }
      ])
    ).toEqual({ accounts: [{ address: account, capabilities: {} }] })
    expect(optional.createGrant).not.toHaveBeenCalled()
  })

  test("does not interpret authentication capabilities", async () => {
    const { provider, runtime } = createProvider()
    expect(
      await request(provider, "wallet_connect", [
        {
          capabilities: {
            session: { optional: true }
          },
          version: "1"
        }
      ])
    ).toEqual({ accounts: [{ address: account, capabilities: {} }] })
    expect(runtime.connectWithExtension).not.toHaveBeenCalled()
    await expectRpcError(
      request(provider, "wallet_connect", [
        {
          capabilities: {
            session: { optional: false }
          },
          version: "1"
        }
      ]),
      5700
    )
  })

  test("withholds generic permissions from de-admitted chains", async () => {
    const { provider } = createProvider()

    expect(
      await request(provider, "wallet_getCapabilities", [
        account,
        [numberToHex(base.id)]
      ])
    ).toEqual({
      [numberToHex(base.id)]: {
        atomic: { status: "supported" },
        paymasterService: { supported: true }
      }
    })
    expect(
      await request(provider, "wallet_getCapabilities", [account, ["0x1"]])
    ).toEqual({})
    await expectRpcError(
      request(provider, "wallet_getCapabilities", [
        account,
        ["0x20000000000000"]
      ]),
      -32602
    )
  })

  test("exposes only the finalized custom session-permission method names", async () => {
    const { getGrants, provider, revokeGrant, rotateGrant } = createProvider()

    expect(await request(provider, "wallet_getSessionPermissions", [])).toEqual(
      [publicGrant]
    )
    expect(
      await request(provider, "wallet_rotateSessionPermission", [permissionId])
    ).toEqual(publicGrant)
    expect(
      await request(provider, "wallet_revokeSessionPermission", [permissionId])
    ).toBeNull()
    expect(getGrants).toHaveBeenCalledTimes(1)
    expect(rotateGrant).toHaveBeenCalledWith(permissionId)
    expect(revokeGrant).toHaveBeenCalledWith(permissionId)

    await expectRpcError(
      request(provider, "wallet_getSessionPermissions", [permissionId]),
      -32602
    )

    await expectRpcError(request(provider, "slice_getGrants", []), 4200)
    await expectRpcError(
      request(provider, "wallet_getGrantedExecutionPermissions", []),
      4200
    )
    await expectRpcError(request(provider, "wallet_sendTransaction", []), 4200)
  })

  test("fails explicitly when calls-status presentation is not shipped", async () => {
    const { provider } = createProvider()
    await expectRpcError(
      request(provider, "wallet_showCallsStatus", ["call-id"]),
      4200
    )
  })

  test("switches configured chains, emits chainChanged, and disconnects", async () => {
    const { disconnect, provider } = createProvider()
    const accountEvents: string[][] = []
    const disconnectEvents: { code: number; message: string }[] = []
    const chainEvents: string[] = []
    provider.on("accountsChanged", (accounts) => {
      accountEvents.push([...accounts])
    })
    provider.on("disconnect", (error) => disconnectEvents.push(error))
    provider.on("chainChanged", (chainId) => chainEvents.push(chainId))

    expect(
      await request(provider, "wallet_switchEthereumChain", [
        { chainId: numberToHex(base.id) }
      ])
    ).toBeNull()
    expect(
      await request(provider, "wallet_switchEthereumChain", [
        { chainId: numberToHex(optimism.id) }
      ])
    ).toBeNull()
    expect(await request(provider, "eth_chainId")).toBe(
      numberToHex(optimism.id)
    )
    expect(chainEvents).toEqual([numberToHex(optimism.id)])

    await request(provider, "wallet_disconnect", [])
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(accountEvents).toEqual([[]])
    expect(disconnectEvents).toEqual([
      { code: 4900, message: "Slice Wallet disconnected." }
    ])
  })

  test("emits accountsChanged only after a different account is committed", async () => {
    const { provider, runtime } = createProvider()
    const events: string[][] = []
    provider.on("accountsChanged", (accounts) => events.push([...accounts]))

    await provider.switchAccount()
    expect(events).toEqual([])

    const next = "0x0000000000000000000000000000000000000003" as const
    runtime.switchAccount.mockImplementation(async () => ({
      rootAccount: { address: next }
    }))
    expect(await request(provider, "wallet_switchAccount", [])).toBe(next)
    expect(events).toEqual([[next]])

    runtime.switchAccount.mockImplementation(async () => {
      throw new Error("chooser cancelled")
    })
    await expect(request(provider, "wallet_switchAccount", [])).rejects.toThrow(
      "chooser cancelled"
    )
    expect(events).toEqual([[next]])
  })

  test("accepts configured add-chain requests and rejects unknown chains", async () => {
    const { provider } = createProvider()

    expect(
      await request(provider, "wallet_addEthereumChain", [
        { chainId: numberToHex(optimism.id), chainName: "Optimism" }
      ])
    ).toBeNull()
    await expectRpcError(
      request(provider, "wallet_addEthereumChain", [{ chainId: "0x89" }]),
      4902
    )
  })

  test("rejects a transaction bound to a configured but inactive chain", async () => {
    const { provider } = createProvider()
    await expectRpcError(
      request(provider, "eth_sendTransaction", [
        {
          chainId: numberToHex(optimism.id),
          from: account,
          to: account
        }
      ]),
      4901
    )
    await expectRpcError(
      request(provider, "eth_sendTransaction", [
        { chainId: "0x89", from: account, to: account }
      ]),
      4902
    )
  })

  test("routes sendCalls to a configured inactive chain", async () => {
    const { provider, sendCalls } = createProvider()

    expect(
      await request(provider, "wallet_sendCalls", [
        {
          atomicRequired: true,
          calls: [{ to: account }],
          chainId: numberToHex(optimism.id),
          from: account,
          version: "2.0.0"
        }
      ])
    ).toEqual({ id: "generated-id" })
    expect(sendCalls).toHaveBeenCalledWith(
      [{ data: "0x", to: account, value: 0n }],
      undefined,
      undefined,
      optimism.id
    )
  })

  test("validates the permission being revoked", async () => {
    const { provider, revokePermissions } = createProvider()

    await expectRpcError(
      request(provider, "wallet_revokePermissions", [
        { parentCapability: "personal_sign" }
      ]),
      -32602
    )
    await expectRpcError(
      request(provider, "wallet_revokePermissions", [{ personal_sign: {} }]),
      -32602
    )
    expect(revokePermissions).not.toHaveBeenCalled()
    expect(
      await request(provider, "wallet_revokePermissions", [
        { eth_accounts: {} }
      ])
    ).toBeNull()
    expect(revokePermissions).toHaveBeenCalledTimes(1)

    expect(
      await request(provider, "wallet_revokePermissions", [
        { parentCapability: "eth_accounts" }
      ])
    ).toBeNull()
    expect(revokePermissions).toHaveBeenCalledTimes(2)
  })

  test("emits revocation events for a stored account that is already locked", async () => {
    const { provider } = createProvider()
    await request(provider, "wallet_disconnect")
    const events: string[] = []
    provider.on("accountsChanged", () => events.push("accountsChanged"))
    provider.on("disconnect", () => events.push("disconnect"))

    await request(provider, "wallet_revokePermissions", [{ eth_accounts: {} }])

    expect(events).toEqual(["accountsChanged", "disconnect"])
  })

  test("emits local disconnect state before cleanup settles", async () => {
    const { disconnect, provider } = createProvider()
    const events: string[] = []
    let rejectCleanup: ((error: Error) => void) | undefined
    disconnect.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCleanup = reject
        })
    )
    provider.on("accountsChanged", () => events.push("accountsChanged"))
    provider.on("disconnect", () => events.push("disconnect"))

    const requestPromise = request(provider, "wallet_disconnect")
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(["accountsChanged", "disconnect"])

    rejectCleanup?.(new Error("cleanup failed"))
    await expect(requestPromise).rejects.toThrow("cleanup failed")
  })
})
