import type { Address, Hex } from "viem"
import { base } from "viem/chains"
import type {
  SliceBundlerRpcUrlParameters,
  SliceBundlerUpstreamErrorClassifier,
  SliceBundlerUserOperationAuthorizer
} from "../../types/bundler"
import type {
  JsonObject,
  JsonValue,
  SliceAcceptedSenderCode,
  SliceJsonRpcId,
  SliceSenderAccountFetch,
  SliceUpstreamJsonRpcError,
  SliceUserOperation,
  SliceUserOperationPolicyFetch
} from "../../types/userOperation"
import { getSlicePaymasterRpcUrl } from "./slicePaymaster"
import {
  createJsonRpcError,
  createProxyResponse,
  isAcceptedSliceUserOperation,
  isAddressString,
  isHexString,
  isJsonObject,
  isJsonRpcId,
  parseSliceUserOperation,
  readUpstreamJsonRpcError
} from "./sliceUserOperationPolicy"

type SliceBundlerSendMethod =
  | "eth_sendUserOperation"
  | "eth_estimateUserOperationGas"
type SliceBundlerHashMethod =
  | "eth_getUserOperationReceipt"
  | "eth_getUserOperationByHash"
type SliceBundlerSupportedEntryPointsMethod = "eth_supportedEntryPoints"
type SliceBundlerMethod =
  | SliceBundlerSendMethod
  | SliceBundlerHashMethod
  | SliceBundlerSupportedEntryPointsMethod

type SliceBundlerUserOperationRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SliceBundlerSendMethod
  params: [SliceUserOperation, Address]
  raw: JsonObject
}

type SliceBundlerHashRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SliceBundlerHashMethod
  params: [Hex]
  raw: JsonObject
}

type SliceBundlerSupportedEntryPointsRequest = {
  jsonrpc: "2.0"
  id?: SliceJsonRpcId
  method: SliceBundlerSupportedEntryPointsMethod
  params: []
  raw: JsonObject
}

type SliceBundlerRequest =
  | SliceBundlerHashRequest
  | SliceBundlerSupportedEntryPointsRequest
  | SliceBundlerUserOperationRequest

type SliceBundlerConfig = SliceBundlerRpcUrlParameters & {
  /** Adds a narrower condition after the built-in or replacement policy. */
  acceptUserOperation?: SliceBundlerUserOperationAuthorizer
  acceptedChainIds?: readonly number[]
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  /**
   * Replaces the Slice-commerce call classifier. This is reserved for public
   * wallet transports that validate the canonical account but do not sponsor
   * or otherwise constrain what the account may execute.
   */
  authorizeUserOperation?: SliceBundlerUserOperationAuthorizer
  eip7702DelegateAllowlist?: readonly Address[]
  fetchSenderAccount?: SliceSenderAccountFetch
  policyBaseUrl?: string
  requireVerifiedSender?: boolean
}

type BundlerFetch = SliceUserOperationPolicyFetch
type SliceBundlerUpstreamErrorEvent = {
  error: SliceUpstreamJsonRpcError
  id?: SliceJsonRpcId
  method: SliceBundlerMethod
  userOperationHash?: Hex
}
type SliceBundlerUpstreamErrorHandler = (
  event: SliceBundlerUpstreamErrorEvent
) => void

type HandleSliceBundlerRequestOptions = SliceBundlerConfig & {
  classifyUpstreamError?: SliceBundlerUpstreamErrorClassifier
  fetchBundler?: BundlerFetch
  fetchSlicer: BundlerFetch
  onUpstreamError?: SliceBundlerUpstreamErrorHandler
}

export const sliceBundlerApiPath = "/api/bundler"

/** Session-key checkout budget error code surfaced by the co-sign endpoint. */
export const sliceAllowanceExceededCode = "SLICE_ALLOWANCE_EXCEEDED"
export const sliceAllowanceExceededRpcCode = -32030
export const sliceBundlerRetryRpcCode = -32031
export const sliceBundlerRetryDataCode = "SLICE_BUNDLER_RETRY" as const

