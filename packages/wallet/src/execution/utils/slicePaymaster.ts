import type {
  JsonObject,
  JsonValue,
  SliceAcceptedSenderCode,
  SliceJsonRpcId,
  SliceSenderAccountFetch,
  SliceUpstreamJsonRpcError,
  SliceUserOperation,
  SliceUserOperationPolicyFetch
} from "@slicekit/wallet-primitives/execution"
import {
  createJsonRpcError,
  createSliceProxyResponse as createProxyResponse,
  createSliceSlicerAddressResolver,
  isAcceptedSliceUserOperation,
  isAddressString,
  isJsonObject,
  isJsonRpcId,
  isSupportedSliceEntryPointRequest,
  parseSliceUserOperation,
  sliceUserOperationPolicyDescription
} from "@slicekit/wallet-primitives/execution"
import type { Address } from "viem"
import { readUpstreamJsonRpcError } from "./sliceUserOperationTransport"

type SlicePaymasterSponsorshipRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SlicePaymasterSponsorshipMethod
  params: [SliceUserOperation, Address, string | number, JsonObject?]
  raw: JsonObject
}

type SliceAcceptedPaymentTokensRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SlicePaymasterAcceptedTokensMethod
  params: [Address, string | number, JsonValue]
  raw: JsonObject
}

type SlicePaymasterRequest =
  | SlicePaymasterSponsorshipRequest
  | SliceAcceptedPaymentTokensRequest

type SlicePaymasterConfig = {
  acceptUserOperation?: (input: {
    chainId: string | number
    entryPoint: Address
    userOperation: SliceUserOperation
  }) => boolean | Promise<boolean>
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  allowAcceptedPaymentTokens?: boolean
  cdpApiKey?: string
  eip7702DelegateAllowlist?: readonly Address[]
  fetchSenderAccount?: SliceSenderAccountFetch
  policyBaseUrl?: string
  requireVerifiedSender?: boolean
}

type PaymasterFetch = SliceUserOperationPolicyFetch
type SlicePaymasterUpstreamErrorEvent = {
  error: SliceUpstreamJsonRpcError
  id?: SliceJsonRpcId
  method: SlicePaymasterMethod
}
type SlicePaymasterUpstreamErrorHandler = (
  event: SlicePaymasterUpstreamErrorEvent
) => void

type HandleSlicePaymasterRequestOptions = SlicePaymasterConfig & {
  fetchPaymaster?: PaymasterFetch
  fetchSlicer: PaymasterFetch
  onUpstreamError?: SlicePaymasterUpstreamErrorHandler
}

type SlicePaymasterSponsorshipMethod =
  | "pm_getPaymasterStubData"
  | "pm_getPaymasterData"
type SlicePaymasterAcceptedTokensMethod = "pm_getAcceptedPaymentTokens"
type SlicePaymasterMethod =
  | SlicePaymasterSponsorshipMethod
  | SlicePaymasterAcceptedTokensMethod

const basePaymasterRpcUrl = "https://api.developer.coinbase.com/rpc/v1/base"
export const slicePaymasterApiPath = "/api/paymaster"
const acceptedPaymentTokensMethod = "pm_getAcceptedPaymentTokens" as const
const supportedPaymasterMethods = [
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
  acceptedPaymentTokensMethod
] as const
const sponsorshipPaymasterMethods = [
  "pm_getPaymasterStubData",
  "pm_getPaymasterData"
] as const

export const slicePaymasterPolicyDescription = [
  "The Slice paymaster proxy accepts only ERC-7677 JSON-RPC paymaster requests for Base EntryPoint v0.6, v0.7, v0.8, or v0.9.",
  sliceUserOperationPolicyDescription
].join(" ")

const getStringConfigValue = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const isSlicePaymasterMethod = (
  value: JsonValue | undefined
): value is SlicePaymasterMethod =>
  typeof value === "string" &&
  supportedPaymasterMethods.includes(value as SlicePaymasterMethod)

const isSponsorshipPaymasterMethod = (
  value: SlicePaymasterMethod
): value is SlicePaymasterSponsorshipMethod =>
  sponsorshipPaymasterMethods.includes(value as SlicePaymasterSponsorshipMethod)

export const parseSlicePaymasterAddressList = (value: string | undefined) => {
  const rawAddresses = getStringConfigValue(value)
  if (!rawAddresses) return []

  const addresses: Address[] = []
  for (const rawAddress of rawAddresses.split(",")) {
    const address = rawAddress.trim()
    if (!address) continue
    if (isAddressString(address)) addresses.push(address)
  }

  return addresses
}

export const getSlicePaymasterRpcUrl = ({
  cdpApiKey
}: SlicePaymasterConfig) => {
  const apiKey = getStringConfigValue(cdpApiKey)
  return apiKey ? `${basePaymasterRpcUrl}/${apiKey}` : null
}

export const getSlicePaymasterApiUrl = (origin: string | URL) =>
  new URL(slicePaymasterApiPath, origin).toString()

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

