import { describe, expect, test } from "bun:test"
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  multicall3Abi,
  padHex
} from "viem"
import {
  sliceWalletEntryPoint,
  sliceWalletSimulationMulticall,
  sliceWalletSimulationStaticCallProxy
} from "./protocol/constants"
import {
  getSliceWalletSimulationErc20Asset,
  getSliceWalletSimulationSnapshotPlan,
  parseSliceWalletSimulationTokenSymbol
} from "./simulationSnapshots"

const account = "0x1000000000000000000000000000000000000001"
const tokenA = "0x3000000000000000000000000000000000000003"
const tokenB = "0x4000000000000000000000000000000000000004"
const spender = "0x5000000000000000000000000000000000000005"

describe("simulation token metadata", () => {
  test("accepts compact ASCII tickers", () => {
    expect(parseSliceWalletSimulationTokenSymbol(" USDC ")).toBe("USDC")
    expect(parseSliceWalletSimulationTokenSymbol("UNI-V2")).toBe("UNI-V2")
  })

  test("rejects deceptive or non-display ticker values", () => {
    expect(parseSliceWalletSimulationTokenSymbol("UЅDC")).toBeNull()
    expect(parseSliceWalletSimulationTokenSymbol("USD C")).toBeNull()
    expect(parseSliceWalletSimulationTokenSymbol("\nUSDC")).toBe("USDC")
    expect(parseSliceWalletSimulationTokenSymbol("A".repeat(33))).toBeNull()
  })
})

describe("wallet simulation snapshot plan", () => {
  const plan = () =>
    getSliceWalletSimulationSnapshotPlan({
      account,
      approvals: new Map([
        [`${tokenA}:${spender}`, { spender, token: tokenA }]
      ]),
      tokenAddresses: [tokenA, tokenB]
    })

  const snapshotResult = (
    entries: readonly { returnData: `0x${string}`; success: boolean }[]
  ) =>
    plan().parse(
      encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: entries
      })
    )

  const ok = (returnData: `0x${string}`) => ({ returnData, success: true })
  const failed = () => ({ returnData: "0x" as const, success: false })

  test("bounds one multicall to fixed reads, per-token metadata, and allowances", () => {
    const data = plan().call.data
    const decoded = decodeFunctionData({ abi: multicall3Abi, data })
    if (decoded.functionName !== "aggregate3") {
      throw new Error("Expected an aggregate3 call.")
    }
    // 2 fixed + 2 tokens × 3 reads + 1 allowance.
    expect(decoded.args[0]).toHaveLength(9)
  })

  test("routes token reads through the injected static-call forwarder", () => {
    const decoded = decodeFunctionData({
      abi: multicall3Abi,
      data: plan().call.data
    })
    if (decoded.functionName !== "aggregate3") {
      throw new Error("Expected an aggregate3 call.")
    }
    const calls = decoded.args[0]
    // Decoded targets are checksummed; compare case-insensitively.
    // The two required reads keep their direct targets.
    expect(calls[0]?.allowFailure).toBe(false)
    expect(calls[0]?.target.toLowerCase()).toBe(
      sliceWalletSimulationMulticall.toLowerCase()
    )
    expect(calls[1]?.allowFailure).toBe(false)
    expect(calls[1]?.target.toLowerCase()).toBe(
      sliceWalletEntryPoint.address.toLowerCase()
    )
    // Every token read targets the forwarder with the inner target embedded
    // in the first calldata word.
    const balanceRead = calls[2]
    if (balanceRead === undefined) throw new Error("Missing balance read.")
    expect(balanceRead.allowFailure).toBe(true)
    expect(balanceRead.target.toLowerCase()).toBe(
      sliceWalletSimulationStaticCallProxy.toLowerCase()
    )
    if (!balanceRead.callData.startsWith(padHex(tokenA, { size: 32 }))) {
      throw new Error("Expected the inner target in the first calldata word.")
    }
    const inner = decodeFunctionData({
      abi: erc20Abi,
      data: `0x${balanceRead.callData.slice(66)}` as `0x${string}`
    })
    expect(inner.functionName).toBe("balanceOf")
    // The allowance read is wrapped the same way.
    const allowanceRead = calls[8]
    if (allowanceRead === undefined) throw new Error("Missing allowance read.")
    expect(allowanceRead.allowFailure).toBe(true)
    expect(allowanceRead.target.toLowerCase()).toBe(
      sliceWalletSimulationStaticCallProxy.toLowerCase()
    )
  })

  test("parses snapshot values with tolerant per-read failures", () => {
    const parsed = snapshotResult([
      ok(
        encodeFunctionResult({
          abi: multicall3Abi,
          functionName: "getEthBalance",
          result: 1_000_000_000_000n
        })
      ),
      ok(
        encodeFunctionResult({
          abi: erc20Abi,
          functionName: "balanceOf",
          result: 5_000n
        })
      ),
      ok(
        encodeFunctionResult({
          abi: erc20Abi,
          functionName: "balanceOf",
          result: 7n
        })
      ),
      ok(
        encodeFunctionResult({
          abi: erc20Abi,
          functionName: "decimals",
          result: 18
        })
      ),
      ok(
        encodeFunctionResult({
          abi: erc20Abi,
          functionName: "symbol",
          result: "BAD\nSYMBOL!"
        })
      ),
      failed(),
      failed(),
      failed(),
      ok(
        encodeFunctionResult({
          abi: erc20Abi,
          functionName: "allowance",
          result: 42n
        })
      )
    ])

    expect(parsed.nativeBalance).toBe(1_000_000_000_000n)
    expect(parsed.entryPointDeposit).toBe(5_000n)
    expect(parsed.tokenBalances.get(tokenA.toLowerCase())).toBe(7n)
    expect(parsed.allowances.get(`${tokenA}:${spender}`)).toBe(42n)
    // A deceptive ticker decodes to no symbol rather than a spoofed label.
    expect(parsed.metadata.get(tokenA.toLowerCase())).toEqual({
      address: tokenA,
      decimals: 18,
      symbol: null
    })
    expect(parsed.metadata.get(tokenB.toLowerCase())).toEqual({
      address: tokenB,
      decimals: null,
      symbol: null
    })
  })

  test("fails hard when required wallet-owned reads fail", () => {
    expect(() =>
      snapshotResult(
        Array.from({ length: 9 }, () => ({ returnData: "0x", success: false }))
      )
    ).toThrow("Wallet simulation snapshot read failed.")
  })

  test("maps stored metadata onto display assets", () => {
    const metadata = new Map([
      [
        tokenA.toLowerCase(),
        { address: tokenA as Address, decimals: null, symbol: null }
      ]
    ])
    expect(getSliceWalletSimulationErc20Asset(tokenA, metadata)).toEqual({
      address: tokenA,
      decimals: null,
      symbol: null,
      type: "erc20"
    })
  })
})
