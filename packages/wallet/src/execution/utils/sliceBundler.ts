import {
  classifyAltoBundlerRetryReason,
  createJsonRpcError,
  createSliceProxyResponse as createProxyResponse,
  createSliceSlicerAddressResolver,
  getSliceBundlerRequestUserOperationHash,
  isAcceptedSliceUserOperation,
  isJsonObject,
  isSliceBundlerUserOperationRequest,
  type JsonValue,
  normalizeSliceBundlerRpcUrl,
  parseSliceBundlerRequest,
  type SliceAcceptedSenderCode,
  type SliceBundlerMethod,
  type SliceBundlerRequest,
  type SliceBundlerUpstreamErrorClassifier,
  type SliceBundlerUserOperationAuthorizer,
  type SliceBundlerUserOperationRequest,
  type SliceJsonRpcId,
  type SliceSenderAccountFetch,
  type SliceUpstreamJsonRpcError,
  type SliceUserOperationPolicyFetch,
  sliceBundlerRetryDataCode,
  sliceBundlerRetryRpcCode
} from "@slicekit/wallet-primitives/execution"
import type { Address, Hex } from "viem"
import { base } from "viem/chains"
import type { SliceBundlerRpcUrlParameters } from "../../types/bundler"
import { getSlicePaymasterRpcUrl } from "./slicePaymaster"
import { readUpstreamJsonRpcError } from "./sliceUserOperationTransport"

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
export const sliceAllowanceExceededRpcCode = -32030
export {
  classifyAltoBundlerRetryReason,
  sliceBundlerRetryDataCode,
  sliceBundlerRetryRpcCode
} from "@slicekit/wallet-primitives/execution"

const sliceLocalBundlerRpcUrl = "http://localhost:4337"

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
  allowCdpFallback = false,
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
  if (allowCdpFallback && chainId === base.id) {
    return getSlicePaymasterRpcUrl({ cdpApiKey })
  }
  return null
}

export const getSliceBundlerApiUrl = (origin: string | URL) =>
  new URL(sliceBundlerApiPath, origin).toString()

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
          isSlicerAddress: createSliceSlicerAddressResolver({
            fetchSlicer,
            policyBaseUrl
          }),
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
    const userOperationHash =
      getSliceBundlerRequestUserOperationHash(bundlerRequest)
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
    allowCdpFallback,
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
      allowCdpFallback,
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
    isSliceBundlerUserOperationRequest(bundlerRequest) &&
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
