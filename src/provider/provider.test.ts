import { describe, expect, mock, test } from "bun:test"
import { numberToHex } from "viem"
import { base, optimism } from "viem/chains"
import type { SliceWalletProviderValue } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { SliceWalletProviderRpcError } from "./errors"
import { createSliceWalletProviderInternal } from "./provider"

const account = "0x0000000000000000000000000000000000000001" as const
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
  policy: {
    account,
    calls: [],
    chainId: base.id,
    grantKind: "generic" as const,
    validAfter: 1_800_000_000,
    validUntil: 1_800_003_600,
    version: 1 as const
  },
  publicKey: `0x04${"11".repeat(64)}` as const,
  signerId: "0x0000000000000000000000000000000000000002" as const
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
  const createGrant = mock(async () => ({
    account,
    chainId: base.id,
    expiresAt: publicGrant.expiresAt,
    permissionId,
    permissions: [],
    version: "1" as const
  }))
  const getGrants = mock(async () => [publicGrant])
  const revokeGrant = mock(async () => {})
  const rotateGrant = mock(async () => publicGrant)
  const runtime = {
    get chainId() {
      return chainId
    },
    connect,
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
    revokeGrant,
    rotateGrant,
    sendCalls: mock(async (_calls, requestedId?: string) => ({
      id: requestedId ?? "generated-id",
      userOperationHash
    })),
    signMessage: mock(async () => userOperationHash),
    signTypedData: mock(async () => userOperationHash),
    supportedChainIds: [base.id, optimism.id],
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
    rotateGrant,
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
    await expectRpcError(
      request(provider, "wallet_connect", [{ capabilities: {}, version: "2" }]),
      -32602
    )
  })

  test("filters 5792 capabilities and advertises no permission standard", async () => {
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
})
