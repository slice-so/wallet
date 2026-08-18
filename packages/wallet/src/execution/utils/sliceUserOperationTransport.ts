import {
  isHexString,
  isJsonObject,
  type JsonValue,
  type SliceSenderAccountFetch,
  type SliceSlicerAddressResolver,
  type SliceUpstreamJsonRpcError
} from "@slicekit/wallet-protocol/execution"
import type { Address, Hex } from "viem"
import type { SliceUserOperationPolicyFetch } from "../../types/userOperation"

/** Slot defined by ERC-1967 for the proxy implementation address. */
const erc1967ImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" satisfies Hex

export const createProxyResponse = (response: Response) => {
  const headers = new Headers()
  const contentType = response.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)

  return new Response(response.body, { headers, status: response.status })
}

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

export const createSliceSlicerAddressResolver = ({
  fetchSlicer,
  policyBaseUrl
}: {
  fetchSlicer: SliceUserOperationPolicyFetch
  policyBaseUrl: string | undefined
}): SliceSlicerAddressResolver => {
  return async (address: Address) => {
    if (policyBaseUrl === undefined) return false
    const url = new URL(
      `/slicers/validate-address/${encodeURIComponent(address)}`,
      policyBaseUrl
    ).toString()

    let response: Response
    try {
      response = await fetchSlicer(url, { method: "GET" })
    } catch {
      return false
    }
    if (!response.ok) return false

    let body: JsonValue
    try {
      body = (await response.json()) as JsonValue
    } catch {
      return false
    }
    return isJsonObject(body) && body.isSlicer === true
  }
}

/** Reads sender code and its ERC-1967 implementation slot in one RPC batch. */
export const createSliceSenderAccountFetch = ({
  fetchRpc = fetch,
  rpcUrl
}: {
  fetchRpc?: SliceUserOperationPolicyFetch
  rpcUrl: string
}): SliceSenderAccountFetch => {
  return async (sender) => {
    let response: Response
    try {
      response = await fetchRpc(rpcUrl, {
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getCode",
            params: [sender, "latest"]
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getStorageAt",
            params: [sender, erc1967ImplementationSlot, "latest"]
          }
        ]),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
    } catch {
      return null
    }
    if (!response.ok) return null

    let body: JsonValue
    try {
      body = (await response.json()) as JsonValue
    } catch {
      return null
    }
    if (!Array.isArray(body)) return null

    const results = new Map<number, JsonValue | undefined>()
    for (const item of body) {
      if (isJsonObject(item) && typeof item.id === "number") {
        results.set(item.id, item.result)
      }
    }
    const code = results.get(1)
    const implementation = results.get(2)
    if (!isHexString(code) || !isHexString(implementation)) return null

    return { code, erc1967Implementation: implementation }
  }
}
