import {
  type Address,
  type Hex,
  hexToBigInt,
  isAddress,
  isHex,
  maxUint256,
  numberToHex
} from "viem"
import {
  createErc20ApproveCallRule,
  createErc20TransferCallRule,
  createErc20TransferFromCallRule,
  createNativeTransferCallRule,
  getWalletPermissionValidAfter
} from "../policy"
import type {
  SliceWalletGenericPermission,
  SliceWalletProviderValue,
  WalletPolicyDescriptor
} from "../types"
import type {
  ParsedSliceWalletSendCalls,
  ParsedSliceWalletTransaction
} from "../types/providerInternal"
import { invalidProviderRequest, SliceWalletProviderRpcError } from "./errors"

type ProviderRecord = {
  readonly [key: string]: SliceWalletProviderValue | undefined
}

const record = (
  value: SliceWalletProviderValue | undefined,
  label: string
): ProviderRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidProviderRequest(`${label} must be an object.`)
  }
  return value as ProviderRecord
}

const array = (
  value: SliceWalletProviderValue | undefined,
  label: string
): readonly SliceWalletProviderValue[] => {
  if (!Array.isArray(value)) {
    throw invalidProviderRequest(`${label} must be an array.`)
  }
  return value
}

const assertKeys = (
  value: ProviderRecord,
  required: readonly string[],
  optional: readonly string[] = []
) => {
  const allowed = new Set([...required, ...optional])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidProviderRequest("Wallet request contains an unknown field.")
  }
  if (required.some((key) => !(key in value))) {
    throw invalidProviderRequest("Wallet request is missing a required field.")
  }
}

const string = (value: SliceWalletProviderValue | undefined, label: string) => {
  if (typeof value !== "string") {
    throw invalidProviderRequest(`${label} must be a string.`)
  }
  return value
}

const integer = (
  value: SliceWalletProviderValue | undefined,
  label: string
) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidProviderRequest(`${label} must be a safe integer.`)
  }
  return value
}

const address = (
  value: SliceWalletProviderValue | undefined,
  label: string
) => {
  const parsed = string(value, label)
  if (!isAddress(parsed)) {
    throw invalidProviderRequest(`${label} must be an address.`)
  }
  return parsed as Address
}

const hex = (value: SliceWalletProviderValue | undefined, label: string) => {
  const parsed = string(value, label)
  if (!isHex(parsed, { strict: true })) {
    throw invalidProviderRequest(`${label} must be hex.`)
  }
  return parsed as Hex
}

const quantity = (
  value: SliceWalletProviderValue | undefined,
  label: string
) => {
  let parsed: bigint
  if (typeof value === "bigint") parsed = value
  else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value)
  } else if (typeof value === "string" && isHex(value, { strict: true })) {
    parsed = hexToBigInt(value)
  } else {
    throw invalidProviderRequest(`${label} must be a hex quantity.`)
  }
  if (parsed < 0n || parsed > maxUint256) {
    throw invalidProviderRequest(`${label} is outside uint256.`)
  }
  return parsed
}

const normalizePositiveQuantity = (
  value: SliceWalletProviderValue | undefined,
  label: string
) => {
  const parsed = quantity(value, label)
  if (parsed === 0n) {
    throw invalidProviderRequest(`${label} must be greater than zero.`)
  }
  return numberToHex(parsed)
}

const isOptionalCapability = (value: SliceWalletProviderValue | undefined) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return (value as ProviderRecord).optional === true
}

export const assertSliceWalletCapabilities = ({
  capabilities,
  paymasterAvailable
}: {
  capabilities: SliceWalletProviderValue | undefined
  paymasterAvailable: boolean
}) => {
  if (capabilities === undefined) return
  const input = record(capabilities, "Wallet capabilities")
  for (const [name, value] of Object.entries(input)) {
    const supported =
      name === "atomic" || (name === "paymasterService" && paymasterAvailable)
    if (!supported && !isOptionalCapability(value)) {
      throw new SliceWalletProviderRpcError(
        5700,
        `Unsupported required wallet capability: ${name}.`
      )
    }
  }
}

