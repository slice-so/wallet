export type * from "@slicekit/wallet-protocol/execution"

export type SliceUserOperationPolicyFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
