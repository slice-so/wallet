import type { Hex } from "viem"
import type {
  SliceBundlerHashMethod,
  SliceBundlerMethod,
  SliceBundlerRequest,
  SliceBundlerSendMethod,
  SliceBundlerUserOperationRequest
} from "../../types/bundler"
import type { JsonValue } from "../../types/userOperation"
import {
  isAddressString,
  isHexString,
  isJsonObject,
  isJsonRpcId,
  parseSliceUserOperation
} from "./sliceUserOperationPolicy"

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

const isSliceBundlerMethod = (
  value: JsonValue | undefined
): value is SliceBundlerMethod =>
  typeof value === "string" &&
  supportedBundlerMethods.includes(value as SliceBundlerMethod)

const isSliceBundlerHashMethod = (
  value: SliceBundlerMethod
): value is SliceBundlerHashMethod =>
  hashBundlerMethods.includes(value as SliceBundlerHashMethod)

const isSliceBundlerUserOperationMethod = (
  value: SliceBundlerMethod
): value is SliceBundlerSendMethod =>
  userOperationBundlerMethods.includes(value as SliceBundlerSendMethod)

export const isSliceBundlerUserOperationRequest = (
  request: SliceBundlerRequest
): request is SliceBundlerUserOperationRequest =>
  isSliceBundlerUserOperationMethod(request.method)

export const getSliceBundlerRequestUserOperationHash = (
  request: SliceBundlerRequest
): Hex | null => {
  if (
    request.method !== "eth_getUserOperationReceipt" &&
    request.method !== "eth_getUserOperationByHash"
  ) {
    return null
  }
  return request.params[0]
}

export const parseSliceBundlerRequest = (
  body: JsonValue
): SliceBundlerRequest | null => {
  if (
    !isJsonObject(body) ||
    body.jsonrpc !== "2.0" ||
    !isJsonRpcId(body.id) ||
    !isSliceBundlerMethod(body.method) ||
    !Array.isArray(body.params)
  ) {
    return null
  }
  if (body.method === "eth_supportedEntryPoints") {
    return body.params.length === 0
      ? {
          jsonrpc: "2.0",
          id: body.id,
          method: body.method,
          params: [],
          raw: body
        }
      : null
  }
  if (isSliceBundlerHashMethod(body.method)) {
    const userOperationHash = body.params[0]
    return body.params.length === 1 &&
      isHexString(userOperationHash) &&
      userOperationHash.length === 66
      ? {
          jsonrpc: "2.0",
          id: body.id,
          method: body.method,
          params: [userOperationHash],
          raw: body
        }
      : null
  }
  if (!isSliceBundlerUserOperationMethod(body.method)) return null
  if (body.params.length !== 2) return null
  const [rawUserOperation, rawEntryPoint] = body.params
  const userOperation = parseSliceUserOperation(rawUserOperation)
  if (userOperation === null || !isAddressString(rawEntryPoint)) return null
  return {
    jsonrpc: "2.0",
    id: body.id,
    method: body.method,
    params: [userOperation, rawEntryPoint],
    raw: {
      ...body,
      params: body.params.map((parameter, index) =>
        index === 0 ? userOperation : parameter
      )
    }
  }
}

export const normalizeSliceBundlerRpcUrl = (value: string) => {
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
