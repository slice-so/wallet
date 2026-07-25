import { type Policy, PolicyFlags } from "@zerodev/permissions"
import {
  CallPolicyVersion,
  CallType,
  ParamCondition,
  toCallPolicy,
  toRateLimitPolicy,
  toTimestampPolicy
} from "@zerodev/permissions/policies"
import {
  type Address,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  hexToBigInt,
  isAddressEqual,
  keccak256,
  maxUint256,
  pad,
  slice,
  toFunctionSelector
} from "viem"
import { maximumBrowserGenericGrantTtlSec } from "./constants"
import type {
  SerializedWalletPolicyDescriptor,
  WalletCall,
  WalletGrantKind,
  WalletPolicyCallRule,
  WalletPolicyDescriptor,
  WalletPolicyJsonValue,
  WalletPolicyParameterCondition,
  WalletPolicyParameterRule
} from "./types/policy"

export type {
  SerializedWalletPolicyDescriptor,
  WalletCall,
  WalletGrantKind,
  WalletPolicyCallRule,
  WalletPolicyDescriptor,
  WalletPolicyJsonValue,
  WalletPolicyParameterCondition,
  WalletPolicyParameterRule
} from "./types/policy"

type WalletPolicyJsonRecord = {
  readonly [key: string]: WalletPolicyJsonValue | undefined
}

type SerializedWalletPolicyParameterRule =
  SerializedWalletPolicyDescriptor["calls"][number]["parameterRules"][number]

const walletPermissionActivationSkewSeconds = 300

export const getWalletPermissionValidAfter = (nowMs = Date.now()) =>
  Math.max(0, Math.floor(nowMs / 1_000) - walletPermissionActivationSkewSeconds)

const isWalletPolicyJsonRecord = (
  value: WalletPolicyJsonValue | undefined
): value is WalletPolicyJsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const getWalletPolicyJsonRecord = (
  value: WalletPolicyJsonValue | undefined,
  label: string
): WalletPolicyJsonRecord => {
  if (!isWalletPolicyJsonRecord(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

const assertWalletPolicyJsonKeys = (
  value: WalletPolicyJsonRecord,
  required: readonly string[],
  optional: readonly string[] = []
) => {
  const keys = new Set([...required, ...optional])
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new Error("Wallet policy contains an unknown field.")
  }
  if (required.some((key) => !(key in value))) {
    throw new Error("Wallet policy is missing a required field.")
  }
}

const getWalletPolicyJsonString = (
  value: WalletPolicyJsonValue | undefined,
  label: string
) => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`)
  return value
}

const getWalletPolicyJsonInteger = (
  value: WalletPolicyJsonValue | undefined,
  label: string
) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`)
  }
  return value
}

const getWalletPolicyJsonArray = (
  value: WalletPolicyJsonValue | undefined,
  label: string
) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value
}

const getWalletPolicyJsonHex = (
  value: WalletPolicyJsonValue | undefined,
  label: string
) => {
  const parsed = getWalletPolicyJsonString(value, label)
  if (!/^0x[0-9a-fA-F]*$/.test(parsed)) {
    throw new Error(`${label} must be hex.`)
  }
  return parsed as Hex
}

const getWalletPolicyJsonAddress = (
  value: WalletPolicyJsonValue | undefined,
  label: string
) => {
  const parsed = getWalletPolicyJsonString(value, label)
  if (!/^0x[0-9a-fA-F]{40}$/.test(parsed)) {
    throw new Error(`${label} must be an address.`)
  }
  return parsed as Address
}

const parseSerializedWalletPolicyParameterRule = (
  value: WalletPolicyJsonValue
): SerializedWalletPolicyParameterRule => {
  const input = getWalletPolicyJsonRecord(value, "Wallet policy parameter rule")
  assertWalletPolicyJsonKeys(input, ["condition", "offset", "params"])
  const condition = input.condition
  if (
    condition !== "equal" &&
    condition !== "greater_than" &&
    condition !== "less_than_or_equal"
  ) {
    throw new Error("Wallet policy parameter condition is unsupported.")
  }
  return {
    condition,
    offset: getWalletPolicyJsonInteger(input.offset, "Wallet policy offset"),
    params: getWalletPolicyJsonArray(
      input.params,
      "Wallet policy parameter values"
    ).map((item) =>
      getWalletPolicyJsonHex(item, "Wallet policy parameter value")
    )
  }
}

