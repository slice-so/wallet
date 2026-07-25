import { type Client, type Hex, isAddress, isHex } from "viem"
import { parseSliceWalletGrantPermissions } from "../provider/protocol"
import type {
  SliceWalletGrantPermissionsRequest,
  SliceWalletPermissionGrant,
  SliceWalletProvider,
  SliceWalletProviderValue
} from "../types"

export const sliceWalletPermissionUnsupportedWalletErrorCode =
  "SLICE_PERMISSIONS_UNSUPPORTED" as const

export class SliceWalletPermissionUnsupportedWalletError extends Error {
  readonly code = sliceWalletPermissionUnsupportedWalletErrorCode

  constructor() {
    super("The connected wallet does not support Slice permissions v1.")
    this.name = "SliceWalletPermissionUnsupportedWalletError"
  }
}

type ProviderRecord = {
  readonly [key: string]: SliceWalletProviderValue | undefined
}

const record = (
  value: SliceWalletProviderValue | undefined,
  label: string
): ProviderRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as ProviderRecord
}

const parseAccount = (value: SliceWalletProviderValue | undefined) => {
  if (!Array.isArray(value) || value.length !== 1 || !isAddress(value[0])) {
    throw new Error("Slice permission actions require one connected account.")
  }
  return value[0]
}

const parseChainId = (value: SliceWalletProviderValue | undefined) => {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
    throw new Error("The connected wallet returned an invalid chain id.")
  }
  const parsed = BigInt(value)
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The connected wallet returned an invalid chain id.")
  }
  return Number(parsed)
}

