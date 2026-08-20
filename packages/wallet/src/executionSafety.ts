import { getSliceWalletChainPolicy } from "./protocol/index"
import type { SliceWalletUnsignedUserOperation } from "./types/frame"

const developmentChainIds = new Set([31_337, 31_338])
const baseExecutionSafetyEnvelope =
  getSliceWalletChainPolicy(8453).executionSafety
const localExecutionSafetyEnvelope = {
  ...baseExecutionSafetyEnvelope,
  // Alto's local v0.9 estimator simulates with 10M gas and applies a 130%
  // verification multiplier. Keep local fork signing inside those bounds
  // without widening any funded-network envelope.
  maxCallGasLimit: 10_000_000n,
  maxNativeCostWei: 470_000_000_000_000_000n,
  maxPaymasterPostOpGasLimit: 2_400_000n,
  maxPaymasterVerificationGasLimit: 6_500_000n,
  maxPrefundWei: 648_000_000_000_000_000n,
  maxVerificationGasLimit: 13_000_000n
} as const

export const getSliceWalletExecutionSafetyEnvelope = (chainId: number) =>
  developmentChainIds.has(chainId)
    ? localExecutionSafetyEnvelope
    : getSliceWalletChainPolicy(chainId).executionSafety

export const getSliceWalletUserOperationGasExposure = (
  userOperation: SliceWalletUnsignedUserOperation
) => {
  const paymasterVerificationGasLimit =
    userOperation.paymasterVerificationGasLimit ?? 0n
  const paymasterPostOpGasLimit = userOperation.paymasterPostOpGasLimit ?? 0n
  const accountGas =
    userOperation.callGasLimit +
    userOperation.preVerificationGas +
    userOperation.verificationGasLimit
  const prefundGas =
    accountGas + paymasterVerificationGasLimit + paymasterPostOpGasLimit

  return {
    maxNativeCostWei: accountGas * userOperation.maxFeePerGas,
    maxPrefundWei: prefundGas * userOperation.maxFeePerGas
  }
}

export const assertSliceWalletExecutionSafety = ({
  chainId,
  userOperation
}: {
  chainId: number
  userOperation: SliceWalletUnsignedUserOperation
}) => {
  const envelope = getSliceWalletExecutionSafetyEnvelope(chainId)
  const paymasterVerificationGasLimit =
    userOperation.paymasterVerificationGasLimit ?? 0n
  const paymasterPostOpGasLimit = userOperation.paymasterPostOpGasLimit ?? 0n

  if (
    userOperation.callGasLimit > envelope.maxCallGasLimit ||
    userOperation.verificationGasLimit > envelope.maxVerificationGasLimit ||
    userOperation.preVerificationGas > envelope.maxPreVerificationGas ||
    paymasterVerificationGasLimit > envelope.maxPaymasterVerificationGasLimit ||
    paymasterPostOpGasLimit > envelope.maxPaymasterPostOpGasLimit ||
    userOperation.maxFeePerGas > envelope.maxFeePerGas ||
    userOperation.maxPriorityFeePerGas > envelope.maxPriorityFeePerGas ||
    userOperation.maxPriorityFeePerGas > userOperation.maxFeePerGas
  ) {
    throw new Error("Wallet operation exceeds the gas safety envelope.")
  }

  const exposure = getSliceWalletUserOperationGasExposure(userOperation)
  if (
    exposure.maxPrefundWei > envelope.maxPrefundWei ||
    exposure.maxNativeCostWei > envelope.maxNativeCostWei
  ) {
    throw new Error("Wallet operation exceeds the gas cost safety envelope.")
  }
  return exposure
}