export const parseSliceWalletSendCalls = ({
  account,
  chainId,
  params,
  paymasterAvailable
}: {
  account: Address
  chainId: number
  params: SliceWalletProviderValue | undefined
  paymasterAvailable: boolean
}): ParsedSliceWalletSendCalls => {
  const items = array(params, "wallet_sendCalls params")
  if (items.length !== 1) {
    throw invalidProviderRequest("wallet_sendCalls expects one parameter.")
  }
  const input = record(items[0], "wallet_sendCalls request")
  assertKeys(
    input,
    ["atomicRequired", "calls", "version"],
    ["capabilities", "chainId", "from", "id"]
  )
  if (input.version !== "2.0.0") {
    throw invalidProviderRequest(
      "Slice Wallet supports wallet_sendCalls 2.0.0."
    )
  }
  if (typeof input.atomicRequired !== "boolean") {
    throw invalidProviderRequest("atomicRequired must be boolean.")
  }
  if (
    input.from !== undefined &&
    address(input.from, "Call sender").toLowerCase() !== account.toLowerCase()
  ) {
    throw new SliceWalletProviderRpcError(4100, "Call sender is not connected.")
  }
  if (input.chainId !== undefined) {
    const requestedChain = quantity(input.chainId, "Call chain id")
    if (requestedChain !== BigInt(chainId)) {
      throw new SliceWalletProviderRpcError(
        5710,
        "Requested chain is unsupported."
      )
    }
  }
  assertSliceWalletCapabilities({
    capabilities: input.capabilities,
    paymasterAvailable
  })
  const callInputs = array(input.calls, "Wallet calls")
  if (callInputs.length === 0 || callInputs.length > 64) {
    throw invalidProviderRequest(
      "Wallet calls must contain between 1 and 64 calls."
    )
  }
  const calls = callInputs.map((value) => {
    const call = record(value, "Wallet call")
    assertKeys(call, ["to"], ["capabilities", "data", "value"])
    assertSliceWalletCapabilities({
      capabilities: call.capabilities,
      paymasterAvailable
    })
    return {
      data: call.data === undefined ? "0x" : hex(call.data, "Call data"),
      to: address(call.to, "Call target"),
      value: call.value === undefined ? 0n : quantity(call.value, "Call value")
    }
  })
  const id = input.id === undefined ? undefined : string(input.id, "Call id")
  if (id !== undefined && (id.length === 0 || id.length > 4096)) {
    throw invalidProviderRequest(
      "Call id must contain between 1 and 4096 characters."
    )
  }
  return { calls, ...(id === undefined ? {} : { id }) }
}

export const parseSliceWalletTransaction = (
  params: SliceWalletProviderValue | undefined
): ParsedSliceWalletTransaction => {
  const items = array(params, "eth_sendTransaction params")
  if (items.length !== 1) {
    throw invalidProviderRequest("eth_sendTransaction expects one parameter.")
  }
  const input = record(items[0], "Transaction request")
  assertKeys(input, ["from", "to"], ["data", "value"])
  return {
    call: {
      data:
        input.data === undefined ? "0x" : hex(input.data, "Transaction data"),
      to: address(input.to, "Transaction target"),
      value:
        input.value === undefined
          ? 0n
          : quantity(input.value, "Transaction value")
    },
    from: address(input.from, "Transaction sender")
  }
}

const parseRateLimit = (
  value: SliceWalletProviderValue | undefined
): WalletPolicyDescriptor["rateLimit"] => {
  const policy = record(value, "Rate-limit policy")
  assertKeys(policy, ["data", "type"])
  if (policy.type !== "rate-limit") {
    throw invalidProviderRequest("Unsupported permission policy.")
  }
  const data = record(policy.data, "Rate-limit policy data")
  assertKeys(data, ["count", "intervalSec"])
  const count = integer(data.count, "Rate-limit count")
  const intervalSec = integer(data.intervalSec, "Rate-limit interval")
  if (count <= 0 || intervalSec <= 0) {
    throw invalidProviderRequest("Rate-limit values must be positive.")
  }
  return { count, intervalSec }
}

