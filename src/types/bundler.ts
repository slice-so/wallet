import type { Address } from "viem"
import type {
  JsonValue,
  SliceAcceptedSenderCode,
  SliceSenderAccountFetch,
  SliceUserOperation,
  SliceUserOperationPolicyFetch
} from "./userOperation"

export type SliceBundlerUserOperationAuthorizationInput = {
  chainId: number
  entryPoint: Address
  userOperation: SliceUserOperation
}
export type SliceBundlerUserOperationAuthorizer = (
  input: SliceBundlerUserOperationAuthorizationInput
) => boolean | Promise<boolean>
export type SliceBundlerRetryReason = "fee_floor" | "replacement_underpriced"
export type SliceBundlerUpstreamErrorClassifier = (error: {
  code: number
  data?: JsonValue
  message: string
}) => SliceBundlerRetryReason | null
export type SliceBundlerRpcUrlParameters = {
  bundlerRpcUrl?: string
  cdpApiKey?: string
  chainId?: number
  serializedBundlerRpcUrls?: string
}
export type SliceBundlerRequestOptions = {
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  authorizeUserOperation?: SliceBundlerUserOperationAuthorizer
  fetch?: SliceUserOperationPolicyFetch
  fetchSenderAccount?: SliceSenderAccountFetch
}
