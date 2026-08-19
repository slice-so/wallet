import {
  isJsonObject,
  type JsonValue,
  type SliceUpstreamJsonRpcError
} from "@slicekit/wallet-protocol/execution"

export {
  createSliceProxyResponse as createProxyResponse,
  createSliceSenderAccountFetch,
  createSliceSlicerAddressResolver
} from "@slicekit/wallet-protocol/execution"

export const readUpstreamJsonRpcError = async (
  response: Response
): Promise<SliceUpstreamJsonRpcError | null> => {
  let body: JsonValue
  try {
    body = (await response.clone().json()) as JsonValue
  } catch {
    return null
  }

  if (!isJsonObject(body) || !isJsonObject(body.error)) return null

  const { code, data, message } = body.error
  if (typeof code !== "number" || typeof message !== "string") return null

  return {
    code,
    ...(data === undefined ? {} : { data }),
    message
  }
}
