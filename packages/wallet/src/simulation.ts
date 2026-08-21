import {
  type Address,
  getAddress,
  type Hex,
  isAddress,
  isHex,
  keccak256,
  toHex
} from "viem"
import { getSliceWalletUserOperationDeclaredGasCeiling } from "./executionSafety"
import { decodeSliceWalletRootUserOperationCalls } from "./protocol/calls"
import type { SliceWalletProtocolValue } from "./protocol/index"
import { collectSliceWalletSimulationAssetChanges } from "./simulationAssets"
import {
  getSliceWalletSimulationPlan,
  getSliceWalletUserOperationSimulationResult
} from "./simulationExecution"
import {
  getSliceWalletSimulationErc20Asset,
  getSliceWalletSimulationSnapshotPlan,
  type SliceWalletSnapshotMetadata,
  type SliceWalletSnapshotValues
} from "./simulationSnapshots"
import type {
  SliceWalletAllowanceDelta,
  SliceWalletBalanceDelta,
  SliceWalletExactCallSimulation,
  SliceWalletUnresolvedAssetChange,
  SliceWalletUnsignedUserOperation
} from "./types"

type ProtocolRecord = { readonly [key: string]: SliceWalletProtocolValue }

type RpcEnvelope =
  | { error: string; status: "error" }
  | { result: SliceWalletProtocolValue; status: "success" }

type SimulatedLog = {
  address: Address
  data: Hex
  topics: readonly Hex[]
}

type SnapshotPlan = ReturnType<typeof getSliceWalletSimulationSnapshotPlan>

const maximumOptionalSnapshotReads = 64
const maximumAllowanceSnapshotReads = 32
const simulationRpcTimeoutMs = 15_000

const record = (
  value: SliceWalletProtocolValue,
  label: string
): ProtocolRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as ProtocolRecord
}

const array = (
  value: SliceWalletProtocolValue,
  label: string
): readonly SliceWalletProtocolValue[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value
}

const quantity = (value: SliceWalletProtocolValue, label: string) => {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  ) {
    throw new Error(`${label} must be a canonical quantity.`)
  }
  return BigInt(value)
}

/** Statuses may use any hex width; accept every encoding of success. */
const succeeded = (value: SliceWalletProtocolValue | undefined) => {
  if (typeof value !== "string" || !isHex(value, { strict: true })) {
    return false
  }
  return BigInt(value) === 1n
}

const rpcEnvelope = (value: SliceWalletProtocolValue): RpcEnvelope => {
  const input = record(value, "Simulation RPC response")
  if ("error" in input) {
    const error = record(input.error, "Simulation RPC error")
    return {
      error:
        typeof error.message === "string"
          ? error.message
          : "The simulation provider did not include an error message.",
      status: "error"
    }
  }
  if (!("result" in input)) {
    throw new Error("The simulation provider omitted the response result.")
  }
  return { result: input.result, status: "success" }
}

const requestSignal = (signal?: AbortSignal) =>
  signal === undefined
    ? AbortSignal.timeout(simulationRpcTimeoutMs)
    : AbortSignal.any([signal, AbortSignal.timeout(simulationRpcTimeoutMs)])

const postRpc = async ({
  body,
  fetchImpl,
  rpcUrl,
  signal
}: {
  body: SliceWalletProtocolValue
  fetchImpl: typeof fetch
  rpcUrl: string
  signal?: AbortSignal
}) => {
  let response: Response
  try {
    response = await fetchImpl(rpcUrl, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: requestSignal(signal)
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "The wallet simulation service took too long to respond. Please retry in a moment."
      )
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The wallet simulation request was cancelled.")
    }
    throw new Error("The wallet simulation service is unreachable.")
  }
  if (!response.ok) {
    throw new Error(
      `The wallet simulation service is temporarily unavailable (HTTP ${response.status}).`
    )
  }
  let parsed: SliceWalletProtocolValue
  try {
    parsed = (await response.json()) as SliceWalletProtocolValue
  } catch {
    // Covers truncated streams, timeouts after headers, and malformed JSON.
    throw new Error(
      "The wallet simulation service returned an invalid response."
    )
  }
  return parsed
}

