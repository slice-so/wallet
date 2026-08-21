import { describe, expect, it, mock } from "bun:test"
import {
  type Address,
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  type Hex,
  keccak256,
  multicall3Abi,
  padHex,
  stringToHex,
  toBytes,
  toHex,
  zeroAddress
} from "viem"
import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletSimulationCaller,
  sliceWalletSimulationMulticall,
  sliceWalletSimulationStaticCallCode,
  sliceWalletSimulationStaticCallProxy,
  sliceWalletSimulationValidatorCode
} from "./protocol/constants"
import { simulateSliceWalletRootUserOperation } from "./simulation"

const account = "0x1000000000000000000000000000000000000001"
const recipient = "0x2000000000000000000000000000000000000002"
const token = "0x3000000000000000000000000000000000000003"
const spender = "0x4000000000000000000000000000000000000004"
const untrackedToken = "0x5000000000000000000000000000000000000005"
const factory = "0xa00000000000000000000000000000000000000a"
const nft = "0x6000000000000000000000000000000000000006"
const operator = "0x7000000000000000000000000000000000000007"
const transferTopic = keccak256(
  stringToHex("Transfer(address,address,uint256)")
)
const approvalTopic = keccak256(
  stringToHex("Approval(address,address,uint256)")
)
const approvalForAllTopic = keccak256(
  stringToHex("ApprovalForAll(address,address,bool)")
)
const nativeEmitter = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
const userOperationEventTopic = keccak256(
  stringToHex(
    "UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)"
  )
)

const transactionIntrinsicGas = (data: Hex) =>
  toBytes(data).reduce((gas, byte) => gas + (byte === 0 ? 4n : 16n), 21_000n)

const indexedAddress = (address: Address) => padHex(address, { size: 32 })
const log = (
  address: Address,
  topic: Hex,
  from: Address,
  to: Address,
  amount: bigint
) => ({
  address,
  data: toHex(amount, { size: 32 }),
  topics: [topic, indexedAddress(from), indexedAddress(to)]
})

const userOperationEvent = (
  success: boolean,
  gasUsed: bigint,
  gasCost = 3n
) => ({
  address: sliceWalletEntryPoint.address,
  data: encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "bool" },
      { type: "uint256" },
      { type: "uint256" }
    ],
    [0n, success, gasCost, gasUsed]
  ),
  topics: [
    userOperationEventTopic,
    toHex(1n, { size: 32 }),
    indexedAddress(account),
    indexedAddress(zeroAddress)
  ]
})

const callData = encodeFunctionData({
  abi: [
    {
      inputs: [
        { name: "mode", type: "bytes32" },
        { name: "executionCalldata", type: "bytes" }
      ],
      name: "execute",
      outputs: [],
      stateMutability: "payable",
      type: "function"
    }
  ],
  args: [
    `0x${"00".repeat(32)}`,
    concat([recipient, toHex(1n, { size: 32 }), "0x12345678"])
  ],
  functionName: "execute"
})

const userOperation = {
  callData,
  callGasLimit: 1_000_000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  nonce: 0n,
  preVerificationGas: 1n,
  sender: account,
  verificationGasLimit: 2_000_000n
} as const

type SimulationRequest = {
  method: string
  params: readonly [
    {
      blockStateCalls: readonly [
        {
          blockOverrides?: object
          calls: readonly { data?: Hex }[]
          stateOverrides?: object
        }
      ]
    },
    string
  ]
}

type Aggregate3Entry = { returnData: Hex; success: boolean }

const aggregate3Result = (entries: readonly Aggregate3Entry[]) =>
  encodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    result: entries.map(({ returnData, success }) => ({
      returnData,
      success
    }))
  })

const entry = (returnData: Hex): Aggregate3Entry => ({
  returnData,
  success: true
})
const failedEntry = (): Aggregate3Entry => ({
  returnData: "0x",
  success: false
})