const parseSerializedWalletPolicyCallRule = (value: WalletPolicyJsonValue) => {
  const input = getWalletPolicyJsonRecord(value, "Wallet policy call rule")
  assertWalletPolicyJsonKeys(input, [
    "parameterRules",
    "selector",
    "target",
    "valueLimit"
  ])
  const valueLimit = getWalletPolicyJsonString(
    input.valueLimit,
    "Wallet policy value limit"
  )
  if (!/^\d+$/.test(valueLimit)) {
    throw new Error("Wallet policy value limit must be an unsigned integer.")
  }
  return {
    parameterRules: getWalletPolicyJsonArray(
      input.parameterRules,
      "Wallet policy parameter rules"
    ).map(parseSerializedWalletPolicyParameterRule),
    selector: getWalletPolicyJsonHex(input.selector, "Wallet policy selector"),
    target: getWalletPolicyJsonAddress(input.target, "Wallet policy target"),
    valueLimit
  }
}

export const parseSerializedWalletPolicyDescriptor = (
  value: WalletPolicyJsonValue
): WalletPolicyDescriptor => {
  const input = getWalletPolicyJsonRecord(value, "Wallet policy")
  assertWalletPolicyJsonKeys(
    input,
    [
      "account",
      "calls",
      "chainId",
      "grantKind",
      "validAfter",
      "validUntil",
      "version"
    ],
    ["rateLimit"]
  )
  if (input.version !== 1) throw new Error("Unsupported wallet policy version.")
  if (
    input.grantKind !== "checkout" &&
    input.grantKind !== "generic" &&
    input.grantKind !== "management"
  ) {
    throw new Error("Unsupported wallet grant kind.")
  }

  let rateLimit: WalletPolicyDescriptor["rateLimit"]
  if (input.rateLimit !== undefined) {
    const value = getWalletPolicyJsonRecord(
      input.rateLimit,
      "Wallet policy rate limit"
    )
    assertWalletPolicyJsonKeys(value, ["count", "intervalSec"])
    rateLimit = {
      count: getWalletPolicyJsonInteger(
        value.count,
        "Wallet policy rate count"
      ),
      intervalSec: getWalletPolicyJsonInteger(
        value.intervalSec,
        "Wallet policy rate interval"
      )
    }
  }

  return deserializeWalletPolicyDescriptor({
    account: getWalletPolicyJsonAddress(input.account, "Wallet policy account"),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    calls: getWalletPolicyJsonArray(input.calls, "Wallet policy calls").map(
      parseSerializedWalletPolicyCallRule
    ),
    chainId: getWalletPolicyJsonInteger(
      input.chainId,
      "Wallet policy chain id"
    ),
    grantKind: input.grantKind,
    validAfter: getWalletPolicyJsonInteger(
      input.validAfter,
      "Wallet policy valid-after"
    ),
    validUntil: getWalletPolicyJsonInteger(
      input.validUntil,
      "Wallet policy valid-until"
    ),
    version: 1
  })
}

export const serializeWalletPolicyDescriptor = (
  descriptor: WalletPolicyDescriptor
): SerializedWalletPolicyDescriptor => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  return {
    ...normalized,
    calls: normalized.calls.map((call) => ({
      ...call,
      parameterRules: call.parameterRules.map((rule) => ({
        ...rule,
        params: [...rule.params]
      })),
      valueLimit: call.valueLimit.toString()
    }))
  }
}

export const deserializeWalletPolicyDescriptor = (
  descriptor: SerializedWalletPolicyDescriptor
): WalletPolicyDescriptor =>
  normalizeWalletPolicyDescriptor({
    ...descriptor,
    calls: descriptor.calls.map((call) => {
      if (!/^\d+$/.test(call.valueLimit)) {
        throw new Error(
          "Wallet policy value limit must be an unsigned integer."
        )
      }
      return { ...call, valueLimit: BigInt(call.valueLimit) }
    })
  })

const grantKindCode = {
  checkout: 0,
  generic: 1,
  management: 2
} as const satisfies Record<WalletGrantKind, number>

const conditionCode = {
  equal: ParamCondition.EQUAL,
  greater_than: ParamCondition.GREATER_THAN,
  less_than_or_equal: ParamCondition.LESS_THAN_OR_EQUAL
} as const satisfies Record<WalletPolicyParameterCondition, ParamCondition>

