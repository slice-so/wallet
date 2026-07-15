import { describe, expect, test } from "bun:test"
import {
  assertSliceWalletExecutionSafety,
  getSliceWalletExecutionSafetyEnvelope,
  getSliceWalletUserOperationGasExposure
} from "./executionSafety"
import type { SliceWalletUnsignedUserOperation } from "./types"

const validUserOperation: SliceWalletUnsignedUserOperation = {
  callData: "0x",
  callGasLimit: 1_000_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 100_000_000n,
  nonce: 0n,
  paymasterPostOpGasLimit: 100_000n,
  paymasterVerificationGasLimit: 100_000n,
  preVerificationGas: 100_000n,
  sender: "0x1000000000000000000000000000000000000001",
  verificationGasLimit: 2_000_000n
}

describe("Slice Wallet execution safety", () => {
  test("accepts operations within every field and aggregate cost cap", () => {
    expect(
      assertSliceWalletExecutionSafety({
        chainId: 8453,
        userOperation: validUserOperation
      })
    ).toEqual({
      maxNativeCostWei: 3_100_000_000_000_000n,
      maxPrefundWei: 3_300_000_000_000_000n
    })
  })

  test.each([
    ["callGasLimit", 3_000_001n],
    ["verificationGasLimit", 5_000_001n],
    ["preVerificationGas", 500_001n],
    ["paymasterVerificationGasLimit", 1_000_001n],
    ["paymasterPostOpGasLimit", 500_001n],
    ["maxFeePerGas", 20_000_000_001n],
    ["maxPriorityFeePerGas", 2_000_000_001n]
  ] as const)("rejects %s above its absolute cap", (field, value) => {
    expect(() =>
      assertSliceWalletExecutionSafety({
        chainId: 8453,
        userOperation: { ...validUserOperation, [field]: value }
      })
    ).toThrow("Wallet operation exceeds the gas safety envelope.")
  })

  test("rejects priority fees above the operation max fee", () => {
    expect(() =>
      assertSliceWalletExecutionSafety({
        chainId: 8453,
        userOperation: {
          ...validUserOperation,
          maxFeePerGas: 100n,
          maxPriorityFeePerGas: 101n
        }
      })
    ).toThrow("Wallet operation exceeds the gas safety envelope.")
  })

  test("rejects aggregate native cost even when each field is within its cap", () => {
    expect(() =>
      assertSliceWalletExecutionSafety({
        chainId: 8453,
        userOperation: {
          ...validUserOperation,
          callGasLimit: 3_000_000n,
          maxFeePerGas: 2_000_000_000n,
          preVerificationGas: 500_000n,
          verificationGasLimit: 5_000_000n
        }
      })
    ).toThrow("Wallet operation exceeds the gas cost safety envelope.")
  })

  test("includes paymaster gas in prefund but not account-native exposure", () => {
    expect(
      getSliceWalletUserOperationGasExposure({
        ...validUserOperation,
        paymasterPostOpGasLimit: 500_000n,
        paymasterVerificationGasLimit: 1_000_000n
      })
    ).toEqual({
      maxNativeCostWei: 3_100_000_000_000_000n,
      maxPrefundWei: 4_600_000_000_000_000n
    })
  })

  test("uses the Base envelope for local wallet fork chains", () => {
    expect(getSliceWalletExecutionSafetyEnvelope(31_337)).toBe(
      getSliceWalletExecutionSafetyEnvelope(8453)
    )
    expect(getSliceWalletExecutionSafetyEnvelope(31_338)).toBe(
      getSliceWalletExecutionSafetyEnvelope(8453)
    )
  })

  test("rejects unknown chains instead of accepting parent-supplied policy", () => {
    expect(() => getSliceWalletExecutionSafetyEnvelope(1)).toThrow(
      "Slice Wallet chain 1 is unsupported."
    )
  })
})
