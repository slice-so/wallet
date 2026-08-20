import type {
  SliceAcceptedPaymentTokensRequest,
  SlicePaymasterAcceptedTokensMethod,
  SlicePaymasterMethod,
  SlicePaymasterRequest,
  SlicePaymasterSponsorshipMethod,
  SlicePaymasterSponsorshipRequest
} from "../../types/paymaster"
import type {
  JsonObject,
  JsonValue,
  SliceJsonRpcId
} from "../../types/userOperation"
import {
  isAddressString,
  isJsonObject,
  isJsonRpcId,
  isSupportedSliceEntryPointRequest,
  parseSliceUserOperation
} from "./sliceUserOperationPolicy"

export const slicePaymasterAcceptedPaymentTokensMethod =
  "pm_getAcceptedPaymentTokens" as const satisfies SlicePaymasterAcceptedTokensMethod
const supportedPaymasterMethods = [
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
  slicePaymasterAcceptedPaymentTokensMethod
] as const
const sponsorshipPaymasterMethods = [
  "pm_getPaymasterStubData",
  "pm_getPaymasterData"
] as const

const isSlicePaymasterMethod = (
  value: JsonValue | undefined
): value is SlicePaymasterMethod =>
  typeof value === "string" &&
  supportedPaymasterMethods.includes(value as SlicePaymasterMethod)

const isSponsorshipPaymasterMethod = (
  value: SlicePaymasterMethod
): value is SlicePaymasterSponsorshipMethod =>
  sponsorshipPaymasterMethods.includes(value as SlicePaymasterSponsorshipMethod)

export const isSlicePaymasterSponsorshipRequest = (
  request: SlicePaymasterRequest
): request is SlicePaymasterSponsorshipRequest =>
  isSponsorshipPaymasterMethod(request.method)

const parseAcceptedPaymentTokensRequest = ({
  body,
  params
}: {
  body: JsonObject & {
    id?: SliceJsonRpcId
    method: SlicePaymasterAcceptedTokensMethod
  }
  params: JsonValue[]
}): SliceAcceptedPaymentTokensRequest | null => {
  if (params.length !== 3) return null
  const [rawEntryPoint, rawChainId, rawContext] = params
  if (!isAddressString(rawEntryPoint)) return null
  if (typeof rawChainId !== "string" && typeof rawChainId !== "number") {
    return null
  }
  return {
    jsonrpc: "2.0",
    id: body.id,
    method: body.method,
    params: [rawEntryPoint, rawChainId, rawContext],
    raw: body
  }
}

/** Parses an ERC-7677 paymaster JSON-RPC request; returns null when malformed. */
export const parseSlicePaymasterRequest = (
  body: JsonValue
): SlicePaymasterRequest | null => {
  if (!isJsonObject(body)) return null
  if (body.jsonrpc !== "2.0") return null
  if (!isJsonRpcId(body.id)) return null
  if (!isSlicePaymasterMethod(body.method)) return null
  if (!Array.isArray(body.params)) return null

  if (body.method === slicePaymasterAcceptedPaymentTokensMethod) {
    return parseAcceptedPaymentTokensRequest({
      body: { ...body, method: slicePaymasterAcceptedPaymentTokensMethod },
      params: body.params
    })
  }

  if (body.params.length < 3 || body.params.length > 4) return null
  if (!isSponsorshipPaymasterMethod(body.method)) return null

  const [rawUserOperation, rawEntryPoint, rawChainId, rawContext] = body.params
  const userOperation = parseSliceUserOperation(rawUserOperation)
  if (!userOperation) return null
  if (!isAddressString(rawEntryPoint)) return null
  if (typeof rawChainId !== "string" && typeof rawChainId !== "number") {
    return null
  }

  const hasContext = rawContext !== undefined && rawContext !== null
  if (hasContext && !isJsonObject(rawContext)) return null

  const params: SlicePaymasterSponsorshipRequest["params"] = hasContext
    ? [userOperation, rawEntryPoint, rawChainId, rawContext]
    : [userOperation, rawEntryPoint, rawChainId]

  return {
    jsonrpc: "2.0",
    id: body.id,
    method: body.method,
    params,
    raw: {
      ...body,
      params: body.params.map((param, index) =>
        index === 0 ? userOperation : param
      )
    }
  }
}

export const isSupportedSliceAcceptedPaymentTokensRequest = (
  request: SliceAcceptedPaymentTokensRequest
) => {
  const [entryPoint, chainId] = request.params
  return isSupportedSliceEntryPointRequest({ chainId, entryPoint })
}
