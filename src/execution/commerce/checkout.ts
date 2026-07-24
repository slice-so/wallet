import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  isAddress,
  maxUint256
} from "viem"
import {
  assertWalletCallsMatchPolicy,
  type WalletCall,
  type WalletPolicyDescriptor
} from "../../policy"
import type {
  SliceCheckoutAllowanceTotal,
  SliceCheckoutSpendIntent
} from "../../types/commerce"
import { getProductsModuleAddress } from "../generated/commerceFacts"
import { getSliceCheckoutSpendIntentFromCalls } from "../utils/sliceCallPolicy"
import { sliceKernelERC20AllowanceGuardAddress } from "../utils/sliceKernelAddresses"

const erc20AllowanceGuardAbi = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "expected", type: "uint256" }
    ],
    name: "assertAllowance",
    outputs: [],
    stateMutability: "view",
    type: "function"
  }
] as const

export const buildSliceCheckoutAllowanceEnvelope = ({
  chainId,
  checkoutCall,
  tokenTotals
}: {
  chainId: number
  checkoutCall: WalletCall
  tokenTotals: readonly SliceCheckoutAllowanceTotal[]
}): WalletCall[] => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const totals = new Map<string, SliceCheckoutAllowanceTotal>()
  for (const total of tokenTotals) {
    if (!isAddress(total.currency) || total.amount <= 0n) {
      throw new Error("Checkout token totals must be positive.")
    }
    const key = total.currency.toLowerCase()
    const existing = totals.get(key)
    if (existing === undefined) {
      totals.set(key, total)
      continue
    }
    if (total.amount > maxUint256 - existing.amount) {
      throw new Error("Checkout token total exceeds uint256.")
    }
    totals.set(key, {
      amount: existing.amount + total.amount,
      currency: existing.currency
    })
  }

  return [
    ...[...totals.values()]
      .sort((left, right) =>
        left.currency.toLowerCase().localeCompare(right.currency.toLowerCase())
      )
      .flatMap(({ amount, currency }): WalletCall[] => [
        {
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [productsModuleAddress, amount]
          }),
          to: currency,
          value: 0n
        },
        {
          data: encodeFunctionData({
            abi: erc20AllowanceGuardAbi,
            functionName: "assertAllowance",
            args: [currency, productsModuleAddress, amount]
          }),
          to: sliceKernelERC20AllowanceGuardAddress,
          value: 0n
        }
      ]),
    checkoutCall
  ]
}

export const getSliceCheckoutSpendIntent = (
  calls: readonly WalletCall[],
  chainId: number,
  expectedBuyer?: Address
): SliceCheckoutSpendIntent | null =>
  getSliceCheckoutSpendIntentFromCalls(
    calls.map((call) => ({
      data: call.data ?? "0x",
      target: call.to,
      value: call.value ?? 0n
    })),
    chainId,
    expectedBuyer
  )

export const assertSliceCheckoutCalls = (
  calls: readonly WalletCall[],
  policy: WalletPolicyDescriptor
) => {
  if (policy.grantKind !== "checkout") {
    throw new Error("Checkout calls require a checkout policy.")
  }
  assertWalletCallsMatchPolicy(calls, policy)
  const intent = getSliceCheckoutSpendIntent(
    calls,
    policy.chainId,
    policy.account
  )
  if (intent === null)
    throw new Error("Wallet operation is not an accepted checkout.")
  return intent
}

export const validateSliceWalletCheckoutSessionCalls = (
  calls: readonly WalletCall[],
  session: { policy: WalletPolicyDescriptor }
) => assertSliceCheckoutCalls(calls, session.policy)
