import {
  type Address,
  type Hex,
  hexToBigInt,
  isAddress,
  isHex,
  maxUint256,
  numberToHex,
  toFunctionSelector
} from "viem"
import {
  maximumBrowserGenericGrantTtlSec,
  type WalletPolicyDescriptor
} from "../protocol/index"
import {
  createErc20ApproveCallRule,
  createErc20TransferCallRule,
  createErc20TransferFromCallRule,
  createNativeTransferCallRule,
  getWalletPermissionValidAfter,
  normalizeWalletPolicyDescriptor
} from "../protocol/policy"
import type {
  SliceWalletGenericPermission,
  SliceWalletProviderValue
} from "../types"
import type {
  ParsedSliceWalletSendCalls,
  ParsedSliceWalletTransaction,
  SliceWalletRequestPaymasterService
} from "../types/providerInternal"
import { invalidProviderRequest, SliceWalletProviderRpcError } from "./errors"
import { canonicalizeSliceWalletPaymasterContext } from "./paymasterContext"

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
  return parsed.toLowerCase() as Address
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
  if (typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
    parsed = hexToBigInt(value as Hex)
  } else {
    throw invalidProviderRequest(
      `${label} must be a canonical lowercase hex quantity.`
    )
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

const normalizePaymasterUrl = (value: SliceWalletProviderValue) => {
  const input = string(value, "Paymaster service URL")
  if (input.length > 2_048) {
    throw invalidProviderRequest("Paymaster service URL is too long.")
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw invalidProviderRequest("Paymaster service URL is invalid.")
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
    throw invalidProviderRequest("Paymaster service URL is not permitted.")
  }
  return url.href
}

const parseSliceWalletCapabilities = ({
  allowRequestPaymaster,
  capabilities,
  paymasterAvailable
}: {
  allowRequestPaymaster: boolean
  capabilities: SliceWalletProviderValue | undefined
  paymasterAvailable: boolean
}): SliceWalletRequestPaymasterService | undefined => {
  if (capabilities === undefined) return undefined
  const input = record(capabilities, "Wallet capabilities")
  let paymasterService: SliceWalletRequestPaymasterService | undefined
  for (const [name, value] of Object.entries(input)) {
    if (name === "atomic") continue
    if (name === "paymasterService" && allowRequestPaymaster) {
      const paymaster = record(value, "Paymaster service capability")
      assertKeys(paymaster, [], ["context", "optional", "url"])
      if (
        paymaster.optional !== undefined &&
        typeof paymaster.optional !== "boolean"
      ) {
        throw invalidProviderRequest(
          "Paymaster service optional flag must be boolean."
        )
      }
      const url =
        paymaster.url === undefined
          ? undefined
          : normalizePaymasterUrl(paymaster.url)
      const supported = url !== undefined || paymasterAvailable
      if (!supported) {
        if (paymaster.optional === true) continue
        throw new SliceWalletProviderRpcError(
          5700,
          "Unsupported required wallet capability: paymasterService."
        )
      }
      const context =
        paymaster.context === undefined
          ? undefined
          : canonicalizeSliceWalletPaymasterContext(paymaster.context)
      paymasterService = {
        ...(context === undefined ? {} : { context }),
        ...(url === undefined ? {} : { url })
      }
      continue
    }
    if (!isOptionalCapability(value)) {
      throw new SliceWalletProviderRpcError(
        5700,
        `Unsupported required wallet capability: ${name}.`
      )
    }
  }
  return paymasterService
}

export const assertSliceWalletCapabilities = ({
  capabilities,
  paymasterAvailable
}: {
  capabilities: SliceWalletProviderValue | undefined
  paymasterAvailable: boolean
}) => {
  parseSliceWalletCapabilities({
    allowRequestPaymaster: true,
    capabilities,
    paymasterAvailable
  })
}

export const parseSliceWalletSendCalls = ({
  account,
  chainId,
  params,
  paymasterAvailable,
  supportedChainIds = [chainId]
}: {
  account: Address
  chainId: number
  params: SliceWalletProviderValue | undefined
  paymasterAvailable: boolean | ((requestedChainId: number) => boolean)
  supportedChainIds?: readonly number[]
}): ParsedSliceWalletSendCalls => {
  const items = array(params, "wallet_sendCalls params")
  if (items.length !== 1) {
    throw invalidProviderRequest("wallet_sendCalls expects one parameter.")
  }
  const input = record(items[0], "wallet_sendCalls request")
  assertKeys(
    input,
    ["atomicRequired", "calls", "chainId", "version"],
    ["capabilities", "from", "id"]
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
  const requestedChain = quantity(input.chainId, "Call chain id")
  if (requestedChain > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidProviderRequest("Call chain id is too large.")
  }
  const requestedChainId = Number(requestedChain)
  if (!supportedChainIds.includes(requestedChainId)) {
    throw new SliceWalletProviderRpcError(
      5710,
      "Requested chain is unsupported."
    )
  }
  const paymasterService = parseSliceWalletCapabilities({
    allowRequestPaymaster: true,
    capabilities: input.capabilities,
    paymasterAvailable:
      typeof paymasterAvailable === "function"
        ? paymasterAvailable(requestedChainId)
        : paymasterAvailable
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
    parseSliceWalletCapabilities({
      allowRequestPaymaster: false,
      capabilities: call.capabilities,
      paymasterAvailable: false
    })
    return {
      data: call.data === undefined ? "0x" : hex(call.data, "Call data"),
      to: address(call.to, "Call target"),
      value: call.value === undefined ? 0n : quantity(call.value, "Call value")
    }
  })
  const id = input.id === undefined ? undefined : string(input.id, "Call id")
  if (
    id !== undefined &&
    (id.length === 0 || new TextEncoder().encode(id).length > 4_096)
  ) {
    throw invalidProviderRequest(
      "Call id must contain between 1 and 4096 characters."
    )
  }
  return {
    calls,
    chainId: requestedChainId,
    ...(id === undefined ? {} : { id }),
    ...(paymasterService === undefined ? {} : { paymasterService })
  }
}

export const parseSliceWalletTransaction = (
  params: SliceWalletProviderValue | undefined
): ParsedSliceWalletTransaction => {
  const items = array(params, "eth_sendTransaction params")
  if (items.length !== 1) {
    throw invalidProviderRequest("eth_sendTransaction expects one parameter.")
  }
  const input = record(items[0], "Transaction request")
  const ignoredQuantityFields = [
    "gas",
    "gasPrice",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
    "nonce",
    "type"
  ] as const
  assertKeys(
    input,
    ["from", "to"],
    ["chainId", "data", ...ignoredQuantityFields, "value"]
  )
  // EOA transaction gas and nonce hints cannot be honored by an ERC-4337
  // account. Validate their wire shape, then derive the UserOperation fields.
  for (const field of ignoredQuantityFields) {
    if (input[field] !== undefined) {
      quantity(input[field], `Transaction ${field}`)
    }
  }
  const transactionChainId =
    input.chainId === undefined
      ? undefined
      : quantity(input.chainId, "Transaction chainId")
  if (
    transactionChainId !== undefined &&
    transactionChainId > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw invalidProviderRequest("Transaction chainId is too large.")
  }
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
    ...(transactionChainId === undefined
      ? {}
      : { chainId: Number(transactionChainId) }),
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
  if (count < 1 || count > 100 || intervalSec < 60) {
    throw invalidProviderRequest(
      "Rate limit must use count 1 to 100 and an interval of at least 60 seconds."
    )
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
  if (policies.length !== 1) {
    throw invalidProviderRequest(
      "Every permission requires exactly one common rate limit."
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
      type: "slice-call"
    }
  }
  throw invalidProviderRequest("Unsupported wallet permission template.")
}

export const toSliceWalletGenericPermissionCallRule = (
  permission: SliceWalletGenericPermission
) => {
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

const erc20TransferSelector = toFunctionSelector("transfer(address,uint256)")
const erc20ApproveSelector = toFunctionSelector("approve(address,uint256)")
const erc20TransferFromSelector = toFunctionSelector(
  "transferFrom(address,address,uint256)"
)

const addressFromPolicyParameter = (value: Hex) =>
  `0x${value.slice(-40)}` as Address

export const toSliceWalletGenericPermissions = (
  descriptor: WalletPolicyDescriptor
): readonly SliceWalletGenericPermission[] => {
  const policy = normalizeWalletPolicyDescriptor(descriptor)
  if (policy.grantKind !== "generic" || policy.rateLimit === undefined) {
    throw new Error("Generic wallet permissions require a rate-limited policy.")
  }
  const policies = [
    { data: policy.rateLimit, type: "rate-limit" as const }
  ] as const

  return policy.calls.map((call): SliceWalletGenericPermission => {
    if (call.selector === "0x00000000") {
      return {
        data: {
          maximumValue: numberToHex(call.valueLimit),
          recipient: call.target,
          template: "native-transfer"
        },
        policies,
        type: "slice-call"
      }
    }

    const amount = call.parameterRules.at(-1)?.params[0]
    if (amount === undefined) {
      throw new Error("Generic wallet policy amount is unavailable.")
    }
    if (
      call.selector === erc20TransferSelector ||
      call.selector === erc20ApproveSelector
    ) {
      const recipient = call.parameterRules[0]?.params[0]
      if (recipient === undefined) {
        throw new Error("Generic wallet policy recipient is unavailable.")
      }
      return {
        data:
          call.selector === erc20TransferSelector
            ? {
                maximumAmount: numberToHex(hexToBigInt(amount)),
                recipient: addressFromPolicyParameter(recipient),
                template: "erc20-transfer",
                token: call.target
              }
            : {
                maximumAmount: numberToHex(hexToBigInt(amount)),
                spender: addressFromPolicyParameter(recipient),
                template: "erc20-approve",
                token: call.target
              },
        policies,
        type: "slice-call"
      }
    }
    if (call.selector === erc20TransferFromSelector) {
      const account = call.parameterRules[0]?.params[0]
      const recipient = call.parameterRules[1]?.params[0]
      if (account === undefined || recipient === undefined) {
        throw new Error("Generic wallet policy participants are unavailable.")
      }
      return {
        data: {
          account: addressFromPolicyParameter(account),
          maximumAmount: numberToHex(hexToBigInt(amount)),
          recipient: addressFromPolicyParameter(recipient),
          template: "erc20-transfer-from",
          token: call.target
        },
        policies,
        type: "slice-call"
      }
    }
    throw new Error("Unsupported generic wallet policy call rule.")
  })
}

const isOptionalPermission = (value: SliceWalletProviderValue) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Reflect.get(value, "required") === false

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
  if (expiresAt <= now || expiresAt - now > maximumBrowserGenericGrantTtlSec) {
    throw invalidProviderRequest(
      "Permission expiry must be within the next 30 days."
    )
  }
  const requested = array(input.permissions, "Permissions")
  if (requested.length === 0 || requested.length > 16) {
    throw invalidProviderRequest("Request between 1 and 16 permissions.")
  }
  const permissions: SliceWalletGenericPermission[] = []
  for (const value of requested) {
    try {
      permissions.push(parseGenericPermission(value))
    } catch (error) {
      if (!isOptionalPermission(value)) throw error
    }
  }
  if (permissions.length === 0) {
    throw invalidProviderRequest(
      "Permission request contains no supported permissions."
    )
  }
  const limits = permissions
    .flatMap((permission) => permission.policies)
    .map((policy) => policy.data)
  const rateLimit = limits[0]
  if (
    rateLimit === undefined ||
    rateLimit.intervalSec > expiresAt - now ||
    limits.some(
      (limit) =>
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
    policy: normalizeWalletPolicyDescriptor({
      account,
      calls: permissions.map(toSliceWalletGenericPermissionCallRule),
      chainId,
      grantKind: "generic" as const,
      rateLimit,
      validAfter: getWalletPermissionValidAfter(now * 1_000),
      validUntil: expiresAt,
      version: 1 as const
    })
  }
}