const sliceLocalBundlerRpcUrl = "http://localhost:4337"

const altoFeeFloorReasons = [
  /^maxFeePerGas must be at least [0-9]+ \(current maxFeePerGas: [0-9]+\) - use pimlico_getUserOperationGasPrice to get the current gas price$/,
  /^maxPriorityFeePerGas must be at least [0-9]+ \(current maxPriorityFeePerGas: [0-9]+\) - use pimlico_getUserOperationGasPrice to get the current gas price$/
] as const
const altoReplacementReason =
  /^AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%$/

/**
 * Alto v2 emits EIP-7769 InvalidFields for fee admission failures. Keep this
 * adapter exact and versioned; unknown or near-matching reasons fail closed.
 */
export const classifyAltoBundlerRetryReason: SliceBundlerUpstreamErrorClassifier =
  (error) => {
    if (error.code !== -32602) return null
    if (altoFeeFloorReasons.some((reason) => reason.test(error.message))) {
      return "fee_floor"
    }
    return altoReplacementReason.test(error.message)
      ? "replacement_underpriced"
      : null
  }

const supportedBundlerMethods = [
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "eth_supportedEntryPoints"
] as const
const userOperationBundlerMethods = [
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas"
] as const
const hashBundlerMethods = [
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash"
] as const

const normalizeSliceBundlerRpcUrl = (value: string) => {
  const normalized = value.trim()
  if (normalized.length === 0) return null
  if (normalized.length > 2_048) {
    throw new Error("Slice bundler RPC URL is too long.")
  }

  const url = new URL(normalized)
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Slice bundler RPC URL is not permitted.")
  }
  return normalized
}

const getConfiguredSliceBundlerRpcUrl = (
  serializedRpcUrls: string | undefined,
  chainId: number
) => {
  if (serializedRpcUrls === undefined || serializedRpcUrls.trim() === "") {
    return null
  }

  const parsed = JSON.parse(serializedRpcUrls) as JsonValue
  if (!isJsonObject(parsed)) {
    throw new Error("Slice bundler RPC URLs must be an object.")
  }
  const configured = parsed[String(chainId)]
  if (configured === undefined) return null
  if (typeof configured !== "string") {
    throw new Error(`Slice bundler RPC URL for chain ${chainId} is invalid.`)
  }
  return normalizeSliceBundlerRpcUrl(configured)
}

/** Resolves every Slice server-side bundler upstream with one policy. */
export const getSliceBundlerRpcUrl = ({
  bundlerRpcUrl,
  cdpApiKey,
  chainId = base.id,
  serializedBundlerRpcUrls
}: SliceBundlerRpcUrlParameters) => {
  const chainOverride = getConfiguredSliceBundlerRpcUrl(
    serializedBundlerRpcUrls,
    chainId
  )
  if (chainOverride !== null) return chainOverride

  if (bundlerRpcUrl !== undefined) {
    const override = normalizeSliceBundlerRpcUrl(bundlerRpcUrl)
    if (override !== null) return override
  }

  if (chainId === 31_337) return sliceLocalBundlerRpcUrl
  if (chainId === base.id) return getSlicePaymasterRpcUrl({ cdpApiKey })
  return null
}

export const getSliceBundlerApiUrl = (origin: string | URL) =>
  new URL(sliceBundlerApiPath, origin).toString()

const isSliceBundlerMethod = (
  value: JsonValue | undefined
): value is SliceBundlerMethod =>
  typeof value === "string" &&
  supportedBundlerMethods.includes(value as SliceBundlerMethod)

const isUserOperationBundlerMethod = (
  value: SliceBundlerMethod
): value is SliceBundlerSendMethod =>
  userOperationBundlerMethods.includes(value as SliceBundlerSendMethod)

const isUserOperationBundlerRequest = (
  request: SliceBundlerRequest
): request is SliceBundlerUserOperationRequest =>
  isUserOperationBundlerMethod(request.method)

const isHashBundlerMethod = (
  value: SliceBundlerMethod
): value is SliceBundlerHashMethod =>
  hashBundlerMethods.includes(value as SliceBundlerHashMethod)

