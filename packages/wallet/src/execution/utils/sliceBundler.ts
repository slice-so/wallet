import type { Address, Hex } from "viem"
import { base } from "viem/chains"
import {
  classifyAltoBundlerRetryReason,
  createJsonRpcError,
  createSliceProxyResponse as createProxyResponse,
  createSliceSlicerAddressResolver,
  getSliceBundlerRequestUserOperationHash,
  isAcceptedSliceUserOperation,
  isSliceBundlerUserOperationRequest,
  type JsonValue,
  normalizeSliceBundlerRpcUrl,
  parseSliceBundlerRequest,
  readUpstreamJsonRpcError,
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
} from "../../protocol/execution"
import type { SliceBundlerRpcUrlParameters } from "../../types/bundler"

type SliceBundlerConfig = SliceBundlerRpcUrlParameters & {
  /** Adds a narrower condition after the built-in or replacement policy. */
  acceptUserOperation?: SliceBundlerUserOperationAuthorizer
  acceptedChainIds?: readonly number[]
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  acceptedTokenApprovalSpenders?: readonly Address[]
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
const sliceLocalBundlerRpcUrl = "http://localhost:4337"

/** Validates an application-resolved bundler URL, with a local Anvil default. */
export const getSliceBundlerRpcUrl = ({
  bundlerRpcUrl,
  chainId = base.id
}: SliceBundlerRpcUrlParameters) => {
  if (bundlerRpcUrl !== undefined) {
    const override = normalizeSliceBundlerRpcUrl(bundlerRpcUrl)
    if (override !== null) return override
  }

  if (chainId === 31_337) return sliceLocalBundlerRpcUrl
  return null
}

export const getSliceBundlerApiUrl = (origin: string | URL) =>
  new URL(sliceBundlerApiPath, origin).toString()

const isAcceptedBundlerUserOperationRequest = async (
  request: SliceBundlerUserOperationRequest,
  {
    acceptedSenderCode,
    acceptedChainIds,
    acceptedTokenApprovalSpenders,
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
    | "acceptedTokenApprovalSpenders"
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
          ...(acceptedTokenApprovalSpenders === undefined
            ? {}
            : { acceptedTokenApprovalSpenders }),
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
    acceptedSenderCode,
    acceptedChainIds,
    acceptedTokenApprovalSpenders,
    acceptUserOperation,
    authorizeUserOperation,
    bundlerRpcUrl: bundlerRpcUrlOverride,
    chainId = base.id,
    classifyUpstreamError,
    eip7702DelegateAllowlist = [],
    fetchBundler = fetch,
    fetchSenderAccount,
    fetchSlicer,
    onUpstreamError,
    policyBaseUrl,
    requireVerifiedSender
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
      chainId
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
      ...(acceptedTokenApprovalSpenders === undefined
        ? {}
        : { acceptedTokenApprovalSpenders }),
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
