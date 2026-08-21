import {
  type Address,
  concat,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  multicall3Abi,
  padHex,
  toHex
} from "viem"
import {
  sliceWalletEntryPoint,
  sliceWalletSimulationCaller,
  sliceWalletSimulationMulticall,
  sliceWalletSimulationStaticCallProxy
} from "./protocol/constants"
import type { SliceWalletProtocolValue } from "./protocol/index"
import type { SliceWalletSimulationAsset } from "./types"

type ProtocolRecord = { readonly [key: string]: SliceWalletProtocolValue }

type SnapshotDescriptor =
  | { kind: "decimals"; token: Address }
  | { kind: "entry-point-deposit" }
  | { key: string; kind: "allowance" }
  | { kind: "native-balance" }
  | { kind: "symbol"; token: Address }
  | { kind: "token-balance"; token: Address }

export type SliceWalletSnapshotMetadata = {
  address: Address
  decimals: number | null
  symbol: string | null
}

export type SliceWalletSnapshotValues = {
  allowances: Map<string, bigint>
  entryPointDeposit: bigint
  metadata: Map<string, SliceWalletSnapshotMetadata>
  nativeBalance: bigint
  tokenBalances: Map<string, bigint>
}

export const parseSliceWalletSimulationTokenSymbol = (value: string) => {
  const symbol = value.trim()
  return symbol.length > 0 &&
    symbol.length <= 32 &&
    [...symbol].every((character) => {
      // Printable ASCII only: rejects homoglyphs and control characters that
      // could impersonate a different asset in the confirmation frame.
      const code = character.charCodeAt(0)
      return code >= 33 && code <= 126
    })
    ? symbol
    : null
}

type Aggregate3Call = {
  allowFailure: boolean
  callData: Hex
  target: Address
}