const isUserOperationHash = (value: JsonValue | undefined): value is Hex =>
  isHexString(value) && value.length === 66

const getBundlerRequestUserOperationHash = (
  request: SliceBundlerRequest
): Hex | null => {
  if (
    request.method !== "eth_getUserOperationReceipt" &&
    request.method !== "eth_getUserOperationByHash"
  ) {
    return null
  }

  const [userOperationHash] = request.params
  return userOperationHash
}

const parseSliceBundlerRequest = (
  body: JsonValue
): SliceBundlerRequest | null => {
  if (!isJsonObject(body)) return null
  if (body.jsonrpc !== "2.0") return null
  if (!isJsonRpcId(body.id)) return null
  if (!isSliceBundlerMethod(body.method)) return null
  if (!Array.isArray(body.params)) return null

  if (body.method === "eth_supportedEntryPoints") {
    if (body.params.length !== 0) return null
    return {
      jsonrpc: "2.0",
      id: body.id,
      method: body.method,
      params: [],
      raw: body
    }
  }

  if (isHashBundlerMethod(body.method)) {
    if (body.params.length !== 1) return null
    const [userOperationHash] = body.params
    if (!isUserOperationHash(userOperationHash)) return null
    return {
      jsonrpc: "2.0",
      id: body.id,
      method: body.method,
      params: [userOperationHash],
      raw: body
    }
  }

  if (!isUserOperationBundlerMethod(body.method)) return null
  if (body.params.length !== 2) return null

  const [rawUserOperation, rawEntryPoint] = body.params
  const userOperation = parseSliceUserOperation(rawUserOperation)
  if (!userOperation) return null
  if (!isAddressString(rawEntryPoint)) return null

  return {
    jsonrpc: "2.0",
    id: body.id,
    method: body.method,
    params: [userOperation, rawEntryPoint],
    raw: {
      ...body,
      params: body.params.map((param, index) =>
        index === 0 ? userOperation : param
      )
    }
  }
}

const isAcceptedBundlerUserOperationRequest = async (
  request: SliceBundlerUserOperationRequest,
  {
    acceptedSenderCode,
    acceptedChainIds,
    acceptUserOperation,
    authorizeUserOperation,
    chainId,
    eip7702DelegateAllowlist,
    fetchSenderAccount,
    fetchSlicer,
    policyBaseUrl,
    requireVerifiedSender
  }: Pick<
    SliceBundlerConfig,
    | "acceptedSenderCode"
    | "acceptedChainIds"
    | "acceptUserOperation"
    | "authorizeUserOperation"
    | "eip7702DelegateAllowlist"
    | "fetchSenderAccount"
    | "policyBaseUrl"
    | "requireVerifiedSender"
  > & {
    chainId: number
    fetchSlicer: BundlerFetch
  }
) => {
  const [userOperation, entryPoint] = request.params
  const authorizationInput = {
    chainId,
    entryPoint,
    userOperation
  }
  const accepted =
    authorizeUserOperation === undefined
      ? await isAcceptedSliceUserOperation({
          ...(acceptedChainIds === undefined ? {} : { acceptedChainIds }),
          ...(acceptedSenderCode === undefined ? {} : { acceptedSenderCode }),
          chainId,
          eip7702DelegateAllowlist,
          entryPoint,
          ...(fetchSenderAccount === undefined ? {} : { fetchSenderAccount }),
          fetchSlicer,
          policyBaseUrl,
          ...(requireVerifiedSender === undefined
            ? {}
            : { requireVerifiedSender }),
          userOperation
        })
      : await authorizeUserOperation(authorizationInput)
  return (
    accepted &&
    (acceptUserOperation === undefined ||
      (await acceptUserOperation(authorizationInput)))
  )
}

