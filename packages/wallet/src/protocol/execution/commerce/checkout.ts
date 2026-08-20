import { getProductsModuleAddress } from "@slicekit/abi/deployments"
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
import { getSliceCheckoutSpendIntentFromCalls } from "../utils/sliceCallPolicy"

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
      .sort((left, right) => {
        const leftCurrency = left.currency.toLowerCase()
        const rightCurrency = right.currency.toLowerCase()
        return leftCurrency < rightCurrency
          ? -1
          : leftCurrency > rightCurrency
            ? 1
            : 0
      })
      .map(
        ({ amount, currency }): WalletCall => ({
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [productsModuleAddress, amount]
          }),
          to: currency,
          value: 0n
        })
      ),
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
