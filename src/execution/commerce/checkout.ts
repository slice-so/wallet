import {
  assertWalletCallsMatchPolicy,
  type WalletCall,
  type WalletPolicyDescriptor
} from "../../policy"
import type { SliceCheckoutSpendIntent } from "../../types/commerce"
import { getSliceCheckoutSpendIntentFromCalls } from "../utils/sliceCallPolicy"

export const getSliceCheckoutSpendIntent = (
  calls: readonly WalletCall[],
  chainId: number
): SliceCheckoutSpendIntent | null =>
  getSliceCheckoutSpendIntentFromCalls(
    calls.map((call) => ({
      data: call.data ?? "0x",
      target: call.to,
      value: call.value ?? 0n
    })),
    chainId
  )

export const assertSliceCheckoutCalls = (
  calls: readonly WalletCall[],
  policy: WalletPolicyDescriptor
) => {
  if (policy.grantKind !== "checkout") {
    throw new Error("Checkout calls require a checkout policy.")
  }
  assertWalletCallsMatchPolicy(calls, policy)
  const intent = getSliceCheckoutSpendIntent(calls, policy.chainId)
  if (intent === null)
    throw new Error("Wallet operation is not an accepted checkout.")
  return intent
}

export const validateSliceWalletCheckoutSessionCalls = (
  calls: readonly WalletCall[],
  session: { policy: WalletPolicyDescriptor }
) => assertSliceCheckoutCalls(calls, session.policy)
