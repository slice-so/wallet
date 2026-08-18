import type {
  SliceAcceptedSenderCode,
  SliceBundlerUserOperationAuthorizer,
  SliceSenderAccountFetch
} from "@slicekit/wallet-protocol/execution"
import type { SliceUserOperationPolicyFetch } from "./userOperation"

export type * from "@slicekit/wallet-protocol/execution"

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