const policyEncodingParameters = [
  { name: "version", type: "uint8" },
  { name: "chainId", type: "uint256" },
  { name: "account", type: "address" },
  { name: "grantKind", type: "uint8" },
  { name: "validAfter", type: "uint48" },
  { name: "validUntil", type: "uint48" },
  {
    components: [
      { name: "callType", type: "bytes1" },
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "valueLimit", type: "uint256" },
      {
        components: [
          { name: "condition", type: "uint8" },
          { name: "offset", type: "uint64" },
          { name: "params", type: "bytes32[]" }
        ],
        name: "rules",
        type: "tuple[]"
      }
    ],
    name: "calls",
    type: "tuple[]"
  },
  { name: "rateInterval", type: "uint48" },
  { name: "rateCount", type: "uint48" }
] as const

const normalizeRule = (
  rule: WalletPolicyParameterRule
): WalletPolicyParameterRule => {
  if (!Number.isSafeInteger(rule.offset) || rule.offset < 0) {
    throw new Error(
      "Policy parameter offsets must be non-negative safe integers."
    )
  }
  if (rule.params.length === 0) {
    throw new Error("Policy parameter rules require at least one value.")
  }
  if (rule.params.length !== 1) {
    throw new Error(
      "Supported policy parameter rules require exactly one value."
    )
  }
  return {
    condition: rule.condition,
    offset: rule.offset,
    params: [...rule.params].map(
      (value) => pad(value, { size: 32 }).toLowerCase() as Hex
    )
  }
}

const compareCallRules = (
  left: WalletPolicyCallRule,
  right: WalletPolicyCallRule
) => {
  const leftKey = `${left.target.toLowerCase()}:${left.selector.toLowerCase()}`
  const rightKey = `${right.target.toLowerCase()}:${right.selector.toLowerCase()}`
  return leftKey.localeCompare(rightKey)
}

const erc20TransferSelector = toFunctionSelector("transfer(address,uint256)")
const erc20ApproveSelector = toFunctionSelector("approve(address,uint256)")
const erc20TransferFromSelector = toFunctionSelector(
  "transferFrom(address,address,uint256)"
)

const isCanonicalAddressParameter = (value: Hex) =>
  /^0x0{24}[0-9a-f]{40}$/.test(value)

const assertGenericCallRule = (call: WalletPolicyCallRule) => {
  if (call.selector === "0x00000000") {
    if (call.parameterRules.length !== 0 || call.valueLimit <= 0n) {
      throw new Error("Generic native-transfer rule is non-canonical.")
    }
    return
  }
  if (call.valueLimit !== 0n) {
    throw new Error("Generic ERC-20 rules cannot transfer native value.")
  }
  const expectedOffsets =
    call.selector === erc20TransferFromSelector
      ? [0, 32, 64]
      : call.selector === erc20TransferSelector ||
          call.selector === erc20ApproveSelector
        ? [0, 32]
        : null
  if (
    expectedOffsets === null ||
    call.parameterRules.length !== expectedOffsets.length ||
    call.parameterRules.some(
      (rule, index) =>
        rule.offset !== expectedOffsets[index] ||
        rule.params.length !== 1 ||
        (index < expectedOffsets.length - 1
          ? rule.condition !== "equal" ||
            !isCanonicalAddressParameter(rule.params[0] as Hex)
          : rule.condition !== "less_than_or_equal" ||
            hexToBigInt(rule.params[0] as Hex) <= 0n)
    )
  ) {
    throw new Error("Generic ERC-20 call rule is non-canonical.")
  }
}

