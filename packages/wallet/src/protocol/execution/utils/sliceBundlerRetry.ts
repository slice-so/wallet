import type { SliceBundlerUpstreamErrorClassifier } from "../../types/bundler"

export const sliceBundlerRetryRpcCode = -32031
export const sliceBundlerRetryDataCode = "SLICE_BUNDLER_RETRY" as const

const altoFeeFloorReasons = [
  /^maxFeePerGas must be at least [0-9]+ \(current maxFeePerGas: [0-9]+\) - use pimlico_getUserOperationGasPrice to get the current gas price$/,
  /^maxPriorityFeePerGas must be at least [0-9]+ \(current maxPriorityFeePerGas: [0-9]+\) - use pimlico_getUserOperationGasPrice to get the current gas price$/
] as const
const altoReplacementReason =
  /^AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%$/

/** Classifies the exact Alto v2 EIP-7769 fee-admission errors used on the wire. */
export const classifyAltoBundlerRetryReason: SliceBundlerUpstreamErrorClassifier =
  (error) => {
    if (error.code !== -32602) return null
    if (altoFeeFloorReasons.some((reason) => reason.test(error.message))) {
      return "fee_floor"
    }
    return altoReplacementReason.test(error.message)
      ? "replacement_underpriced"
      : null
  }
