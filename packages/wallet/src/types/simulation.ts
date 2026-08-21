import type { Address, Hex } from "viem"
import type { WalletCall } from "../protocol/policy"

export type SliceWalletSimulationAsset =
  | {
      decimals: 18
      symbol: "ETH"
      type: "native"
    }
  | {
      address: Address
      decimals: number | null
      symbol: string | null
      type: "erc20"
    }

export type SliceWalletBalanceDelta = {
  asset: SliceWalletSimulationAsset
  /** Signed execution delta in base units, excluding EntryPoint gas accounting. */
  amount: string
}

export type SliceWalletAllowanceDelta = {
  asset: Extract<SliceWalletSimulationAsset, { type: "erc20" }>
  /** Signed base-unit delta. */
  amount: string
  /** Exact base-unit allowance at the simulated block boundary. */
  current: string
  spender: Address
  /** Exact base-unit allowance after the simulated calls. */
  simulated: string
}

export type SliceWalletUnresolvedAssetChange = {
  address: Address
  kind: "allowance" | "balance"
}

export type SliceWalletNftTransfer = {
  /** Exact ERC-1155 quantity, or 1 for ERC-721. */
  amount: string
  collection: Address
  direction: "in" | "out" | "self"
  from: Address
  standard: "erc721" | "erc1155"
  to: Address
  tokenId: string
}

export type SliceWalletNftApprovalChange = {
  approved: boolean
  collection: Address
  operator: Address
}

export type SliceWalletGasBudgetShortfall = {
  /**
   * Declared per-operation ceilings (preVerification + verification + call)
   * that bundlers and the EntryPoint enforce at inclusion.
   */
  declaredGasCeiling: string
  /** Gas the EntryPoint reported for the whole simulated operation. */
  simulatedGasUsed: string
}

export type SliceWalletExactCallSimulation = {
  account: Address
  allowanceDeltas: readonly SliceWalletAllowanceDelta[]
  balanceDeltas: readonly SliceWalletBalanceDelta[]
  /** Parent-state block used by the simulation. */
  blockNumber: string
  callDataHash: Hex
  calls: readonly WalletCall[]
  /**
   * Non-null when the operation consumed more gas than its declared ceilings
   * allow, which passes simulation but fails inclusion.
   */
  gasBudgetShortfall: SliceWalletGasBudgetShortfall | null
  gasUsed: string
  /** Exact native accounting for a deployed account's EntryPoint operation. */
  nativeAccounting: SliceWalletNativeAccounting | null
  nftApprovals: readonly SliceWalletNftApprovalChange[]
  nftTransfers: readonly SliceWalletNftTransfer[]
  /** Collectible transfers beyond the bounded display set. */
  nftTransfersOmitted: number
  /** Token-like log emitters whose state could not be measured safely. */
  unresolvedAssetChanges: readonly SliceWalletUnresolvedAssetChange[]
}

export type SliceWalletNativeAccounting = {
  /** Gas charged by EntryPoint for the simulated UserOperation. */
  actualGasCost: string
  entryPointDepositAfter: string
  entryPointDepositBefore: string
  gasPayer: "paymaster" | "wallet"
  walletBalanceAfter: string
  walletBalanceBefore: string
}