const assertOnlyKeys = (
  value: ProviderRecord,
  keys: readonly string[],
  label: string
) => {
  const allowed = new Set(keys)
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} has an invalid shape.`)
  }
}

const parseGrant = (
  value: SliceWalletProviderValue | undefined,
  expected: { account: string; chainId: number }
): SliceWalletPermissionGrant => {
  const input = record(value, "Slice permission grant")
  assertOnlyKeys(
    input,
    [
      "account",
      "chainId",
      "createdAt",
      "expiresAt",
      "permissionId",
      "permissions",
      "version"
    ],
    "Slice permission grant"
  )
  if (
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    typeof input.chainId !== "number" ||
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    typeof input.createdAt !== "number" ||
    !Number.isSafeInteger(input.createdAt) ||
    typeof input.expiresAt !== "number" ||
    !Number.isSafeInteger(input.expiresAt) ||
    typeof input.permissionId !== "string" ||
    !isHex(input.permissionId, { strict: true }) ||
    !/^0x[0-9a-fA-F]{8}$/.test(input.permissionId) ||
    !Array.isArray(input.permissions) ||
    input.version !== "1" ||
    input.account.toLowerCase() !== expected.account.toLowerCase() ||
    input.chainId !== expected.chainId
  ) {
    throw new Error("Slice permission grant is invalid.")
  }
  const parsedRequest = parseSliceWalletGrantPermissions({
    account: input.account,
    chainId: input.chainId,
    now: input.createdAt,
    params: [{ expiry: input.expiresAt, permissions: input.permissions }]
  })
  return {
    account: input.account,
    chainId: input.chainId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    permissionId: input.permissionId.toLowerCase() as Hex,
    permissions: parsedRequest.permissions,
    version: "1"
  }
}

const permissionCapabilities = new WeakMap<
  Pick<SliceWalletProvider, "request">,
  Set<string>
>()

const assertPermissionCapability = async (
  provider: Pick<SliceWalletProvider, "request">
) => {
  const account = parseAccount(
    await provider.request({ method: "eth_accounts" })
  )
  const chainId = parseChainId(
    await provider.request({ method: "eth_chainId" })
  )
  const capabilityKey = `${account.toLowerCase()}:${chainId}`
  if (permissionCapabilities.get(provider)?.has(capabilityKey)) {
    return { account, chainId }
  }
  let capabilityValue: SliceWalletProviderValue | undefined
  try {
    capabilityValue = await provider.request({
      method: "wallet_getCapabilities",
      params: [account, [`0x${chainId.toString(16)}`]]
    })
  } catch {
    throw new SliceWalletPermissionUnsupportedWalletError()
  }
  if (
    typeof capabilityValue !== "object" ||
    capabilityValue === null ||
    Array.isArray(capabilityValue)
  ) {
    throw new SliceWalletPermissionUnsupportedWalletError()
  }
  const capabilities = capabilityValue as ProviderRecord
  const chainCapabilities = capabilities[`0x${chainId.toString(16)}`]
  if (
    typeof chainCapabilities !== "object" ||
    chainCapabilities === null ||
    Array.isArray(chainCapabilities)
  ) {
    throw new SliceWalletPermissionUnsupportedWalletError()
  }
  const permissionCapability = Reflect.get(
    chainCapabilities,
    "slicePermissions"
  )
  if (
    typeof permissionCapability !== "object" ||
    permissionCapability === null ||
    Array.isArray(permissionCapability)
  ) {
    throw new SliceWalletPermissionUnsupportedWalletError()
  }
  const supportedTemplates = Reflect.get(
    permissionCapability,
    "supportedTemplates"
  )
  if (
    Reflect.get(permissionCapability, "version") !== "1" ||
    !Array.isArray(supportedTemplates) ||
    supportedTemplates.join(",") !==
      "native-transfer,erc20-transfer,erc20-approve,erc20-transfer-from"
  ) {
    throw new SliceWalletPermissionUnsupportedWalletError()
  }
  const supported = permissionCapabilities.get(provider) ?? new Set<string>()
  supported.add(capabilityKey)
  permissionCapabilities.set(provider, supported)
  return { account, chainId }
}

export const grantPermissions = async (
  provider: Pick<SliceWalletProvider, "request">,
  request: SliceWalletGrantPermissionsRequest
) => {
  const expected = await assertPermissionCapability(provider)
  return parseGrant(
    await provider.request({
      method: "wallet_grantPermissions",
      params: [request]
    }),
    expected
  )
}

export const getPermissions = async (
  provider: Pick<SliceWalletProvider, "request">
) => {
  const expected = await assertPermissionCapability(provider)
  const value = await provider.request({
    method: "wallet_getSessionPermissions",
    params: []
  })
  if (!Array.isArray(value)) {
    throw new Error("Slice permission list must be an array.")
  }
  return value.map((grant) => parseGrant(grant, expected))
}

export const rotatePermission = async (
  provider: Pick<SliceWalletProvider, "request">,
  permissionId: Hex
) => {
  const expected = await assertPermissionCapability(provider)
  return parseGrant(
    await provider.request({
      method: "wallet_rotateSessionPermission",
      params: [permissionId]
    }),
    expected
  )
}

export const revokePermission = async (
  provider: Pick<SliceWalletProvider, "request">,
  permissionId: Hex
) => {
  await assertPermissionCapability(provider)
  await provider.request({
    method: "wallet_revokeSessionPermission",
    params: [permissionId]
  })
}

const toPermissionProvider = (
  client: Client
): Pick<SliceWalletProvider, "request"> => ({
  request: (request) =>
    client.request(request as never) as Promise<
      SliceWalletProviderValue | undefined
    >
})

export const sliceWalletPermissionActions = (client: Client) => {
  const provider = toPermissionProvider(client)
  return {
    getPermissions: () => getPermissions(provider),
    grantPermissions: (request: SliceWalletGrantPermissionsRequest) =>
      grantPermissions(provider, request),
    revokePermission: (permissionId: Hex) =>
      revokePermission(provider, permissionId),
    rotatePermission: (permissionId: Hex) =>
      rotatePermission(provider, permissionId)
  }
}

export type SliceWalletPermissionActions = ReturnType<
  typeof sliceWalletPermissionActions
>
