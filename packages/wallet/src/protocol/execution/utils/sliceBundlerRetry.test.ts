import { describe, expect, it } from "bun:test"
import { classifyAltoBundlerRetryReason } from "./sliceBundlerRetry"

describe("Alto bundler retry classification", () => {
  it("accepts only exact structured fee-admission reasons", () => {
    expect(
      classifyAltoBundlerRetryReason({
        code: -32602,
        message:
          "maxFeePerGas must be at least 20 (current maxFeePerGas: 10) - use pimlico_getUserOperationGasPrice to get the current gas price"
      })
    ).toBe("fee_floor")
    expect(
      classifyAltoBundlerRetryReason({
        code: -32602,
        message:
          "AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%"
      })
    ).toBe("replacement_underpriced")
    expect(
      classifyAltoBundlerRetryReason({
        code: -32602,
        message:
          "maxFeePerGas must be at least 20 (current maxFeePerGas: 10) - retry"
      })
    ).toBeNull()
    expect(
      classifyAltoBundlerRetryReason({
        code: -32500,
        message:
          "maxFeePerGas must be at least 20 (current maxFeePerGas: 10) - use pimlico_getUserOperationGasPrice to get the current gas price"
      })
    ).toBeNull()
  })
})