const encodedErc20 = (
  descriptor:
    | { name: "allowance" | "balanceOf"; value: bigint }
    | { name: "decimals"; value: number }
    | { name: "symbol"; value: string }
): Hex => {
  if (descriptor.name === "decimals") {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: "decimals",
      result: descriptor.value
    })
  }
  if (descriptor.name === "symbol") {
    return encodeFunctionResult({
      abi: erc20Abi,
      functionName: "symbol",
      result: descriptor.value
    })
  }
  return encodeFunctionResult({
    abi: erc20Abi,
    functionName: descriptor.name,
    result: descriptor.value
  })
}

// Snapshot descriptor order: native balance, EntryPoint deposit, then per
// tracked token a balance read (plus decimals and symbol in the after-plan
// only), then one read per allowance.
const walletSnapshot = ({
  allowance,
  deposit,
  metadataReads = true,
  native,
  tokenReads
}: {
  allowance: bigint | null
  deposit: bigint
  metadataReads?: boolean
  native: bigint
  // Null metadata reads model tokens whose ERC-20 metadata reverts.
  tokenReads: readonly {
    balance: bigint | null
    decimals: number | null
    symbol: string | null
  }[]
}) => [
  entry(
    encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      result: native
    })
  ),
  entry(
    encodeFunctionResult({
      abi: sliceWalletEntryPoint.abi,
      functionName: "balanceOf",
      result: deposit
    })
  ),
  ...tokenReads.flatMap<Aggregate3Entry>(({ balance, decimals, symbol }) => [
    balance === null
      ? failedEntry()
      : entry(encodedErc20({ name: "balanceOf", value: balance })),
    ...(metadataReads
      ? [
          decimals === null
            ? failedEntry()
            : entry(encodedErc20({ name: "decimals", value: decimals })),
          symbol === null
            ? failedEntry()
            : entry(encodedErc20({ name: "symbol", value: symbol }))
        ]
      : [])
  ]),
  ...(allowance === null
    ? []
    : [entry(encodedErc20({ name: "allowance", value: allowance }))])
]

const assetDiscoveryLogs = (options?: { excludeToken?: boolean }): object[] => [
  log(nativeEmitter, transferTopic, account, recipient, 10n),
  ...(options?.excludeToken === true
    ? []
    : [
        log(token, transferTopic, account, recipient, 100n),
        log(token, transferTopic, recipient, account, 25n),
        log(token, approvalTopic, account, spender, 500n),
        log(untrackedToken, transferTopic, account, recipient, 1n)
      ]),
  {
    address: nft,
    data: "0x",
    topics: [
      transferTopic,
      indexedAddress(recipient),
      indexedAddress(account),
      toHex(42n, { size: 32 })
    ]
  },
  {
    address: nft,
    data: toHex(1n, { size: 32 }),
    topics: [
      approvalForAllTopic,
      indexedAddress(account),
      indexedAddress(operator)
    ]
  }
]

const headBlockResponse = (head: bigint) =>
  Response.json({
    id: 1,
    jsonrpc: "2.0",
    result: {
      baseFeePerGas: toHex(7n),
      number: toHex(head)
    }
  })

const respondToSimulation = async (
  body: SimulationRequest,
  executionLogs: readonly object[],
  snapshots: readonly (() => Hex)[] | null
) => {
  const calls = body.params[0].blockStateCalls[0]?.calls ?? []
  const executionIndex = calls.length === 1 ? 0 : 1
  const data = calls[executionIndex]?.data ?? "0x"
  const readCall = (index: number) => ({
    gasUsed: "0x100",
    logs: [],
    returnData: snapshots?.[index]?.() ?? "0x",
    status: "0x1"
  })
  const executionCall = {
    gasUsed: toHex(transactionIntrinsicGas(data) + 0x1234n),
    logs: [...executionLogs, userOperationEvent(true, 0x1234n)],
    returnData: "0x",
    status: "0x01"
  }
  return Response.json({
    id: 1,
    jsonrpc: "2.0",
    result: [
      {
        // One simulated block whose sequential calls share its number,
        // timestamp, and base fee.
        calls:
          calls.length === 1
            ? [executionCall]
            : [readCall(0), executionCall, readCall(1)],
        number: toHex(BigInt(body.params[1]) + 1n)
      }
    ]
  })
}

