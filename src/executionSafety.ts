import { getSliceWalletChainPolicy } from "./chains"
import type { SliceWalletUnsignedUserOperation } from "./types/frame"

const developmentChainIds = new Set([31_337, 31_338])
const baseExecutionSafetyEnvelope =
  getSliceWalletChainPolicy(8453).executionSafety
const localExecutionSafetyEnvelope = {
  ...baseExecutionSafetyEnvelope,
  // Alto's local V0.7 estimator simulates with 10M gas and applies a 130%
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

  const cappedFields = [
    ["callGasLimit", userOperation.callGasLimit, envelope.maxCallGasLimit],
    [
      "verificationGasLimit",
      userOperation.verificationGasLimit,
      envelope.maxVerificationGasLimit
    ],
    [
      "preVerificationGas",
      userOperation.preVerificationGas,
      envelope.maxPreVerificationGas
    ],
    [
      "paymasterVerificationGasLimit",
      paymasterVerificationGasLimit,
      envelope.maxPaymasterVerificationGasLimit
    ],
    [
      "paymasterPostOpGasLimit",
      paymasterPostOpGasLimit,
      envelope.maxPaymasterPostOpGasLimit
    ],
    ["maxFeePerGas", userOperation.maxFeePerGas, envelope.maxFeePerGas],
    [
      "maxPriorityFeePerGas",
      userOperation.maxPriorityFeePerGas,
      envelope.maxPriorityFeePerGas
    ]
  ] as const
  const exceededField = cappedFields.find(([, value, cap]) => value > cap)
  if (exceededField !== undefined) {
    const [field, value, cap] = exceededField
    throw new Error(
      `Wallet operation exceeds the gas safety envelope: ${field}=${value} exceeds ${cap}.`
    )
  }
  if (userOperation.maxPriorityFeePerGas > userOperation.maxFeePerGas) {
    throw new Error(
      `Wallet operation exceeds the gas safety envelope: maxPriorityFeePerGas=${userOperation.maxPriorityFeePerGas} exceeds maxFeePerGas=${userOperation.maxFeePerGas}.`
    )
  }

  const exposure = getSliceWalletUserOperationGasExposure(userOperation)
  if (exposure.maxPrefundWei > envelope.maxPrefundWei) {
    throw new Error(
      `Wallet operation exceeds the gas cost safety envelope: maxPrefundWei=${exposure.maxPrefundWei} exceeds ${envelope.maxPrefundWei}.`
    )
  }
  if (exposure.maxNativeCostWei > envelope.maxNativeCostWei) {
    throw new Error(
      `Wallet operation exceeds the gas cost safety envelope: maxNativeCostWei=${exposure.maxNativeCostWei} exceeds ${envelope.maxNativeCostWei}.`
    )
  }
  return exposure
}