export const normalizeWalletPolicyDescriptor = (
  descriptor: WalletPolicyDescriptor
): WalletPolicyDescriptor => {
  if (descriptor.version !== 1)
    throw new Error("Unsupported wallet policy version.")
  if (!Number.isSafeInteger(descriptor.chainId) || descriptor.chainId <= 0) {
    throw new Error("Wallet policy chain id must be a positive safe integer.")
  }
  if (
    !Number.isSafeInteger(descriptor.validAfter) ||
    !Number.isSafeInteger(descriptor.validUntil) ||
    descriptor.validAfter < 0 ||
    descriptor.validUntil <= descriptor.validAfter
  ) {
    throw new Error("Wallet policy validity window is invalid.")
  }
  if (descriptor.calls.length === 0)
    throw new Error("Wallet policy requires at least one call rule.")
  if (descriptor.grantKind === "generic" && descriptor.calls.length > 16) {
    throw new Error("Generic wallet policies support at most 16 call rules.")
  }
  if (
    (descriptor.grantKind === "generic" &&
      descriptor.rateLimit === undefined) ||
    (descriptor.rateLimit !== undefined &&
      (!Number.isSafeInteger(descriptor.rateLimit.count) ||
        descriptor.rateLimit.count < 1 ||
        descriptor.rateLimit.count > 100 ||
        !Number.isSafeInteger(descriptor.rateLimit.intervalSec) ||
        descriptor.rateLimit.intervalSec < 60 ||
        descriptor.rateLimit.intervalSec >
          descriptor.validUntil - descriptor.validAfter))
  ) {
    throw new Error("Wallet policy call-count limit is invalid.")
  }
  if (
    descriptor.grantKind === "generic" &&
    descriptor.validUntil - descriptor.validAfter >
      maximumBrowserGenericGrantTtlSec + 300
  ) {
    throw new Error("Generic wallet policy exceeds the maximum lifetime.")
  }

  const calls = descriptor.calls
    .map((call) => ({
      parameterRules: call.parameterRules
        .map(normalizeRule)
        .sort((left, right) => left.offset - right.offset),
      selector: pad(call.selector, { size: 4 }).toLowerCase() as Hex,
      target: call.target.toLowerCase() as Address,
      valueLimit: call.valueLimit
    }))
    .sort(compareCallRules)

  const callKeys = calls.map(
    (call) => `${call.target.toLowerCase()}:${call.selector.toLowerCase()}`
  )
  if (new Set(callKeys).size !== callKeys.length) {
    throw new Error("Wallet policy contains duplicate call rules.")
  }
  if (calls.some((call) => call.valueLimit < 0n)) {
    throw new Error("Wallet policy value limits must be unsigned.")
  }
  if (descriptor.grantKind === "generic") {
    for (const call of calls) assertGenericCallRule(call)
  }

  return {
    ...descriptor,
    account: descriptor.account.toLowerCase() as Address,
    calls
  }
}

export const encodeWalletPolicyDescriptor = (
  descriptor: WalletPolicyDescriptor
): Hex => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  return encodeAbiParameters(policyEncodingParameters, [
    normalized.version,
    BigInt(normalized.chainId),
    normalized.account,
    grantKindCode[normalized.grantKind],
    normalized.validAfter,
    normalized.validUntil,
    normalized.calls.map((call) => ({
      callType: CallType.CALL,
      rules: call.parameterRules.map((rule) => ({
        condition: conditionCode[rule.condition],
        offset: BigInt(rule.offset),
        params: [...rule.params]
      })),
      selector: call.selector,
      target: call.target,
      valueLimit: call.valueLimit
    })),
    normalized.rateLimit?.intervalSec ?? 0,
    normalized.rateLimit?.count ?? 0
  ])
}

export const getWalletPolicyHash = (descriptor: WalletPolicyDescriptor) =>
  keccak256(encodeWalletPolicyDescriptor(descriptor))

export const getWalletPermissionId = (
  descriptor: WalletPolicyDescriptor,
  signerId: Address
) =>
  slice(
    keccak256(
      encodePacked(
        ["bytes32", "address"],
        [getWalletPolicyHash(descriptor), signerId]
      )
    ),
    0,
    4
  )

export const toWalletPermissionPolicies = (
  descriptor: WalletPolicyDescriptor
): readonly Policy[] => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  const policies: Policy[] = [
    toCallPolicy({
      permissions: normalized.calls.map((call) => ({
        callType: CallType.CALL,
        rules: call.parameterRules.map((rule) => ({
          condition: conditionCode[rule.condition],
          offset: rule.offset,
          params: [...rule.params]
        })),
        selector: call.selector,
        target: call.target,
        valueLimit: call.valueLimit
      })),
      policyVersion: CallPolicyVersion.V0_0_5
    }),
    toTimestampPolicy({
      validAfter: normalized.validAfter,
      validUntil: normalized.validUntil
    })
  ]

  if (normalized.rateLimit !== undefined) {
    policies.push(
      toRateLimitPolicy({
        count: normalized.rateLimit.count,
        interval: normalized.rateLimit.intervalSec,
        startAt: normalized.validAfter
      })
    )
  }
  return policies
}

export const getWalletPermissionInstallConfiguration = (
  descriptor: WalletPolicyDescriptor
) => {
  const policies = toWalletPermissionPolicies(descriptor)
  return {
    permissionFlag: PolicyFlags.NOT_FOR_VALIDATE_SIG,
    policies: policies.map((policy) => ({
      configuration: policy.getPolicyData(),
      identity: policy.getPolicyInfoInBytes(),
      type: policy.policyParams.type
    }))
  }
}