export const getSliceWalletSimulationSnapshotPlan = ({
  account,
  approvals,
  includeTokenMetadata = true,
  tokenAddresses
}: {
  account: Address
  approvals: ReadonlyMap<string, { spender: Address; token: Address }>
  // Metadata cannot change within one simulation, so the baseline block skips
  // those reads and reuses the after-block's values.
  includeTokenMetadata?: boolean
  tokenAddresses: readonly Address[]
}) => {
  const descriptors: SnapshotDescriptor[] = [
    { kind: "native-balance" },
    { kind: "entry-point-deposit" },
    ...tokenAddresses.flatMap((token) => [
      { kind: "token-balance" as const, token },
      ...(includeTokenMetadata
        ? [
            { kind: "decimals" as const, token },
            { kind: "symbol" as const, token }
          ]
        : [])
    ]),
    ...[...approvals].map(([key]) => ({ key, kind: "allowance" as const }))
  ]
  // Every read is routed through the injected static-call forwarder so a
  // hostile token cannot mutate state while it is being measured. The
  // forwarder's calldata layout is <32-byte left-padded inner target> ++
  // <original call data>.
  const staticRead = (innerTarget: Address, callData: Hex): Aggregate3Call => ({
    allowFailure: true,
    callData: concat([padHex(innerTarget, { size: 32 }), callData]),
    target: sliceWalletSimulationStaticCallProxy
  })
  const calls = descriptors.map((descriptor): Aggregate3Call => {
    if (descriptor.kind === "native-balance") {
      return {
        allowFailure: false,
        callData: encodeFunctionData({
          abi: multicall3Abi,
          args: [account],
          functionName: "getEthBalance"
        }),
        target: sliceWalletSimulationMulticall
      }
    }
    if (descriptor.kind === "entry-point-deposit") {
      return {
        allowFailure: false,
        callData: encodeFunctionData({
          abi: sliceWalletEntryPoint.abi,
          args: [account],
          functionName: "balanceOf"
        }),
        target: sliceWalletEntryPoint.address
      }
    }
    if (descriptor.kind === "allowance") {
      const approval = approvals.get(descriptor.key)
      if (approval === undefined) {
        throw new Error(
          "Wallet simulation allowance descriptor is unavailable."
        )
      }
      return staticRead(
        approval.token,
        encodeFunctionData({
          abi: erc20Abi,
          args: [account, approval.spender],
          functionName: "allowance"
        })
      )
    }
    return staticRead(
      descriptor.token,
      encodeFunctionData({
        abi: erc20Abi,
        functionName:
          descriptor.kind === "token-balance"
            ? "balanceOf"
            : descriptor.kind === "decimals"
              ? "decimals"
              : "symbol",
        ...(descriptor.kind === "token-balance" ? { args: [account] } : {})
      })
    )
  })
  return {
    call: {
      data: encodeFunctionData({
        abi: multicall3Abi,
        args: [calls],
        functionName: "aggregate3"
      }),
      from: sliceWalletSimulationCaller,
      gas: toHex(10_000_000n),
      to: sliceWalletSimulationMulticall
    } satisfies ProtocolRecord,
    parse: (data: Hex): SliceWalletSnapshotValues => {
      const results = decodeFunctionResult({
        abi: multicall3Abi,
        data,
        functionName: "aggregate3"
      })
      if (results.length !== descriptors.length) {
        throw new Error("Wallet simulation snapshot returned an invalid count.")
      }
      const values: SliceWalletSnapshotValues = {
        allowances: new Map(),
        entryPointDeposit: 0n,
        metadata: new Map(
          tokenAddresses.map((address) => [
            address.toLowerCase(),
            { address, decimals: null, symbol: null }
          ])
        ),
        nativeBalance: 0n,
        tokenBalances: new Map()
      }
      for (const [index, descriptor] of descriptors.entries()) {
        const result = results[index]
        if (result === undefined) {
          throw new Error("Wallet simulation snapshot result is unavailable.")
        }
        const required =
          descriptor.kind === "native-balance" ||
          descriptor.kind === "entry-point-deposit"
        if (!result.success && required) {
          throw new Error("Wallet simulation snapshot read failed.")
        }
        if (!result.success) continue
        const entry =
          descriptor.kind === "decimals" || descriptor.kind === "symbol"
            ? values.metadata.get(descriptor.token.toLowerCase())
            : undefined
        try {
          if (descriptor.kind === "native-balance") {
            values.nativeBalance = decodeFunctionResult({
              abi: multicall3Abi,
              data: result.returnData,
              functionName: "getEthBalance"
            })
          } else if (descriptor.kind === "entry-point-deposit") {
            values.entryPointDeposit = decodeFunctionResult({
              abi: sliceWalletEntryPoint.abi,
              data: result.returnData,
              functionName: "balanceOf"
            })
          } else if (descriptor.kind === "token-balance") {
            values.tokenBalances.set(
              descriptor.token.toLowerCase(),
              decodeFunctionResult({
                abi: erc20Abi,
                data: result.returnData,
                functionName: "balanceOf"
              })
            )
          } else if (descriptor.kind === "allowance") {
            values.allowances.set(
              descriptor.key,
              decodeFunctionResult({
                abi: erc20Abi,
                data: result.returnData,
                functionName: "allowance"
              })
            )
          } else if (entry !== undefined) {
            if (descriptor.kind === "decimals") {
              entry.decimals = decodeFunctionResult({
                abi: erc20Abi,
                data: result.returnData,
                functionName: "decimals"
              })
            } else {
              entry.symbol = parseSliceWalletSimulationTokenSymbol(
                decodeFunctionResult({
                  abi: erc20Abi,
                  data: result.returnData,
                  functionName: "symbol"
                })
              )
            }
          }
        } catch {
          if (required) {
            throw new Error("Wallet simulation snapshot read failed.")
          }
        }
      }
      return values
    }
  }
}

export const getSliceWalletSimulationErc20Asset = (
  address: Address,
  metadata: ReadonlyMap<string, SliceWalletSnapshotMetadata>
): Extract<SliceWalletSimulationAsset, { type: "erc20" }> => ({
  address,
  decimals: metadata.get(address.toLowerCase())?.decimals ?? null,
  symbol: metadata.get(address.toLowerCase())?.symbol ?? null,
  type: "erc20"
})
