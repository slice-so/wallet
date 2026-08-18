import type {
  SliceAcceptedSenderCode,
  SliceBundlerUserOperationAuthorizer,
  SliceSenderAccountFetch,
  SliceUserOperationPolicyFetch
} from "@slicekit/wallet-primitives/execution"

export type SliceBundlerRpcUrlParameters = {
  allowCdpFallback?: boolean
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
