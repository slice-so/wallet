import type { Address, Hex } from "viem"
import type {
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
  data?: string
  message: string
}) => SliceBundlerRetryReason | null
export type SliceBundlerRequestOptions = {
  acceptedSenderCode?: readonly { hash: Hex; size: number }[]
  authorizeUserOperation?: SliceBundlerUserOperationAuthorizer
  fetch?: SliceUserOperationPolicyFetch
  fetchSenderAccount?: SliceSenderAccountFetch
}
