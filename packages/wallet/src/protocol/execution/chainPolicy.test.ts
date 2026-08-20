import { describe, expect, test } from "bun:test"
import type { UserOperation } from "viem/account-abstraction"
import {
  isSupportedSliceWalletChainId,
  validateSliceWalletExecutionGasPolicy
} from "./chainPolicy"

const validUserOperation: UserOperation<"0.9"> = {
  callData: "0x",
  callGasLimit: 1_000_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 100_000_000n,
  nonce: 0n,
  paymasterPostOpGasLimit: 100_000n,
  paymasterVerificationGasLimit: 100_000n,
  preVerificationGas: 100_000n,
  sender: "0x1000000000000000000000000000000000000001",
  signature: "0x",
  verificationGasLimit: 2_000_000n
}

describe("Slice wallet chain policy", () => {
  test("admits only provisioned wallet chains", () => {
    expect(isSupportedSliceWalletChainId(1)).toBe(false)
    expect(isSupportedSliceWalletChainId(10)).toBe(false)
    expect(isSupportedSliceWalletChainId(8453)).toBe(false)
    expect(isSupportedSliceWalletChainId(42_161)).toBe(false)
    expect(isSupportedSliceWalletChainId(31_337)).toBe(true)
    expect(isSupportedSliceWalletChainId(31_338)).toBe(false)
    expect(isSupportedSliceWalletChainId(Number.NaN)).toBe(false)
  })

  test("accepts a Base checkout operation within absolute and relative caps", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 1_000_000_000n,
        chainId: 31_337,
        userOperation: validUserOperation
      })
    ).toBeNull()
  })

  test.each([
    ["callGasLimit", 3_000_001n],
    ["verificationGasLimit", 5_000_001n],
    ["preVerificationGas", 500_001n],
    ["paymasterVerificationGasLimit", 1_000_001n],
    ["paymasterPostOpGasLimit", 500_001n],
    ["maxPriorityFeePerGas", 2_000_000_001n]
  ] as const)("rejects %s above its Base cap", (field, value) => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 1_000_000_000n,
        chainId: 31_337,
        userOperation: { ...validUserOperation, [field]: value }
      })
    ).toBe("gas_limits_exceeded")
  })

  test("rejects max fees above the trusted base-fee-relative ceiling", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 100_000_000n,
        chainId: 31_337,
        userOperation: {
          ...validUserOperation,
          maxFeePerGas: 2_400_000_001n
        }
      })
    ).toBe("gas_limits_exceeded")
  })

  test("still applies the absolute fee ceiling when Base fees are high", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 10_000_000_000n,
        chainId: 31_337,
        userOperation: {
          ...validUserOperation,
          maxFeePerGas: 20_000_000_001n
        }
      })
    ).toBe("gas_limits_exceeded")
  })

  test("rejects aggregate cost even when individual fields fit", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 1_000_000_000n,
        chainId: 31_337,
        userOperation: {
          ...validUserOperation,
          callGasLimit: 3_000_000n,
          maxFeePerGas: 2_000_000_000n,
          preVerificationGas: 500_000n,
          verificationGasLimit: 5_000_000n
        }
      })
    ).toBe("gas_limits_exceeded")
  })

  test("maps local checkout chains to the Base policy", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 1n,
        chainId: 31_337,
        userOperation: validUserOperation
      })
    ).toBeNull()
  })

  test("fails closed for a chain outside the checkout registry", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 1n,
        chainId: 1,
        userOperation: validUserOperation
      })
    ).toBe("unsupported_checkout_chain")
  })

  test("does not grant the secondary two-chain E2E node a checkout policy", () => {
    expect(
      validateSliceWalletExecutionGasPolicy({
        baseFeePerGas: 1n,
        chainId: 31_338,
        userOperation: validUserOperation
      })
    ).toBe("unsupported_checkout_chain")
  })
})