const forwardBundlerRequest = async ({
  bundlerRequest,
  bundlerRpcUrl,
  classifyUpstreamError,
  fetchBundler,
  onUpstreamError
}: {
  bundlerRequest: SliceBundlerRequest
  bundlerRpcUrl: string
  classifyUpstreamError?: SliceBundlerUpstreamErrorClassifier
  fetchBundler: BundlerFetch
  onUpstreamError?: SliceBundlerUpstreamErrorHandler
}) => {
  const response = await fetchBundler(bundlerRpcUrl, {
    body: JSON.stringify(bundlerRequest.raw),
    headers: { "content-type": "application/json" },
    method: "POST"
  })
  const upstreamError = await readUpstreamJsonRpcError(response)
  if (upstreamError) {
    const userOperationHash = getBundlerRequestUserOperationHash(bundlerRequest)
    onUpstreamError?.({
      error: upstreamError,
      id: bundlerRequest.id,
      method: bundlerRequest.method,
      ...(userOperationHash === null ? {} : { userOperationHash })
    })
    const retryReason =
      bundlerRequest.method === "eth_sendUserOperation"
        ? classifyUpstreamError?.(upstreamError)
        : null
    if (retryReason) {
      return Response.json(
        createJsonRpcError({
          code: sliceBundlerRetryRpcCode,
          data: {
            code: sliceBundlerRetryDataCode,
            provider: "alto-v2",
            reason: retryReason,
            version: "1"
          },
          id: bundlerRequest.id,
          message: "Bundler rejected the user operation fee parameters."
        }),
        { status: response.status }
      )
    }
  }

  return createProxyResponse(response)
}

export const handleSliceBundlerRequest = async (
  request: Request,
  {
    acceptedSenderCode,
    acceptedChainIds,
    acceptUserOperation,
    authorizeUserOperation,
    bundlerRpcUrl: bundlerRpcUrlOverride,
    cdpApiKey,
    chainId = base.id,
    classifyUpstreamError,
    eip7702DelegateAllowlist = [],
    fetchBundler = fetch,
    fetchSenderAccount,
    fetchSlicer,
    onUpstreamError,
    policyBaseUrl,
    requireVerifiedSender,
    serializedBundlerRpcUrls
  }: HandleSliceBundlerRequestOptions
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

  const bundlerRequest = parseSliceBundlerRequest(body)
  if (!bundlerRequest) {
    return Response.json(
      createJsonRpcError({
        code: -32600,
        message: "Invalid JSON-RPC bundler request"
      }),
      { status: 400 }
    )
  }

  let bundlerRpcUrl: string | null
  try {
    bundlerRpcUrl = getSliceBundlerRpcUrl({
      ...(bundlerRpcUrlOverride === undefined
        ? {}
        : { bundlerRpcUrl: bundlerRpcUrlOverride }),
      cdpApiKey,
      chainId,
      ...(serializedBundlerRpcUrls === undefined
        ? {}
        : { serializedBundlerRpcUrls })
    })
  } catch {
    bundlerRpcUrl = null
  }
  if (!bundlerRpcUrl) {
    return Response.json(
      createJsonRpcError({
        code: -32603,
        id: bundlerRequest.id,
        message: "Bundler is not configured"
      }),
      { status: 500 }
    )
  }

  if (
    isUserOperationBundlerRequest(bundlerRequest) &&
    !(await isAcceptedBundlerUserOperationRequest(bundlerRequest, {
      ...(acceptedSenderCode === undefined ? {} : { acceptedSenderCode }),
      ...(acceptedChainIds === undefined ? {} : { acceptedChainIds }),
      ...(acceptUserOperation === undefined ? {} : { acceptUserOperation }),
      ...(authorizeUserOperation === undefined
        ? {}
        : { authorizeUserOperation }),
      chainId,
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
        id: bundlerRequest.id,
        message: "Not an accepted Slice operation"
      }),
      { status: 403 }
    )
  }

  return forwardBundlerRequest({
    bundlerRequest,
    bundlerRpcUrl,
    ...(classifyUpstreamError === undefined && chainId !== 31_337
      ? {}
      : {
          classifyUpstreamError:
            classifyUpstreamError ?? classifyAltoBundlerRetryReason
        }),
    fetchBundler,
    onUpstreamError
  })
}