const fetchHeadBlock = async ({
  fetchImpl,
  rpcUrl,
  signal
}: {
  fetchImpl: typeof fetch
  rpcUrl: string
  signal?: AbortSignal
}) => {
  const response = rpcEnvelope(
    await postRpc({
      body: {
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getBlockByNumber",
        params: ["latest", false]
      },
      fetchImpl,
      rpcUrl,
      signal
    })
  )
  if (response.status === "error") {
    throw new Error(
      `The simulation provider rejected the head-block request: ${response.error}`
    )
  }
  const block = record(response.result, "Chain head block")
  const number = quantity(block.number ?? null, "Chain head")
  // With validation disabled, eth_simulateV1 prices gas at a zero base fee
  // unless one is pinned. Every supported chain is EIP-1559, so a head block
  // without a usable base fee must fail the simulation rather than silently
  // understate the EntryPoint's min(maxFee, maxPriority + basefee) charge.
  const rawBaseFeePerGas = block.baseFeePerGas
  if (
    typeof rawBaseFeePerGas !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(rawBaseFeePerGas)
  ) {
    throw new Error(
      "The simulation provider did not report a base fee for the head block."
    )
  }
  return { baseFeePerGas: BigInt(rawBaseFeePerGas), number }
}

const parseLog = (value: SliceWalletProtocolValue): SimulatedLog | null => {
  const input = record(value, "Simulation log")
  if (typeof input.address !== "string" || !isAddress(input.address)) {
    return null
  }
  if (!Array.isArray(input.topics)) return null
  const topics: Hex[] = []
  for (const topic of input.topics) {
    if (typeof topic !== "string" || !isHex(topic, { strict: true })) {
      return null
    }
    topics.push(topic)
  }
  if (typeof input.data !== "string" || !isHex(input.data, { strict: true })) {
    return null
  }
  return {
    address: getAddress(input.address),
    data: input.data,
    topics
  }
}

const readResultCall = (
  results: readonly SliceWalletProtocolValue[],
  index: number,
  label: string
): Hex => {
  const result = record(results[index] ?? null, label)
  if (!succeeded(result.status)) {
    throw new Error(`${label} reverted.`)
  }
  if (
    typeof result.returnData !== "string" ||
    !isHex(result.returnData, { strict: true })
  ) {
    throw new Error(`${label} returned invalid data.`)
  }
  return result.returnData
}

