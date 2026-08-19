import type { Address, Hex } from "viem"
import type {
  JsonObject,
  JsonValue,
  SliceJsonRpcId,
  SliceUserOperation
} from "./userOperation"

export type SliceBundlerSendMethod =
  | "eth_sendUserOperation"
  | "eth_estimateUserOperationGas"
export type SliceBundlerHashMethod =
  | "eth_getUserOperationReceipt"
  | "eth_getUserOperationByHash"
export type SliceBundlerSupportedEntryPointsMethod = "eth_supportedEntryPoints"
export type SliceBundlerMethod =
  | SliceBundlerSendMethod
  | SliceBundlerHashMethod
  | SliceBundlerSupportedEntryPointsMethod

export type SliceBundlerUserOperationRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SliceBundlerSendMethod
  params: [SliceUserOperation, Address]
  raw: JsonObject
}
export type SliceBundlerHashRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SliceBundlerHashMethod
  params: [Hex]
  raw: JsonObject
}
export type SliceBundlerSupportedEntryPointsRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SliceBundlerSupportedEntryPointsMethod
  params: []
  raw: JsonObject
}
export type SliceBundlerRequest =
  | SliceBundlerHashRequest
  | SliceBundlerSupportedEntryPointsRequest
  | SliceBundlerUserOperationRequest

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
