import type {
  SliceAcceptedSenderCode,
  SliceBundlerUserOperationAuthorizer,
  SliceSenderAccountFetch,
  SliceUserOperationPolicyFetch
} from "../protocol/execution"

export type SliceBundlerRpcUrlParameters = {
  bundlerRpcUrl?: string
  chainId?: number
}
export type SliceBundlerRequestOptions = {
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  authorizeUserOperation?: SliceBundlerUserOperationAuthorizer
  fetch?: SliceUserOperationPolicyFetch
  fetchSenderAccount?: SliceSenderAccountFetch
}