const parseGenericPermission = (
  value: SliceWalletProviderValue
): SliceWalletGenericPermission => {
  const permission = record(value, "Wallet permission")
  assertKeys(permission, ["data", "policies", "type"], ["required"])
  if (permission.type !== "slice-call") {
    throw invalidProviderRequest("Unsupported wallet permission type.")
  }
  if (
    permission.required !== undefined &&
    typeof permission.required !== "boolean"
  ) {
    throw invalidProviderRequest("Permission required flag must be boolean.")
  }
  const policies = array(permission.policies, "Permission policies")
  if (policies.length > 1) {
    throw invalidProviderRequest(
      "A permission supports at most one rate limit."
    )
  }
  const parsedPolicies = policies.map((policy) => {
    const data = parseRateLimit(policy)
    if (data === undefined) {
      throw invalidProviderRequest("Rate-limit policy is invalid.")
    }
    return { data, type: "rate-limit" as const }
  })
  const data = record(permission.data, "Permission data")
  const template = string(data.template, "Permission template")
  if (template === "native-transfer") {
    assertKeys(data, ["maximumValue", "recipient", "template"])
    return {
      data: {
        maximumValue: normalizePositiveQuantity(
          data.maximumValue,
          "Maximum native value"
        ),
        recipient: address(data.recipient, "Native transfer recipient"),
        template
      },
      policies: parsedPolicies,
      ...(permission.required === undefined
        ? {}
        : { required: permission.required }),
      type: "slice-call"
    }
  }
  if (template === "erc20-transfer") {
    assertKeys(data, ["maximumAmount", "recipient", "template", "token"])
    return {
      data: {
        maximumAmount: normalizePositiveQuantity(
          data.maximumAmount,
          "Maximum amount"
        ),
        recipient: address(data.recipient, "Token recipient"),
        template,
        token: address(data.token, "Token address")
      },
      policies: parsedPolicies,
      ...(permission.required === undefined
        ? {}
        : { required: permission.required }),
      type: "slice-call"
    }
  }
  if (template === "erc20-approve") {
    assertKeys(data, ["maximumAmount", "spender", "template", "token"])
    return {
      data: {
        maximumAmount: normalizePositiveQuantity(
          data.maximumAmount,
          "Maximum amount"
        ),
        spender: address(data.spender, "Token spender"),
        template,
        token: address(data.token, "Token address")
      },
      policies: parsedPolicies,
      ...(permission.required === undefined
        ? {}
        : { required: permission.required }),
      type: "slice-call"
    }
  }
  if (template === "erc20-transfer-from") {
    assertKeys(data, [
      "account",
      "maximumAmount",
      "recipient",
      "template",
      "token"
    ])
    return {
      data: {
        account: address(data.account, "Token source account"),
        maximumAmount: normalizePositiveQuantity(
          data.maximumAmount,
          "Maximum amount"
        ),
        recipient: address(data.recipient, "Token recipient"),
        template,
        token: address(data.token, "Token address")
      },
      policies: parsedPolicies,
      ...(permission.required === undefined
        ? {}
        : { required: permission.required }),
      type: "slice-call"
    }
  }
  throw invalidProviderRequest("Unsupported wallet permission template.")
}

const toPermissionCallRule = (permission: SliceWalletGenericPermission) => {
  const data = permission.data
  if (data.template === "native-transfer") {
    return createNativeTransferCallRule({
      maximumValue: hexToBigInt(data.maximumValue),
      recipient: data.recipient
    })
  }
  if (data.template === "erc20-transfer") {
    return createErc20TransferCallRule({
      maximumAmount: hexToBigInt(data.maximumAmount),
      recipient: data.recipient,
      token: data.token
    })
  }
  if (data.template === "erc20-approve") {
    return createErc20ApproveCallRule({
      maximumAmount: hexToBigInt(data.maximumAmount),
      spender: data.spender,
      token: data.token
    })
  }
  return createErc20TransferFromCallRule({
    account: data.account,
    maximumAmount: hexToBigInt(data.maximumAmount),
    recipient: data.recipient,
    token: data.token
  })
}

export const parseSliceWalletGrantPermissions = ({
  account,
  chainId,
  now,
  params
}: {
  account: Address
  chainId: number
  now: number
  params: SliceWalletProviderValue | undefined
}) => {
  const items = array(params, "wallet_grantPermissions params")
  if (items.length !== 1) {
    throw invalidProviderRequest(
      "wallet_grantPermissions expects one parameter."
    )
  }
  const input = record(items[0], "Permission request")
  assertKeys(input, ["expiry", "permissions"], ["signer"])
  if (input.signer !== undefined) {
    throw invalidProviderRequest(
      "Slice Wallet creates its permission signer inside the isolated frame."
    )
  }
  const expiresAt = integer(input.expiry, "Permission expiry")
  if (expiresAt <= now) {
    throw invalidProviderRequest("Permission expiry must be in the future.")
  }
  const requested = array(input.permissions, "Permissions")
  if (requested.length === 0 || requested.length > 16) {
    throw invalidProviderRequest("Request between 1 and 16 permissions.")
  }
  const permissions: SliceWalletGenericPermission[] = []
  for (const value of requested) {
    const candidate = record(value, "Wallet permission")
    try {
      permissions.push(parseGenericPermission(value))
    } catch (error) {
      if (candidate.required === false) continue
      throw error
    }
  }
  if (permissions.length === 0) {
    throw invalidProviderRequest(
      "No supported wallet permission was requested."
    )
  }
  const limits = permissions
    .flatMap((permission) => permission.policies)
    .map((policy) => policy.data)
  const rateLimit = limits[0]
  if (
    limits.some(
      (limit) =>
        rateLimit === undefined ||
        limit.count !== rateLimit.count ||
        limit.intervalSec !== rateLimit.intervalSec
    )
  ) {
    throw invalidProviderRequest(
      "All permissions in one grant must share the same rate limit."
    )
  }
  return {
    permissions,
    policy: {
      account,
      calls: permissions.map(toPermissionCallRule),
      chainId,
      grantKind: "generic" as const,
      ...(rateLimit === undefined ? {} : { rateLimit }),
      validAfter: getWalletPermissionValidAfter(now * 1_000),
      validUntil: expiresAt,
      version: 1 as const
    }
  }
}