const equalAddressRule = (offset: number, address: Address) => ({
  condition: "equal" as const,
  offset,
  params: [pad(address, { size: 32 })]
})

const maximumAmountRule = (offset: number, maximum: bigint) => ({
  condition: "less_than_or_equal" as const,
  offset,
  params: [pad(`0x${maximum.toString(16)}`, { size: 32 })]
})

export const createPositiveAmountRule = (offset: number) => ({
  condition: "greater_than" as const,
  offset,
  params: [pad("0x00", { size: 32 })]
})

export const createNativeTransferCallRule = ({
  maximumValue,
  recipient
}: {
  maximumValue: bigint
  recipient: Address
}): WalletPolicyCallRule => ({
  parameterRules: [],
  selector: "0x00000000",
  target: recipient,
  valueLimit: maximumValue
})

export const createErc20TransferCallRule = ({
  maximumAmount,
  recipient,
  token
}: {
  maximumAmount: bigint
  recipient: Address
  token: Address
}): WalletPolicyCallRule => ({
  parameterRules: [
    equalAddressRule(0, recipient),
    maximumAmountRule(32, maximumAmount)
  ],
  selector: erc20TransferSelector,
  target: token,
  valueLimit: 0n
})

export const createErc20ApproveCallRule = ({
  maximumAmount,
  spender,
  token
}: {
  maximumAmount: bigint
  spender: Address
  token: Address
}): WalletPolicyCallRule => ({
  parameterRules: [
    equalAddressRule(0, spender),
    maximumAmountRule(32, maximumAmount)
  ],
  selector: erc20ApproveSelector,
  target: token,
  valueLimit: 0n
})

export const createErc20TransferFromCallRule = ({
  account,
  maximumAmount,
  recipient,
  token
}: {
  account: Address
  maximumAmount: bigint
  recipient: Address
  token: Address
}): WalletPolicyCallRule => ({
  parameterRules: [
    equalAddressRule(0, account),
    equalAddressRule(32, recipient),
    maximumAmountRule(64, maximumAmount)
  ],
  selector: erc20TransferFromSelector,
  target: token,
  valueLimit: 0n
})

export const assertWalletCallMatchesRule = (
  call: WalletCall,
  rule: WalletPolicyCallRule
) => {
  const value = call.value ?? 0n
  if (!isAddressEqual(call.to, rule.target) || value > rule.valueLimit) {
    throw new Error("Wallet call is outside the delegated policy.")
  }

  const data = call.data ?? "0x"
  if (rule.selector === "0x00000000") {
    if (data !== "0x")
      throw new Error("Native transfer policy does not allow calldata.")
    return
  }
  if (data.slice(0, 10).toLowerCase() !== rule.selector.toLowerCase()) {
    throw new Error("Wallet call selector is outside the delegated policy.")
  }

  for (const parameterRule of rule.parameterRules) {
    const start = 4 + parameterRule.offset
    const end = start + 32
    if (data.length < 2 + end * 2) {
      throw new Error("Wallet call parameter is missing.")
    }
    const actual = slice(data, start, end)
    const expected = parameterRule.params[0]
    const matches =
      parameterRule.condition === "equal"
        ? actual.toLowerCase() === expected.toLowerCase()
        : parameterRule.condition === "greater_than"
          ? hexToBigInt(actual) > hexToBigInt(expected)
          : hexToBigInt(actual) <= hexToBigInt(expected)
    if (!matches) {
      throw new Error("Wallet call parameter is outside the delegated policy.")
    }
  }
}

export const assertWalletCallsMatchPolicy = (
  calls: readonly WalletCall[],
  descriptor: WalletPolicyDescriptor
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  if (calls.length === 0) throw new Error("Wallet operation contains no calls.")
  for (const call of calls) {
    const matchingRule = normalized.calls.find(
      (rule) =>
        isAddressEqual(call.to, rule.target) &&
        (call.data ?? "0x").slice(0, 10).toLowerCase() ===
          (rule.selector === "0x00000000" ? "0x" : rule.selector.toLowerCase())
    )
    if (matchingRule === undefined) {
      throw new Error("Wallet call is not present in the delegated policy.")
    }
    assertWalletCallMatchesRule(call, matchingRule)
  }
}

export const unrestrictedNativeValueLimit = maxUint256
