import {
  getSliceWalletChainManifest,
  sliceWalletSupportedChainIds
} from "../chains"
import type { SliceWalletParameters } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { invalidProviderRequest } from "./errors"

const sliceIdOrigin = "https://id.slice.so"
const defaultSliceWalletChainId = 8453

const isOrigin = (value: string) => {
  try {
    return new URL(value).origin === value
  } catch {
    return false
  }
}

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
    "session",
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

  const chainIds = parameters.chainIds ?? [
    defaultSliceWalletChainId,
    ...sliceWalletSupportedChainIds.filter(
      (chainId) => chainId !== defaultSliceWalletChainId
    )
  ]
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
  const defaultChainId =
    parameters.defaultChainId ??
    (chainIds.includes(defaultSliceWalletChainId)
      ? defaultSliceWalletChainId
      : chainIds[0])
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
  const session = parameters.session
  if (
    session !== undefined &&
    (typeof session !== "object" ||
      session === null ||
      Array.isArray(session) ||
      Object.keys(session).some(
        (key) =>
          ![
            "audience",
            "onSession",
            "prepare",
            "scopes",
            "ttlSeconds"
          ].includes(key)
      ) ||
      typeof session.audience !== "string" ||
      !isOrigin(session.audience) ||
      typeof session.prepare !== "function" ||
      (session.onSession !== undefined &&
        typeof session.onSession !== "function") ||
      (session.scopes !== undefined &&
        (!Array.isArray(session.scopes) ||
          session.scopes.some((scope) => typeof scope !== "string"))) ||
      (session.ttlSeconds !== undefined &&
        (!Number.isSafeInteger(session.ttlSeconds) || session.ttlSeconds <= 0)))
  ) {
    throw invalidProviderRequest("Slice Wallet session config is invalid.")
  }
  return {
    announce: parameters.announce ?? true,
    chains,
    defaultChainId,
    idOrigin: sliceIdOrigin,
    requireAdmittedChain: true,
    ...(session === undefined ? {} : { session })
  }
}
