import { supportedSliceCheckoutChainIds } from "@slicekit/abi/deployments"
import type { UserOperation } from "viem/account-abstraction"
import {
  getSliceWalletChainManifest,
  sliceWalletSupportedChainIds
} from "../chains"

const baseChainId = 8453
const developmentChainIds = new Set([31_337, 31_338])
const supportedWalletChainIds = new Set<number>(sliceWalletSupportedChainIds)
const supportedCheckoutChainIds = new Set<number>(
  supportedSliceCheckoutChainIds
)

const checkoutFeePolicy = {
  baseFeeMultiplier: 4n,
  priorityFeeHeadroomWei: 2_000_000_000n
} as const

export const isSupportedSliceWalletChainId = (chainId: number) =>
  Number.isSafeInteger(chainId) && supportedWalletChainIds.has(chainId)

const getSliceWalletCheckoutGasPolicy = (chainId: number) => {
  if (developmentChainIds.has(chainId)) {
    return {
      ...getSliceWalletChainManifest(baseChainId).executionSafety,
      ...checkoutFeePolicy
    }
  }
  if (supportedCheckoutChainIds.has(chainId)) {
    return {
      ...getSliceWalletChainManifest(chainId).executionSafety,
      ...checkoutFeePolicy
    }
  }
  return null
}

export const validateSliceWalletExecutionGasPolicy = ({
  baseFeePerGas,
  chainId,
  userOperation
}: {
  baseFeePerGas: bigint
  chainId: number
  userOperation: UserOperation<"0.7">
}): "gas_limits_exceeded" | "unsupported_checkout_chain" | null => {
  const policy = getSliceWalletCheckoutGasPolicy(chainId)
  if (policy === null) return "unsupported_checkout_chain"

  const paymasterVerificationGasLimit =
    userOperation.paymasterVerificationGasLimit ?? 0n
  const paymasterPostOpGasLimit = userOperation.paymasterPostOpGasLimit ?? 0n
  const baseFeeRelativeMax =
    baseFeePerGas * policy.baseFeeMultiplier + policy.priorityFeeHeadroomWei
  const maxFeePerGas =
    baseFeeRelativeMax < policy.maxFeePerGas
      ? baseFeeRelativeMax
      : policy.maxFeePerGas

  if (
    userOperation.callGasLimit > policy.maxCallGasLimit ||
    userOperation.verificationGasLimit > policy.maxVerificationGasLimit ||
    userOperation.preVerificationGas > policy.maxPreVerificationGas ||
    paymasterVerificationGasLimit > policy.maxPaymasterVerificationGasLimit ||
    paymasterPostOpGasLimit > policy.maxPaymasterPostOpGasLimit ||
    userOperation.maxFeePerGas > maxFeePerGas ||
    userOperation.maxPriorityFeePerGas > policy.maxPriorityFeePerGas ||
    userOperation.maxPriorityFeePerGas > userOperation.maxFeePerGas
  ) {
    return "gas_limits_exceeded"
  }

  const accountGas =
    userOperation.callGasLimit +
    userOperation.verificationGasLimit +
    userOperation.preVerificationGas
  const prefundGas =
    accountGas + paymasterVerificationGasLimit + paymasterPostOpGasLimit
  if (
    accountGas * userOperation.maxFeePerGas > policy.maxNativeCostWei ||
    prefundGas * userOperation.maxFeePerGas > policy.maxPrefundWei
  ) {
    return "gas_limits_exceeded"
  }

  return null
}