const runSimulation = async ({
  baseFeePerGas,
  baseline,
  blockTag,
  fetchImpl,
  rpcUrl,
  signal,
  snapshot,
  userOperation
}: {
  baseFeePerGas: bigint
  baseline?: Pick<SnapshotPlan, "call" | "parse">
  blockTag: Hex
  fetchImpl: typeof fetch
  rpcUrl: string
  signal?: AbortSignal
  snapshot?: Pick<SnapshotPlan, "call" | "parse">
  userOperation: SliceWalletUnsignedUserOperation
}) => {
  const plan = getSliceWalletSimulationPlan(userOperation)
  const { transactions } = plan
  const calls = transactions.map(({ call }) => call)
  // All calls execute sequentially inside ONE simulated block: they share the
  // same block number, timestamp, and base fee, and later calls observe
  // earlier calls' state changes. Splitting them across blockStateCalls
  // entries would advance the chain between reads and execution.
  const expectedCalls =
    calls.length +
    (baseline === undefined ? 0 : 1) +
    (snapshot === undefined ? 0 : 1)
  const response = rpcEnvelope(
    await postRpc({
      body: {
        id: 1,
        jsonrpc: "2.0",
        method: "eth_simulateV1",
        params: [
          {
            blockStateCalls: [
              {
                calls: [
                  ...(baseline === undefined ? [] : [baseline.call]),
                  ...calls,
                  ...(snapshot === undefined ? [] : [snapshot.call])
                ],
                // Keeps the EntryPoint's gas charge realistic under
                // validation:false, which otherwise prices at zero.
                blockOverrides: {
                  baseFeePerGas: toHex(baseFeePerGas)
                },
                ...("stateOverrides" in plan
                  ? { stateOverrides: plan.stateOverrides }
                  : {})
              }
            ],
            traceTransfers: true,
            validation: false
          },
          blockTag
        ]
      },
      fetchImpl,
      rpcUrl,
      signal
    })
  )
  if (response.status === "error") {
    throw new Error(`Exact wallet call simulation failed: ${response.error}`)
  }
  const blocks = array(response.result, "Simulation result")
  if (blocks.length !== 1) {
    throw new Error(
      "Exact wallet call simulation returned an invalid block count."
    )
  }
  const simulatedBlock = record(blocks[0] ?? null, "Simulated block")
  const results = array(simulatedBlock.calls ?? null, "Simulated calls")
  if (results.length !== expectedCalls) {
    throw new Error(
      "Exact wallet call simulation returned an invalid call count."
    )
  }
  let offset = 0
  const baselineValues: SliceWalletSnapshotValues | undefined =
    baseline === undefined
      ? undefined
      : baseline.parse(readResultCall(results, offset, "Wallet state baseline"))
  if (baseline !== undefined) offset += 1
  const executionStartIndex = offset
  offset += calls.length
  const snapshotValues: SliceWalletSnapshotValues | null =
    snapshot === undefined
      ? null
      : snapshot.parse(
          readResultCall(results, offset, "Wallet simulation snapshot")
        )

  const blockNumber = quantity(
    simulatedBlock.number ?? null,
    "Simulated block number"
  )
  if (blockNumber === 0n) {
    throw new Error(
      "Exact wallet call simulation returned an invalid block number."
    )
  }
  const logs: SimulatedLog[] = []
  for (const [index, value] of results
    .slice(executionStartIndex, executionStartIndex + calls.length)
    .entries()) {
    const result = record(value, "Simulated call")
    const transaction = transactions[index]
    if (transaction === undefined) {
      throw new Error("Exact wallet call simulation result is unavailable.")
    }
    const totalGasUsed = quantity(result.gasUsed ?? null, "Simulated call gas")
    if (!succeeded(result.status)) {
      const returnData =
        typeof result.returnData === "string" &&
        isHex(result.returnData, { strict: true })
          ? result.returnData
          : null
      if (
        (returnData === null || returnData === "0x") &&
        totalGasUsed >= transaction.executionGas + transaction.intrinsicGas
      ) {
        throw new Error(
          `Exact wallet call simulation ran out of gas during the ${transaction.label}.`
        )
      }
      const errorValue = result.error
      const error =
        typeof errorValue === "object" &&
        errorValue !== null &&
        !Array.isArray(errorValue)
          ? (errorValue as ProtocolRecord)
          : null
      const message =
        error !== null && typeof error.message === "string"
          ? `: ${error.message}`
          : ""
      const data =
        returnData !== null && returnData !== "0x"
          ? ` (${returnData.slice(0, 130)})`
          : ""
      throw new Error(
        `Exact wallet call simulation reverted during the ${transaction.label}${message}${data}.`
      )
    }
    if (totalGasUsed < transaction.intrinsicGas) {
      throw new Error(
        "Exact wallet call simulation returned invalid gas usage."
      )
    }
    for (const log of array(result.logs ?? null, "Simulated call logs")) {
      const parsed = parseLog(log)
      if (parsed !== null) logs.push(parsed)
    }
  }
  const outcome = getSliceWalletUserOperationSimulationResult(
    logs,
    userOperation.sender
  )
  if (outcome === null) {
    throw new Error(
      "Exact wallet call simulation omitted the UserOperation result."
    )
  }
  if (!outcome.success) {
    throw new Error(
      "Exact wallet call simulation reverted during wallet execution."
    )
  }
  return {
    baselineValues,
    blockNumber,
    gasCost: outcome.gasCost,
    gasUsed: outcome.gasUsed,
    logs,
    snapshotValues
  }
}

