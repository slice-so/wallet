import type { Address, Hex } from "viem"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue | undefined }
export type SliceJsonRpcId = string | number | null
export type SliceJsonRpcErrorCode =
  | -32700
  | -32600
  | -32603
  | -32031
  | -32030
  | -32000
export type SliceUpstreamJsonRpcError = {
  code: number
  data?: JsonValue
  message: string
}
export type SliceUserOperation = JsonObject & {
  sender: Address
  nonce: Hex
  callData: Hex
  factory?: Address | "0x7702"
  factoryData?: Hex
  initCode?: Hex
  eip7702Auth?: JsonValue
}
export type SliceUserOperationPolicyFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>
export type SliceSenderAccountSnapshot = { code: Hex; delegates: readonly Address[] }
export type SliceSenderAccountFetch = (
  chainId: number,
  sender: Address
) => Promise<SliceSenderAccountSnapshot>
export type SliceAcceptedSenderCode = { hash: Hex; size: number }
