import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  isHex
} from "viem"
import type {
  SliceWalletAccountActivity,
  SliceWalletAccountActivityBatchRequest,
  SliceWalletAccountActivityBatchResponse,
  SliceWalletAccountActivityField,
  SliceWalletActivityTokenDescriptor
} from "./types"

const batchSize = 64

const unavailableActivityField = (
  response: SliceWalletAccountActivityBatchResponse | undefined,
  label: string
): SliceWalletAccountActivityField<never> => ({
  error: {
    code: response?.error?.code ?? null,
    message:
      response?.error?.message ?? `${label} RPC returned an invalid response.`
  },
  status: "unavailable"
})

const chunks = <Value>(values: readonly Value[], size: number) => {
  const result: Value[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export const createSliceWalletAccountActivityBatchFetch =
  ({ fetch: fetchImpl = fetch, url }: { fetch?: typeof fetch; url: string }) =>
  async (requests: readonly SliceWalletAccountActivityBatchRequest[]) => {
    const response = await fetchImpl(url, {
      body: JSON.stringify(requests),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
    if (!response.ok) {
      throw new Error(
        `Wallet activity RPC failed with status ${response.status}.`
      )
    }
    const payload = (await response.json()) as
      | SliceWalletAccountActivityBatchResponse
      | readonly SliceWalletAccountActivityBatchResponse[]
    if (!Array.isArray(payload)) {
      throw new Error(
        "Wallet activity batch RPC returned a non-array response."
      )
    }
    return payload
  }

export const loadSliceWalletAccountActivity = async (
  addresses: readonly Address[],
  {
    batchFetch,
    tokens = []
  }: {
    batchFetch: (
      requests: readonly SliceWalletAccountActivityBatchRequest[]
    ) => Promise<readonly SliceWalletAccountActivityBatchResponse[]>
    tokens?: readonly SliceWalletActivityTokenDescriptor[]
  }
): Promise<readonly SliceWalletAccountActivity[]> => {
  const uniqueAddresses = [
    ...new Set(addresses.map((address) => address.toLowerCase()))
  ]
  const requests: SliceWalletAccountActivityBatchRequest[] = []
  let nextId = 1
  for (const address of uniqueAddresses) {
    requests.push(
      {
        id: nextId++,
        jsonrpc: "2.0",
        method: "eth_getCode",
        params: [address, "latest"]
      },
      {
        id: nextId++,
        jsonrpc: "2.0",
        method: "eth_getBalance",
        params: [address, "latest"]
      }
    )
  }
  for (const token of tokens) {
    for (const address of uniqueAddresses) {
      requests.push({
        id: nextId++,
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [address as Address],
              functionName: "balanceOf"
            }),
            to: token.address
          },
          "latest"
        ]
      })
    }
  }

  const responses = (
    await Promise.all(chunks(requests, batchSize).map(batchFetch))
  ).flat()
  const results = new Map(
    responses.map((response) => [response.id, response] as const)
  )
  let cursor = 1
  return uniqueAddresses.map((address, addressIndex) => {
    const codeResponse = results.get(cursor++)
    const nativeBalanceResponse = results.get(cursor++)
    const code = codeResponse?.result
    const nativeBalance = nativeBalanceResponse?.result
    const tokenBalances: Record<
      string,
      SliceWalletAccountActivityField<string>
    > = {}
    tokens.forEach((token, tokenIndex) => {
      const tokenOffset =
        uniqueAddresses.length * 2 +
        tokenIndex * uniqueAddresses.length +
        addressIndex +
        1
      const response = results.get(tokenOffset)
      const value = response?.result
      tokenBalances[token.symbol] =
        response?.error === undefined &&
        value !== undefined &&
        isHex(value, { strict: true })
          ? { status: "available", value: BigInt(value).toString() }
          : unavailableActivityField(response, `${token.symbol} balance`)
    })
    return {
      address: address as Address,
      code:
        codeResponse?.error === undefined &&
        code !== undefined &&
        isHex(code, { strict: true })
          ? {
              status: "available" as const,
              value: code === "0x" ? null : (code as Hex)
            }
          : unavailableActivityField(codeResponse, "Account code"),
      nativeBalance:
        nativeBalanceResponse?.error === undefined &&
        nativeBalance !== undefined &&
        isHex(nativeBalance, { strict: true })
          ? {
              status: "available" as const,
              value: BigInt(nativeBalance).toString()
            }
          : unavailableActivityField(nativeBalanceResponse, "Native balance"),
      tokenBalances
    }
  })
}