/**
 * Replays the exact account calldata that the EntryPoint will execute and
 * discovers affected assets from the simulated logs, then derives exact
 * native/ERC-20 balance and ERC-20 allowance deltas from before/after state
 * snapshots taken inside one atomic pinned-height simulation, and decodes
 * standard ERC-721/ERC-1155 transfer and operator-approval logs. Raw amounts
 * remain base-unit decimal strings.
 */
export const simulateSliceWalletRootUserOperation = async ({
  fetch: fetchImpl = fetch,
  rpcUrl,
  signal,
  userOperation
}: {
  fetch?: typeof fetch
  rpcUrl: string
  signal?: AbortSignal
  userOperation: SliceWalletUnsignedUserOperation
}): Promise<SliceWalletExactCallSimulation> => {
  const calls = decodeSliceWalletRootUserOperationCalls({
    account: userOperation.sender,
    callData: userOperation.callData
  })
  // Pin every simulation to one explicit height and base fee so asset hints
  // and measured deltas always describe the same state even while the chain
  // advances.
  const head = await fetchHeadBlock({ fetchImpl, rpcUrl, signal })
  const blockTag = toHex(head.number)
  const discovery = await runSimulation({
    baseFeePerGas: head.baseFeePerGas,
    blockTag,
    fetchImpl,
    rpcUrl,
    signal,
    userOperation
  })
  const hints = collectSliceWalletSimulationAssetChanges(
    discovery.logs,
    userOperation.sender
  )
  const unresolvedAssetChanges = new Map<
    string,
    SliceWalletUnresolvedAssetChange
  >()
  const markUnresolved = (
    address: Address,
    kind: SliceWalletUnresolvedAssetChange["kind"]
  ) => {
    unresolvedAssetChanges.set(`${address.toLowerCase()}:${kind}`, {
      address,
      kind
    })
  }
  const allApprovals = [...hints.approvals].sort(([left], [right]) =>
    left.localeCompare(right)
  )
  const approvals = new Map(
    allApprovals.slice(0, maximumAllowanceSnapshotReads)
  )
  for (const [, approval] of allApprovals.slice(
    maximumAllowanceSnapshotReads
  )) {
    markUnresolved(approval.token, "allowance")
  }
  const allTokenAddresses = [...hints.tokens.values()].sort((left, right) =>
    left.toLowerCase().localeCompare(right.toLowerCase())
  )
  const tokenAddresses = allTokenAddresses.slice(
    0,
    maximumOptionalSnapshotReads - approvals.size
  )
  const trackedTokens = new Set(
    tokenAddresses.map((address) => address.toLowerCase())
  )
  for (const token of allTokenAddresses.slice(tokenAddresses.length)) {
    markUnresolved(token, "balance")
  }
  // Both plans share the same leading descriptor order, so balances and
  // allowances diff by position; only the after-plan carries token metadata,
  // which cannot change within one simulation.
  const snapshotPlanArgs = {
    account: userOperation.sender,
    approvals,
    tokenAddresses
  } as const
  const replay = await runSimulation({
    baseFeePerGas: head.baseFeePerGas,
    baseline: getSliceWalletSimulationSnapshotPlan({
      ...snapshotPlanArgs,
      includeTokenMetadata: false
    }),
    blockTag,
    fetchImpl,
    rpcUrl,
    signal,
    snapshot: getSliceWalletSimulationSnapshotPlan(snapshotPlanArgs),
    userOperation
  })
  // Providers may report the first simulated block as the tagged number or its
  // successor; either way the shared base state is the tagged height.
  if (
    replay.blockNumber !== head.number &&
    replay.blockNumber !== head.number + 1n
  ) {
    throw new Error(
      "Wallet simulation provider returned unsupported block numbering."
    )
  }
  const before = replay.baselineValues
  const after = replay.snapshotValues
  if (before === undefined || after === null) {
    throw new Error("Wallet simulation snapshot data is unavailable.")
  }
  // The replay re-derives asset activity at the pinned height; activity
  // beyond the discovery hints cannot be measured and must be disclosed.
  const replayHints = collectSliceWalletSimulationAssetChanges(
    replay.logs,
    userOperation.sender
  )
  for (const [key, approval] of replayHints.approvals) {
    if (!approvals.has(key)) markUnresolved(approval.token, "allowance")
  }
  for (const [key, token] of replayHints.tokens) {
    if (!trackedTokens.has(key)) markUnresolved(token, "balance")
  }
  const metadata: ReadonlyMap<string, SliceWalletSnapshotMetadata> =
    after.metadata
  const walletBalanceDelta = after.nativeBalance - before.nativeBalance
  const entryPointDepositDelta =
    after.entryPointDeposit - before.entryPointDeposit
  const walletGasCost =
    userOperation.paymaster === undefined ? replay.gasCost : 0n
  // handleOps may move prefund from the wallet into its EntryPoint deposit.
  // Recombine both balances and add paid gas to isolate execution value only.
  const nativeExecutionDelta =
    walletBalanceDelta + entryPointDepositDelta + walletGasCost
  const balanceDeltas: SliceWalletBalanceDelta[] = []
  if (nativeExecutionDelta !== 0n) {
    balanceDeltas.push({
      amount: nativeExecutionDelta.toString(),
      asset: { decimals: 18, symbol: "ETH", type: "native" }
    })
  }
  for (const token of tokenAddresses) {
    const current = before.tokenBalances.get(token.toLowerCase())
    const simulated = after.tokenBalances.get(token.toLowerCase())
    if (current === undefined || simulated === undefined) {
      markUnresolved(token, "balance")
      continue
    }
    const amount = simulated - current
    if (amount === 0n) continue
    balanceDeltas.push({
      amount: amount.toString(),
      asset: getSliceWalletSimulationErc20Asset(token, metadata)
    })
  }
  const allowanceDeltas: SliceWalletAllowanceDelta[] = [...approvals]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, approval]) => {
      const current = before.allowances.get(key)
      const simulated = after.allowances.get(key)
      if (current === undefined || simulated === undefined) {
        markUnresolved(approval.token, "allowance")
        return []
      }
      const amount = simulated - current
      return amount === 0n
        ? []
        : [
            {
              amount: amount.toString(),
              asset: getSliceWalletSimulationErc20Asset(
                approval.token,
                metadata
              ),
              current: current.toString(),
              simulated: simulated.toString(),
              spender: approval.spender
            }
          ]
    })
  // actualGasUsed spans the whole operation lifecycle, so the comparison must
  // include the paymaster phases for sponsored operations.
  const declaredGasCeiling =
    getSliceWalletUserOperationDeclaredGasCeiling(userOperation)
  return {
    account: userOperation.sender,
    allowanceDeltas,
    balanceDeltas,
    blockNumber: head.number.toString(),
    callDataHash: keccak256(userOperation.callData),
    calls,
    gasBudgetShortfall:
      replay.gasUsed > declaredGasCeiling
        ? {
            declaredGasCeiling: declaredGasCeiling.toString(),
            simulatedGasUsed: replay.gasUsed.toString()
          }
        : null,
    gasUsed: replay.gasUsed.toString(),
    nativeAccounting: {
      actualGasCost: replay.gasCost.toString(),
      entryPointDepositAfter: after.entryPointDeposit.toString(),
      entryPointDepositBefore: before.entryPointDeposit.toString(),
      gasPayer: userOperation.paymaster === undefined ? "wallet" : "paymaster",
      walletBalanceAfter: after.nativeBalance.toString(),
      walletBalanceBefore: before.nativeBalance.toString()
    },
    nftApprovals: [...replayHints.nftApprovals.values()].sort(
      (left, right) =>
        left.collection
          .toLowerCase()
          .localeCompare(right.collection.toLowerCase()) ||
        left.operator.toLowerCase().localeCompare(right.operator.toLowerCase())
    ),
    nftTransfers: replayHints.nftTransfers,
    nftTransfersOmitted: replayHints.nftTransfersOmitted,
    unresolvedAssetChanges: [...unresolvedAssetChanges.values()].sort(
      (left, right) =>
        left.address.toLowerCase().localeCompare(right.address.toLowerCase()) ||
        left.kind.localeCompare(right.kind)
    )
  }
}