describe("exact wallet call simulation", () => {
  it("derives exact wallet deltas from one pinned-height atomic replay", async () => {
    const bodies: SimulationRequest[] = []
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        bodies.push(body)
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(256n)
        }
        return respondToSimulation(body, assetDiscoveryLogs(), [
          () =>
            aggregate3Result(
              walletSnapshot({
                allowance: 100n,
                deposit: 1_000n,
                // The baseline plan skips invariant metadata reads.
                metadataReads: false,
                native: 1_000_000n,
                tokenReads: [
                  { balance: 1_000n, decimals: 6, symbol: "TEST" },
                  { balance: null, decimals: null, symbol: null }
                ]
              })
            ),
          () =>
            aggregate3Result(
              walletSnapshot({
                allowance: 500n,
                deposit: 1_000n,
                // Wallet sent 10 wei and paid 3 gas prefund; the unused
                // prefund remains in the EntryPoint gas reserve.
                native: 999_987n,
                tokenReads: [
                  { balance: 925n, decimals: 6, symbol: "TEST" },
                  { balance: null, decimals: null, symbol: null }
                ]
              })
            )
        ])
      }),
      { preconnect: fetch.preconnect }
    )

    const result = await simulateSliceWalletRootUserOperation({
      fetch: fetchImpl,
      rpcUrl: "https://id.slice.so/v1/rpc/8453",
      userOperation
    })

    expect(result).toEqual({
      account,
      allowanceDeltas: [
        {
          amount: "400",
          asset: {
            address: token,
            decimals: 6,
            symbol: "TEST",
            type: "erc20"
          },
          current: "100",
          simulated: "500",
          spender
        }
      ],
      balanceDeltas: [
        {
          amount: "-10",
          asset: { decimals: 18, symbol: "ETH", type: "native" }
        },
        {
          amount: "-75",
          asset: {
            address: token,
            decimals: 6,
            symbol: "TEST",
            type: "erc20"
          }
        }
      ],
      blockNumber: "256",
      callDataHash: keccak256(callData),
      calls: [{ data: "0x12345678", to: recipient, value: 1n }],
      gasBudgetShortfall: null,
      gasUsed: "4660",
      nativeAccounting: {
        actualGasCost: "3",
        entryPointDepositAfter: "1000",
        entryPointDepositBefore: "1000",
        gasPayer: "wallet",
        walletBalanceAfter: "999987",
        walletBalanceBefore: "1000000"
      },
      nftApprovals: [{ approved: true, collection: nft, operator }],
      nftTransfers: [
        {
          amount: "1",
          collection: nft,
          direction: "in",
          from: recipient,
          standard: "erc721",
          to: account,
          tokenId: "42"
        }
      ],
      nftTransfersOmitted: 0,
      unresolvedAssetChanges: [{ address: untrackedToken, kind: "balance" }]
    })
    expect(bodies).toHaveLength(3)
    expect(bodies[0]).toMatchObject({
      method: "eth_getBlockByNumber",
      params: ["latest", false]
    })
    const discoveryRequest = bodies[1]
    if (discoveryRequest === undefined) throw new Error("Missing discovery.")
    expect(discoveryRequest.params[0].blockStateCalls).toHaveLength(1)
    expect(discoveryRequest.params[0].blockStateCalls[0]).toMatchObject({
      blockOverrides: { baseFeePerGas: toHex(7n) },
      calls: [expect.objectContaining({ to: sliceWalletEntryPoint.address })]
    })
    expect(discoveryRequest.params[1]).toBe(toHex(256n))
    const replayRequest = bodies[2]
    if (replayRequest === undefined) throw new Error("Missing replay.")
    expect(replayRequest.params[1]).toBe(toHex(256n))
    const replayBlock = replayRequest.params[0].blockStateCalls[0]
    const replayCalls = replayBlock?.calls ?? []
    expect(replayCalls).toHaveLength(3)
    // Baseline and after-reads are identical bounded Multicall3 snapshots
    // flanking the execution call inside the same simulated block.
    for (const index of [0, 2]) {
      expect(replayCalls[index]).toMatchObject({
        from: sliceWalletSimulationCaller,
        to: sliceWalletSimulationMulticall
      })
    }
    // Both injected overrides must be present with their exact code: the
    // worker whitelist rejects anything else.
    expect(replayBlock).toEqual({
      blockOverrides: { baseFeePerGas: toHex(7n) },
      calls: replayCalls,
      stateOverrides: {
        [sliceWalletKernelAddresses.webAuthnRootValidator]: {
          code: sliceWalletSimulationValidatorCode
        },
        [sliceWalletSimulationStaticCallProxy]: {
          code: sliceWalletSimulationStaticCallCode
        }
      }
    })
    const discoveryBlock = discoveryRequest.params[0].blockStateCalls[0]
    expect(discoveryBlock?.stateOverrides).toEqual({
      [sliceWalletKernelAddresses.webAuthnRootValidator]: {
        code: sliceWalletSimulationValidatorCode
      },
      [sliceWalletSimulationStaticCallProxy]: {
        code: sliceWalletSimulationStaticCallCode
      }
    })
    const decoded = decodeFunctionData({
      abi: sliceWalletEntryPoint.abi,
      data: replayCalls[1]?.data ?? "0x"
    })
    if (decoded.functionName !== "handleOps") {
      throw new Error("Expected a handleOps simulation.")
    }
    expect(decoded.args[0]).toHaveLength(1)
    expect(decoded.args[0][0]).toMatchObject({
      callData,
      initCode: "0x",
      sender: account,
      signature: "0x"
    })
    expect(decoded.args[1]).toBe(sliceWalletSimulationCaller)
  })

  it("discloses replay activity that discovery did not hint", async () => {
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(9n)
        }
        // Discovery misses a token transfer that the pinned replay observes.
        const calls = body.params[0].blockStateCalls[0]?.calls ?? []
        const logs =
          calls.length === 1
            ? assetDiscoveryLogs({ excludeToken: true })
            : assetDiscoveryLogs()
        return respondToSimulation(body, logs, [
          () =>
            aggregate3Result(
              walletSnapshot({
                allowance: null,
                deposit: 0n,
                native: 5n,
                tokenReads: []
              })
            ),
          () =>
            aggregate3Result(
              walletSnapshot({
                allowance: null,
                deposit: 0n,
                native: 5n,
                tokenReads: []
              })
            )
        ])
      }),
      { preconnect: fetch.preconnect }
    )

    const result = await simulateSliceWalletRootUserOperation({
      fetch: fetchImpl,
      rpcUrl: "https://id.slice.so/v1/rpc/8453",
      userOperation
    })

    expect(result.unresolvedAssetChanges).toContainEqual({
      address: token,
      kind: "balance"
    })
    expect(result.unresolvedAssetChanges).toContainEqual({
      address: untrackedToken,
      kind: "balance"
    })
    expect(result.unresolvedAssetChanges).toContainEqual({
      address: token,
      kind: "allowance"
    })
  })

  it("simulates counterfactual deployment through EntryPoint validation and execution", async () => {
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(100n)
        }
        const calls = body.params[0].blockStateCalls[0]?.calls ?? []
        const executionIndex = calls.length === 1 ? 0 : 1
        const data = calls[executionIndex]?.data ?? "0x"
        const decoded = decodeFunctionData({
          abi: sliceWalletEntryPoint.abi,
          data
        })
        if (decoded.functionName !== "handleOps") {
          throw new Error("Expected a handleOps simulation.")
        }
        expect(calls).toHaveLength(executionIndex === 0 ? 1 : 3)
        expect(calls[executionIndex]).toMatchObject({
          gas: toHex(50_000_000n),
          to: sliceWalletEntryPoint.address
        })
        expect(decoded.args[0][0]).toMatchObject({
          callData,
          initCode: concat([factory, "0x5678"]),
          sender: account,
          signature: "0x"
        })
        const executionCall = {
          gasUsed: toHex(transactionIntrinsicGas(data) + 0x30n),
          logs: [userOperationEvent(true, 0x30n)],
          status: "0x1"
        }
        if (calls.length === 1) {
          return Response.json({
            id: 1,
            jsonrpc: "2.0",
            result: [
              {
                calls: [executionCall],
                number: toHex(BigInt(body.params[1]) + 1n)
              }
            ]
          })
        }
        // The wallet is endowed with 100 wei before this operation and pays
        // 3 wei of gas, so execution itself moves no value.
        const fixedReads = (native: bigint) =>
          aggregate3Result(
            walletSnapshot({
              allowance: null,
              deposit: 0n,
              native,
              tokenReads: []
            })
          )
        const readCall = (native: bigint) => ({
          gasUsed: "0x100",
          logs: [],
          returnData: fixedReads(native),
          status: "0x1"
        })
        return Response.json({
          id: 1,
          jsonrpc: "2.0",
          result: [
            {
              calls: [readCall(100n), executionCall, readCall(97n)],
              number: toHex(BigInt(body.params[1]) + 1n)
            }
          ]
        })
      }),
      { preconnect: fetch.preconnect }
    )

    const result = await simulateSliceWalletRootUserOperation({
      fetch: fetchImpl,
      rpcUrl: "https://id.slice.so/v1/rpc/8453",
      userOperation: { ...userOperation, factory, factoryData: "0x5678" }
    })

    expect(result.gasUsed).toBe("48")
    expect(result.balanceDeltas).toEqual([])
    expect(result.nativeAccounting).toMatchObject({
      actualGasCost: "3",
      gasPayer: "wallet"
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("warns when the operation exceeds its declared gas ceilings", async () => {
    const bodies: SimulationRequest[] = []
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        bodies.push(body)
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(9n)
        }
        const calls = body.params[0].blockStateCalls[0]?.calls ?? []
        const executionIndex = calls.length === 1 ? 0 : 1
        const data = calls[executionIndex]?.data ?? "0x"
        const totalGas = transactionIntrinsicGas(data) + 0x1234n
        const executionCall = {
          gasUsed: toHex(totalGas),
          logs: [userOperationEvent(true, totalGas)],
          returnData: "0x",
          status: "0x1"
        }
        if (calls.length === 1) {
          return Response.json({
            id: 1,
            jsonrpc: "2.0",
            result: [
              {
                calls: [executionCall],
                number: "0xa"
              }
            ]
          })
        }
        const fixedReads = () =>
          aggregate3Result(
            walletSnapshot({
              allowance: null,
              deposit: 0n,
              native: 97n,
              tokenReads: []
            })
          )
        const readCall = () => ({
          gasUsed: "0x10",
          logs: [],
          returnData: fixedReads(),
          status: "0x1"
        })
        return Response.json({
          id: 1,
          jsonrpc: "2.0",
          result: [
            {
              calls: [readCall(), executionCall, readCall()],
              number: "0xa"
            }
          ]
        })
      }),
      { preconnect: fetch.preconnect }
    )

    const result = await simulateSliceWalletRootUserOperation({
      fetch: fetchImpl,
      rpcUrl: "https://id.slice.so/v1/rpc/8453",
      userOperation: {
        ...userOperation,
        callGasLimit: 1n,
        preVerificationGas: 1n,
        verificationGasLimit: 1n
      }
    })

    const discoveryRequest = bodies[1]
    if (discoveryRequest === undefined) throw new Error("Missing discovery.")
    const simulatedGasUsed =
      transactionIntrinsicGas(
        discoveryRequest.params[0].blockStateCalls[0]?.calls[0]?.data ?? "0x"
      ) + 0x1234n
    expect(result.gasBudgetShortfall).toEqual({
      declaredGasCeiling: "3",
      simulatedGasUsed: simulatedGasUsed.toString()
    })
  })

  it("bounds measured reads and discloses the overflow as unresolved", async () => {
    const address = (index: number) =>
      `0x${index.toString(16).padStart(40, "0")}` as Address
    const tokenCount = 70
    const approvalCount = 40
    // Sorted keys keep the first 32 approvals and 64-32=32 tokens tracked.
    const logs = [
      ...Array.from({ length: tokenCount }, (_, index) =>
        log(
          address(index + 1),
          transferTopic,
          account,
          recipient,
          BigInt(index + 1)
        )
      ),
      ...Array.from({ length: approvalCount }, (_, index) =>
        log(address(index + 1), approvalTopic, account, address(index + 1), 1n)
      )
    ]
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(9n)
        }
        return respondToSimulation(body, logs, [
          () => {
            const calls = body.params[0].blockStateCalls[0]?.calls ?? []
            const decoded = decodeFunctionData({
              abi: multicall3Abi,
              data: calls[0]?.data ?? "0x"
            })
            if (decoded.functionName !== "aggregate3") {
              throw new Error("Expected an aggregate3 baseline.")
            }
            // 2 fixed + 32 balances + 32 allowances.
            expect(decoded.args[0]).toHaveLength(66)
            return aggregate3Result([
              entry(
                encodeFunctionResult({
                  abi: multicall3Abi,
                  functionName: "getEthBalance",
                  result: 5n
                })
              ),
              entry(
                encodeFunctionResult({
                  abi: sliceWalletEntryPoint.abi,
                  functionName: "balanceOf",
                  result: 0n
                })
              ),
              ...Array.from({ length: 32 }, (_, index) =>
                entry(
                  encodedErc20({ name: "balanceOf", value: BigInt(index + 1) })
                )
              ),
              ...Array.from({ length: 32 }, () =>
                entry(encodedErc20({ name: "allowance", value: 0n }))
              )
            ])
          },
          () => {
            const calls = body.params[0].blockStateCalls[0]?.calls ?? []
            const decoded = decodeFunctionData({
              abi: multicall3Abi,
              data: calls[2]?.data ?? "0x"
            })
            if (decoded.functionName !== "aggregate3") {
              throw new Error("Expected an aggregate3 snapshot.")
            }
            // 2 fixed + 32 tokens × 3 reads + 32 allowances.
            expect(decoded.args[0]).toHaveLength(130)
            return aggregate3Result([
              entry(
                encodeFunctionResult({
                  abi: multicall3Abi,
                  functionName: "getEthBalance",
                  result: 5n
                })
              ),
              entry(
                encodeFunctionResult({
                  abi: sliceWalletEntryPoint.abi,
                  functionName: "balanceOf",
                  result: 0n
                })
              ),
              ...Array.from({ length: 32 }, (_, index) => [
                entry(
                  encodedErc20({
                    name: "balanceOf",
                    value: BigInt(index + 2)
                  })
                ),
                entry(encodedErc20({ name: "decimals", value: 18 })),
                entry(encodedErc20({ name: "symbol", value: "T" }))
              ]).flat(),
              ...Array.from({ length: 32 }, () =>
                entry(encodedErc20({ name: "allowance", value: 1n }))
              )
            ])
          }
        ])
      }),
      { preconnect: fetch.preconnect }
    )

    const result = await simulateSliceWalletRootUserOperation({
      fetch: fetchImpl,
      rpcUrl: "https://id.slice.so/v1/rpc/8453",
      userOperation
    })

    expect(result.balanceDeltas).toHaveLength(33)
    expect(result.allowanceDeltas).toHaveLength(32)
    expect(result.unresolvedAssetChanges).toHaveLength(46)
    expect(
      result.unresolvedAssetChanges.filter(({ kind }) => kind === "balance")
    ).toHaveLength(38)
    expect(
      result.unresolvedAssetChanges.filter(({ kind }) => kind === "allowance")
    ).toHaveLength(8)
  })

  it("threads the caller's abort signal into every provider request", async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        signals.push(init?.signal)
        throw new TypeError("Failed to fetch")
      }),
      { preconnect: fetch.preconnect }
    )
    const controller = new AbortController()

    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: fetchImpl,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        signal: controller.signal,
        userOperation
      })
    ).rejects.toThrow("The wallet simulation service is unreachable.")

    expect(signals.length).toBeGreaterThan(0)
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal)
    }
  })

  it("rejects a failed UserOperation when handleOps itself succeeds", async () => {
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(9n)
        }
        return Response.json({
          id: 1,
          jsonrpc: "2.0",
          result: [
            {
              calls: [
                {
                  gasUsed: toHex(
                    transactionIntrinsicGas(
                      body.params[0].blockStateCalls[0]?.calls[0]?.data ?? "0x"
                    )
                  ),
                  logs: [userOperationEvent(false, 0x1234n)],
                  returnData: "0x",
                  status: "0x1"
                }
              ],
              number: "0xa"
            }
          ]
        })
      }),
      { preconnect: fetch.preconnect }
    )

    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: fetchImpl,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow(
      "Exact wallet call simulation reverted during wallet execution."
    )
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("identifies a wallet operation that consumes its complete gas envelope", async () => {
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(9n)
        }
        return Response.json({
          id: 1,
          jsonrpc: "2.0",
          result: [
            {
              calls: [
                {
                  error: { code: -3200, message: "execution failed" },
                  gasUsed: toHex(50_000_000n),
                  logs: [],
                  returnData: "0x",
                  status: "0x0"
                }
              ],
              number: "0xa"
            }
          ]
        })
      }),
      { preconnect: fetch.preconnect }
    )

    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: fetchImpl,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation: { ...userOperation, factory, factoryData: "0x5678" }
      })
    ).rejects.toThrow(
      "Exact wallet call simulation ran out of gas during the wallet operation."
    )
  })

  it("rejects a reverting exact call", async () => {
    const fetchImpl = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as SimulationRequest
        if (body.method === "eth_getBlockByNumber") {
          return headBlockResponse(9n)
        }
        return Response.json({
          id: 1,
          jsonrpc: "2.0",
          result: [
            {
              calls: [
                {
                  gasUsed: "0x20",
                  logs: [],
                  returnData: "0xdeadbeef",
                  status: "0x0"
                }
              ],
              number: "0xa"
            }
          ]
        })
      }),
      { preconnect: fetch.preconnect }
    )

    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: fetchImpl,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation: { ...userOperation, factory, factoryData: "0x5678" }
      })
    ).rejects.toThrow(
      "Exact wallet call simulation reverted during the wallet operation (0xdeadbeef)."
    )
  })

  it("maps provider and network failures to actionable messages", async () => {
    const unreachable = Object.assign(
      mock(async () => {
        throw new TypeError("Failed to fetch")
      }),
      { preconnect: fetch.preconnect }
    )
    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: unreachable,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow("The wallet simulation service is unreachable.")

    const degraded = Object.assign(
      mock(async () => new Response(null, { status: 503 })),
      { preconnect: fetch.preconnect }
    )
    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: degraded,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow(
      "The wallet simulation service is temporarily unavailable (HTTP 503)."
    )

    const timedOut = Object.assign(
      mock(async () => {
        throw new DOMException("The operation was aborted.", "TimeoutError")
      }),
      { preconnect: fetch.preconnect }
    )
    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: timedOut,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow("The wallet simulation service took too long to respond.")

    const malformedBody = Object.assign(
      mock(async () => new Response("<html>502</html>", { status: 200 })),
      { preconnect: fetch.preconnect }
    )
    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: malformedBody,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow(
      "The wallet simulation service returned an invalid response."
    )
  })

  it("fails when the head block does not report a usable base fee", async () => {
    const headWithoutBaseFee = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string }
        if (body.method === "eth_getBlockByNumber") {
          return Response.json({
            id: 1,
            jsonrpc: "2.0",
            result: { number: toHex(9n) }
          })
        }
        throw new Error("The simulation must fail before any replay.")
      }),
      { preconnect: fetch.preconnect }
    )
    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: headWithoutBaseFee,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow(
      "The simulation provider did not report a base fee for the head block."
    )

    const headWithMalformedBaseFee = Object.assign(
      mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string }
        if (body.method === "eth_getBlockByNumber") {
          return Response.json({
            id: 1,
            jsonrpc: "2.0",
            result: { baseFeePerGas: "seven wei", number: toHex(9n) }
          })
        }
        throw new Error("The simulation must fail before any replay.")
      }),
      { preconnect: fetch.preconnect }
    )
    await expect(
      simulateSliceWalletRootUserOperation({
        fetch: headWithMalformedBaseFee,
        rpcUrl: "https://id.slice.so/v1/rpc/8453",
        userOperation
      })
    ).rejects.toThrow(
      "The simulation provider did not report a base fee for the head block."
    )
  })
})
