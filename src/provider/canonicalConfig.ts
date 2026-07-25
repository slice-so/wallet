import { anvil } from "viem/chains"
import {
  getSliceWalletChainManifest,
  sliceWalletSupportedChainIds
} from "../chains"
import type { SliceWalletParameters } from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import { invalidProviderRequest } from "./errors"

const sliceIdOrigin = "https://id.slice.so"
const defaultSliceWalletChainId = 8453

const isLoopbackOrigin = (value: string) => {
  try {
    const url = new URL(value)
    return (
      url.origin === value &&
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

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
    "ceremonyMode",
    "chainIds",
    "defaultChainId",
    "grantPermissions",
    "idOrigin",
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
  if (
    parameters.ceremonyMode !== undefined &&
    !["auto", "iframe", "popup"].includes(parameters.ceremonyMode)
  ) {
    throw invalidProviderRequest("Slice Wallet ceremonyMode is invalid.")
  }

  const chainIds = parameters.chainIds ?? [
    defaultSliceWalletChainId,
    ...sliceWalletSupportedChainIds.filter(
      (chainId) => chainId !== defaultSliceWalletChainId && chainId !== anvil.id
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
  if (chainIds.includes(anvil.id) && chainIds.length !== 1) {
    throw invalidProviderRequest(
      "The Anvil Slice Wallet chain cannot be mixed with production chains."
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
  const idOrigin = parameters.idOrigin ?? sliceIdOrigin
  if (idOrigin !== sliceIdOrigin && !isLoopbackOrigin(idOrigin)) {
    throw invalidProviderRequest(
      "Slice Wallet idOrigin must use id.slice.so or a loopback development origin."
    )
  }
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
    if (chainId === anvil.id) {
      if (idOrigin === sliceIdOrigin) {
        throw invalidProviderRequest(
          "The Anvil Slice Wallet chain requires a loopback idOrigin."
        )
      }
      if (
        overrides.bundlerUrl === undefined ||
        overrides.rpcUrl === undefined
      ) {
        throw invalidProviderRequest(
          "The Anvil Slice Wallet chain requires explicit loopback transports."
        )
      }
      const bundlerUrl = normalizeTransportUrl(
        overrides.bundlerUrl,
        "Bundler URL"
      )
      const rpcUrl = normalizeTransportUrl(overrides.rpcUrl, "RPC URL")
      if (
        !isLoopbackOrigin(new URL(bundlerUrl).origin) ||
        !isLoopbackOrigin(new URL(rpcUrl).origin)
      ) {
        throw invalidProviderRequest(
          "The Anvil Slice Wallet chain requires loopback transports."
        )
      }
      return { bundlerUrl, chain: anvil, rpcUrl }
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
  const grantPermissions = parameters.grantPermissions
  if (
    grantPermissions !== undefined &&
    (typeof grantPermissions !== "object" ||
      grantPermissions === null ||
      Array.isArray(grantPermissions) ||
      Object.keys(grantPermissions).some(
        (key) => key !== "expiry" && key !== "optional" && key !== "permissions"
      ) ||
      !Number.isSafeInteger(grantPermissions.expiry) ||
      !Array.isArray(grantPermissions.permissions) ||
      (grantPermissions.optional !== undefined &&
        typeof grantPermissions.optional !== "boolean"))
  ) {
    throw invalidProviderRequest(
      "Slice Wallet grantPermissions config is invalid."
    )
  }
  return {
    announce: parameters.announce ?? true,
    ceremonyMode: parameters.ceremonyMode ?? "auto",
    chains,
    defaultChainId,
    idOrigin,
    requireAdmittedChain: !chainIds.includes(anvil.id),
    ...(grantPermissions === undefined ? {} : { grantPermissions }),
    ...(session === undefined ? {} : { session })
  }
}
