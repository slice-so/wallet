import { getSliceWalletChainPolicy } from "../chains"
import type { SliceWalletParameters } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { invalidProviderRequest } from "./errors"

const baseChainId = 8453
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

  const chainIds = parameters.chainIds ?? [baseChainId]
  if (
    !Array.isArray(chainIds) ||
    chainIds.length !== 1 ||
    chainIds[0] !== baseChainId
  ) {
    throw invalidProviderRequest(
      "This Slice Wallet release supports Base only."
    )
  }
  const defaultChainId = parameters.defaultChainId ?? baseChainId
  if (defaultChainId !== baseChainId) {
    throw invalidProviderRequest("The default Slice Wallet chain must be Base.")
  }

  const transports = parameters.transports ?? {}
  if (
    typeof transports !== "object" ||
    transports === null ||
    Array.isArray(transports) ||
    Object.keys(transports).some((chainId) => chainId !== String(baseChainId))
  ) {
    throw invalidProviderRequest(
      "Transport overrides must target a configured Slice Wallet chain."
    )
  }
  const overrides = transports[baseChainId] ?? {}
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

  const manifest = getSliceWalletChainPolicy(baseChainId)
  return {
    announce: parameters.announce ?? true,
    bundlerUrl:
      overrides.bundlerUrl === undefined
        ? manifest.defaultTransports.bundlerUrl
        : normalizeTransportUrl(overrides.bundlerUrl, "Bundler URL"),
    chain: manifest.chain,
    idOrigin: sliceIdOrigin,
    requireAdmittedChain: true,
    rpcUrl:
      overrides.rpcUrl === undefined
        ? manifest.defaultTransports.rpcUrl
        : normalizeTransportUrl(overrides.rpcUrl, "RPC URL")
  }
}
