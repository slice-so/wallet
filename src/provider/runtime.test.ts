import { beforeEach, describe, expect, mock, test } from "bun:test"
import { numberToHex } from "viem"
import { base, optimism } from "viem/chains"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { createSliceWalletProviderRuntime } from "./runtime"
import {
  readStoredSliceWalletAccount,
  writeStoredSliceWalletAccount
} from "./storage"

type RuntimeDependencies = NonNullable<
  Parameters<typeof createSliceWalletProviderRuntime>[1]
>
type ChainRuntimeFactory = NonNullable<
  RuntimeDependencies["createChainRuntime"]
>
type ChainRuntime = ReturnType<ChainRuntimeFactory>

const account = "0x0000000000000000000000000000000000000001" as const
const userOperationHash = `0x${"11".repeat(32)}` as const
const credentialIdHash = `0x${"22".repeat(32)}` as const
const storageValues = new Map<string, string>()
const storage = {
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  get length() {
    return storageValues.size
  },
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => storageValues.delete(key),
  setItem: (key: string, value: string) => storageValues.set(key, value)
} satisfies Storage

const config = {
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
  document: Object.create(null) as Document,
  idOrigin: "https://id.slice.so",
  storage,
  window: Object.assign(Object.create(null) as Window, {
    crypto: globalThis.crypto,
    location: { href: "https://dapp.example" }
  })
} satisfies SliceWalletProviderConfig

beforeEach(() => storageValues.clear())

const createRuntimeFixture = () => {
  const callsByChain = new Map<number, Set<string>>()
  const sendCallsByChain = new Map<number, ReturnType<typeof mock>>()
  const revokeGrantByChain = new Map<number, ReturnType<typeof mock>>()
  const statusChains: number[] = []
  const createChainRuntime: ChainRuntimeFactory = (chainConfig) => {
    const calls = new Set<string>()
    callsByChain.set(chainConfig.chain.id, calls)
    const sendCalls = mock(async (_calls, requestedId?: string) => ({
      id: requestedId ?? `call-${chainConfig.chain.id}`,
      userOperationHash
    }))
    sendCallsByChain.set(chainConfig.chain.id, sendCalls)
    const revokeGrant = mock(async () => undefined)
    revokeGrantByChain.set(chainConfig.chain.id, revokeGrant)
    return {
      chainId: chainConfig.chain.id,
      connect: mock(async () => null as never),
      createGrant: mock(async () => null as never),
      destroy: mock(() => undefined),
      forwardRpc: mock(async () => ({ handled: false as const })),
      getAccounts: mock(async () => [account]),
      getCallsStatus: mock(async (id: string) => {
        statusChains.push(chainConfig.chain.id)
        return {
          atomic: true,
          chainId: numberToHex(chainConfig.chain.id),
          id,
          status: 100 as const,
          version: "2.0.0" as const
        }
      }),
      getGrants: mock(async () => []),
      hasCall: (id: string) => calls.has(id),
      paymasterAvailable: false,
      revokeGrant,
      rotateGrant: mock(async () => null as never),
      sendCalls,
      signMessage: mock(async () => userOperationHash),
      signTypedData: mock(async () => userOperationHash),
      waitForSuccessfulUserOperation: mock(async () => null as never)
    } satisfies ChainRuntime
  }
  return {
    callsByChain,
    createChainRuntime,
    revokeGrantByChain,
    sendCallsByChain,
    statusChains
  }
}

describe("multichain provider runtime routing", () => {
  test("routes calls to an inactive configured chain", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)

    await runtime.sendCalls([], "op-call", undefined, optimism.id)

    expect(fixture.sendCallsByChain.get(optimism.id)).toHaveBeenCalledWith(
      [],
      "op-call",
      undefined
    )
    expect(fixture.sendCallsByChain.has(base.id)).toBe(false)
  })

  test("finds an in-memory call after switching away from its chain", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(optimism.id)
    fixture.callsByChain.get(optimism.id)?.add("op-call")
    runtime.switchChain(optimism.id)
    runtime.switchChain(base.id)

    await runtime.getCallsStatus("op-call")

    expect(fixture.statusChains).toEqual([optimism.id])
  })

  test("keeps the account retryable after a partial disconnect failure", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    runtime.getChainRuntime(optimism.id)
    const failure = new Error("onchain revoke failed")
    fixture.revokeGrantByChain
      .get(optimism.id)
      ?.mockImplementation(async () => {
        throw failure
      })
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      credentialIdHash
    })

    try {
      await runtime.disconnect()
      throw new Error("Expected disconnect cleanup to fail.")
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([failure])
    }
    expect(readStoredSliceWalletAccount(storage)).toEqual({
      accountAddress: account,
      credentialIdHash
    })
  })

  test("clears the stored account after every chain revokes successfully", async () => {
    const fixture = createRuntimeFixture()
    const runtime = createSliceWalletProviderRuntime(config, fixture)
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      credentialIdHash
    })

    await runtime.disconnect()

    expect(readStoredSliceWalletAccount(storage)).toBeNull()
    const baseRevocation = fixture.revokeGrantByChain.get(base.id)
    const optimismRevocation = fixture.revokeGrantByChain.get(optimism.id)
    if (baseRevocation === undefined || optimismRevocation === undefined) {
      throw new Error("Missing chain revocation fixture.")
    }
    expect(baseRevocation).toHaveBeenCalledTimes(1)
    expect(optimismRevocation).toHaveBeenCalledTimes(1)
  })
})
