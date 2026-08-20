import type { Address } from "viem"
import {
  createJsonRpcError,
  createSliceProxyResponse as createProxyResponse,
  createSliceSlicerAddressResolver,
  isAcceptedSliceUserOperation,
  isAddressString,
  isSupportedSliceAcceptedPaymentTokensRequest,
  type JsonValue,
  parseSlicePaymasterRequest,
  readUpstreamJsonRpcError,
  type SliceAcceptedSenderCode,
  type SliceJsonRpcId,
  type SlicePaymasterMethod,
  type SlicePaymasterRequest,
  type SlicePaymasterSponsorshipRequest,
  type SliceSenderAccountFetch,
  type SliceUpstreamJsonRpcError,
  type SliceUserOperation,
  type SliceUserOperationPolicyFetch,
  slicePaymasterAcceptedPaymentTokensMethod,
  sliceUserOperationPolicyDescription
} from "../../protocol/execution"

type SlicePaymasterConfig = {
  acceptUserOperation?: (input: {
    chainId: string | number
    entryPoint: Address
    userOperation: SliceUserOperation
  }) => boolean | Promise<boolean>
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  acceptedChainIds?: readonly number[]
  allowAcceptedPaymentTokens?: boolean
  cdpApiKey?: string
  eip7702DelegateAllowlist?: readonly Address[]
  fetchSenderAccount?: SliceSenderAccountFetch
  policyBaseUrl?: string
  paymasterRpcUrl?: string
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

const basePaymasterRpcUrl = "https://api.developer.coinbase.com/rpc/v1/base"
export const slicePaymasterApiPath = "/api/paymaster"
export const slicePaymasterPolicyDescription = [
  "The Slice paymaster proxy accepts only ERC-7677 JSON-RPC paymaster requests for Base EntryPoint v0.6, v0.7, v0.8, or v0.9.",
  sliceUserOperationPolicyDescription
].join(" ")

const getStringConfigValue = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

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

const getExplicitSlicePaymasterRpcUrl = (value: string | undefined) => {
  const configured = getStringConfigValue(value)
  if (configured === null) return null
  const url = new URL(configured)
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Slice paymaster RPC URL is not permitted.")
  }
  return url.toString()
}

export const getSlicePaymasterApiUrl = (origin: string | URL) =>
  new URL(slicePaymasterApiPath, origin).toString()

const isSponsorableSlicePaymasterRequest = async (
  request: SlicePaymasterSponsorshipRequest,
  {
    acceptedSenderCode,
    acceptedChainIds,
    acceptUserOperation,
    eip7702DelegateAllowlist,
    fetchSenderAccount,
    fetchSlicer,
    policyBaseUrl,
    requireVerifiedSender
  }: Pick<
    SlicePaymasterConfig,
    | "acceptedSenderCode"
    | "acceptedChainIds"
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
  if (
    acceptUserOperation !== undefined &&
    !(await acceptUserOperation({ chainId, entryPoint, userOperation }))
  ) {
    return false
  }
  return isAcceptedSliceUserOperation({
    ...(acceptedSenderCode === undefined ? {} : { acceptedSenderCode }),
    ...(acceptedChainIds === undefined ? {} : { acceptedChainIds }),
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
    acceptedChainIds,
    acceptUserOperation,
    allowAcceptedPaymentTokens = true,
    cdpApiKey,
    eip7702DelegateAllowlist = [],
    fetchPaymaster = fetch,
    fetchSenderAccount,
    fetchSlicer,
    onUpstreamError,
    paymasterRpcUrl: paymasterRpcUrlOverride,
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

  const paymasterRpcUrl =
    getExplicitSlicePaymasterRpcUrl(paymasterRpcUrlOverride) ??
    getSlicePaymasterRpcUrl({ cdpApiKey })
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

  if (paymasterRequest.method === slicePaymasterAcceptedPaymentTokensMethod) {
    if (
      !allowAcceptedPaymentTokens ||
      !isSupportedSliceAcceptedPaymentTokensRequest(paymasterRequest)
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
      ...(acceptedChainIds === undefined ? {} : { acceptedChainIds }),
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
