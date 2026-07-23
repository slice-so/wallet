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
    ).toThrow(
      `Wallet operation exceeds the gas safety envelope: ${field}=${value} exceeds`
    )
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
    ).toThrow(
      "Wallet operation exceeds the gas safety envelope: maxPriorityFeePerGas=101 exceeds maxFeePerGas=100."
    )
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
    ).toThrow(
      "Wallet operation exceeds the gas cost safety envelope: maxNativeCostWei=17000000000000000 exceeds 10000000000000000."
    )
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

  test("uses an Alto-sized envelope only for local wallet fork chains", () => {
    const baseEnvelope = getSliceWalletExecutionSafetyEnvelope(8453)
    const localEnvelope = getSliceWalletExecutionSafetyEnvelope(31_337)

    expect(baseEnvelope.maxCallGasLimit).toBe(3_000_000n)
    expect(baseEnvelope.maxVerificationGasLimit).toBe(5_000_000n)
    expect(localEnvelope).toMatchObject({
      maxCallGasLimit: 10_000_000n,
      maxNativeCostWei: 470_000_000_000_000_000n,
      maxPaymasterPostOpGasLimit: 2_400_000n,
      maxPaymasterVerificationGasLimit: 6_500_000n,
      maxPrefundWei: 648_000_000_000_000_000n,
      maxVerificationGasLimit: 13_000_000n
    })
    expect(getSliceWalletExecutionSafetyEnvelope(31_338)).toBe(localEnvelope)
  })

  test("accepts a local lazy-permission estimate without widening Base", () => {
    const lazyPermissionOperation = {
      ...validUserOperation,
      callGasLimit: 4_000_000n,
      verificationGasLimit: 8_000_000n
    }

    expect(() =>
      assertSliceWalletExecutionSafety({
        chainId: 8453,
        userOperation: lazyPermissionOperation
      })
    ).toThrow(
      "Wallet operation exceeds the gas safety envelope: callGasLimit=4000000 exceeds 3000000."
    )
    expect(
      assertSliceWalletExecutionSafety({
        chainId: 31_337,
        userOperation: lazyPermissionOperation
      })
    ).toEqual({
      maxNativeCostWei: 12_100_000_000_000_000n,
      maxPrefundWei: 12_300_000_000_000_000n
    })
  })

  test("rejects unknown chains instead of accepting parent-supplied policy", () => {
    expect(() => getSliceWalletExecutionSafetyEnvelope(137)).toThrow(
      "Slice Wallet chain 137 is unsupported."
    )
  })
})
