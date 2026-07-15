import {
  getSliceWalletChainManifest,
  sliceWalletSupportedChainIds
} from "../chains"
import type { SliceWalletParameters } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { invalidProviderRequest } from "./errors"

const sliceIdOrigin = "https://id.slice.so"

const normalizeTransportUrl = (value: string, label: string) => {
  if (value.length > 2_048) {
    throw invalidProviderRequest(`${label} is too long.`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidProviderRequest(`${label} is invalid.`)
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  if (
    (url.protocol !== "https:" && !localHttp) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw invalidProviderRequest(`${label} is not permitted.`)
  }
  return url.href
}

export const resolveCanonicalSliceWalletConfig = (
  parameters: SliceWalletParameters = {}
): SliceWalletProviderConfig => {
  const allowedParameterKeys = new Set([
    "announce",
    "chainIds",
    "defaultChainId",
    "transports"
  ])
  if (Object.keys(parameters).some((key) => !allowedParameterKeys.has(key))) {
    throw invalidProviderRequest(
      "Slice Wallet config contains an unknown field."
    )
  }
  if (
    parameters.announce !== undefined &&
    typeof parameters.announce !== "boolean"
  ) {
    throw invalidProviderRequest("Slice Wallet announce must be boolean.")
  }

  const chainIds = parameters.chainIds ?? sliceWalletSupportedChainIds
  if (
    !Array.isArray(chainIds) ||
    chainIds.length === 0 ||
    new Set(chainIds).size !== chainIds.length ||
    chainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId <= 0)
  ) {
    throw invalidProviderRequest(
      "Slice Wallet requires unique supported chains."
    )
  }
  const defaultChainId = parameters.defaultChainId ?? chainIds[0]
  if (defaultChainId === undefined || !chainIds.includes(defaultChainId)) {
    throw invalidProviderRequest(
      "The default Slice Wallet chain must be configured."
    )
  }

  const transports = parameters.transports ?? {}
  if (
    typeof transports !== "object" ||
    transports === null ||
    Array.isArray(transports) ||
    Object.keys(transports).some(
      (chainId) => !chainIds.includes(Number(chainId))
    )
  ) {
    throw invalidProviderRequest(
      "Transport overrides must target a configured Slice Wallet chain."
    )
  }
  const chains = chainIds.map((chainId) => {
    const overrides = transports[chainId] ?? {}
    if (
      typeof overrides !== "object" ||
      overrides === null ||
      Array.isArray(overrides) ||
      Object.keys(overrides).some(
        (key) => key !== "bundlerUrl" && key !== "rpcUrl"
      )
    ) {
      throw invalidProviderRequest(
        "Transport overrides may contain only rpcUrl and bundlerUrl."
      )
    }
    const manifest = getSliceWalletChainManifest(chainId)
    return {
      bundlerUrl:
        overrides.bundlerUrl === undefined
          ? manifest.defaultTransports.bundlerUrl
          : normalizeTransportUrl(overrides.bundlerUrl, "Bundler URL"),
      chain: manifest.chain,
      rpcUrl:
        overrides.rpcUrl === undefined
          ? manifest.defaultTransports.rpcUrl
          : normalizeTransportUrl(overrides.rpcUrl, "RPC URL")
    }
  })
  return {
    announce: parameters.announce ?? true,
    chains,
    defaultChainId,
    idOrigin: sliceIdOrigin,
    requireAdmittedChain: true
  }
}