const parseSlicePaymasterRequest = (
  body: JsonValue
): SlicePaymasterRequest | null => {
  if (!isJsonObject(body)) return null
  if (body.jsonrpc !== "2.0") return null
  if (!isJsonRpcId(body.id)) return null
  if (!isSlicePaymasterMethod(body.method)) return null
  if (!Array.isArray(body.params)) return null

  if (body.method === acceptedPaymentTokensMethod) {
    return parseAcceptedPaymentTokensRequest({
      body: {
        ...body,
        method: acceptedPaymentTokensMethod
      },
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

const isAcceptedPaymentTokensRequestSupported = (
  request: SliceAcceptedPaymentTokensRequest
) => {
  const [entryPoint, chainId] = request.params
  return isSupportedSliceEntryPointRequest({ chainId, entryPoint })
}

const isSponsorableSlicePaymasterRequest = async (
  request: SlicePaymasterSponsorshipRequest,
  {
    acceptedSenderCode,
    acceptUserOperation,
    eip7702DelegateAllowlist,
    fetchSenderAccount,
    fetchSlicer,
    policyBaseUrl,
    requireVerifiedSender
  }: Pick<
    SlicePaymasterConfig,
    | "acceptedSenderCode"
    | "acceptUserOperation"
    | "eip7702DelegateAllowlist"
    | "fetchSenderAccount"
    | "policyBaseUrl"
    | "requireVerifiedSender"
  > & {
    fetchSlicer: PaymasterFetch
  }
) => {
  const [userOperation, entryPoint, chainId] = request.params
  const accepted = await isAcceptedSliceUserOperation({
    ...(acceptedSenderCode === undefined ? {} : { acceptedSenderCode }),
    chainId,
    eip7702DelegateAllowlist,
    entryPoint,
    ...(fetchSenderAccount === undefined ? {} : { fetchSenderAccount }),
    isSlicerAddress: createSliceSlicerAddressResolver({
      fetchSlicer,
      policyBaseUrl
    }),
    ...(requireVerifiedSender === undefined ? {} : { requireVerifiedSender }),
    userOperation
  })
  return (
    accepted &&
    (acceptUserOperation === undefined ||
      (await acceptUserOperation({ chainId, entryPoint, userOperation })))
  )
}

const forwardPaymasterRequest = async ({
  fetchPaymaster,
  onUpstreamError,
  paymasterRequest,
  paymasterRpcUrl
}: {
  fetchPaymaster: PaymasterFetch
  onUpstreamError?: SlicePaymasterUpstreamErrorHandler
  paymasterRequest: SlicePaymasterRequest
  paymasterRpcUrl: string
}) => {
  const response = await fetchPaymaster(paymasterRpcUrl, {
    body: JSON.stringify(paymasterRequest.raw),
    headers: { "content-type": "application/json" },
    method: "POST"
  })
  const upstreamError = await readUpstreamJsonRpcError(response)
  if (upstreamError) {
    onUpstreamError?.({
      error: upstreamError,
      id: paymasterRequest.id,
      method: paymasterRequest.method
    })
  }

  return createProxyResponse(response)
}

export const handleSlicePaymasterRequest = async (
  request: Request,
  {
    acceptedSenderCode,
    acceptUserOperation,
    allowAcceptedPaymentTokens = true,
    cdpApiKey,
    eip7702DelegateAllowlist = [],
    fetchPaymaster = fetch,
    fetchSenderAccount,
    fetchSlicer,
    onUpstreamError,
    policyBaseUrl,
    requireVerifiedSender
  }: HandleSlicePaymasterRequestOptions
) => {
  let body: JsonValue
  try {
    body = (await request.json()) as JsonValue
  } catch {
    return Response.json(
      createJsonRpcError({ code: -32700, message: "Parse error" }),
      { status: 400 }
    )
  }

  const paymasterRequest = parseSlicePaymasterRequest(body)
  if (!paymasterRequest) {
    return Response.json(
      createJsonRpcError({
        code: -32600,
        message: "Invalid JSON-RPC paymaster request"
      }),
      { status: 400 }
    )
  }

  const paymasterRpcUrl = getSlicePaymasterRpcUrl({ cdpApiKey })
  if (!paymasterRpcUrl) {
    return Response.json(
      createJsonRpcError({
        code: -32603,
        id: paymasterRequest.id,
        message: "Paymaster is not configured"
      }),
      { status: 500 }
    )
  }

  if (paymasterRequest.method === acceptedPaymentTokensMethod) {
    if (
      !allowAcceptedPaymentTokens ||
      !isAcceptedPaymentTokensRequestSupported(paymasterRequest)
    ) {
      return Response.json(
        createJsonRpcError({
          code: -32000,
          id: paymasterRequest.id,
          message: "Unsupported accepted payment tokens request"
        }),
        { status: 403 }
      )
    }

    return forwardPaymasterRequest({
      fetchPaymaster,
      onUpstreamError,
      paymasterRequest,
      paymasterRpcUrl
    })
  }

  if (
    !(await isSponsorableSlicePaymasterRequest(paymasterRequest, {
      ...(acceptedSenderCode === undefined ? {} : { acceptedSenderCode }),
      ...(acceptUserOperation === undefined ? {} : { acceptUserOperation }),
      eip7702DelegateAllowlist,
      ...(fetchSenderAccount === undefined ? {} : { fetchSenderAccount }),
      fetchSlicer,
      ...(policyBaseUrl === undefined ? {} : { policyBaseUrl }),
      ...(requireVerifiedSender === undefined ? {} : { requireVerifiedSender })
    }))
  ) {
    return Response.json(
      createJsonRpcError({
        code: -32000,
        id: paymasterRequest.id,
        message: "Not a sponsorable Slice operation"
      }),
      { status: 403 }
    )
  }

  return forwardPaymasterRequest({
    fetchPaymaster,
    onUpstreamError,
    paymasterRequest,
    paymasterRpcUrl
  })
}
