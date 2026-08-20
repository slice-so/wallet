import type { Address } from "viem"
import type {
  JsonObject,
  JsonValue,
  SliceJsonRpcId,
  SliceUserOperation
} from "./userOperation"

export type SlicePaymasterSponsorshipMethod =
  | "pm_getPaymasterStubData"
  | "pm_getPaymasterData"
export type SlicePaymasterAcceptedTokensMethod = "pm_getAcceptedPaymentTokens"
export type SlicePaymasterMethod =
  | SlicePaymasterSponsorshipMethod
  | SlicePaymasterAcceptedTokensMethod

export type SlicePaymasterSponsorshipRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SlicePaymasterSponsorshipMethod
  params: [SliceUserOperation, Address, string | number, JsonObject?]
  raw: JsonObject
}
export type SliceAcceptedPaymentTokensRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SlicePaymasterAcceptedTokensMethod
  params: [Address, string | number, JsonValue]
  raw: JsonObject
}
export type SlicePaymasterRequest =
  | SlicePaymasterSponsorshipRequest
  | SliceAcceptedPaymentTokensRequest
