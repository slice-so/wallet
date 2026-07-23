import { type Address, type Hex, isAddress, isHex } from "viem"
import { normalizeWalletPolicyDescriptor } from "../policy"
import type {
  SliceWalletCheckoutGrant,
  SliceWalletFrameRequest,
  SliceWalletFrameSessionKey,
  SliceWalletProtocolValue,
  SliceWalletUnsignedUserOperation,
  WalletGrantKind,
  WalletPolicyCallRule,
  WalletPolicyDescriptor,
  WalletPolicyParameterRule
} from "../types"

type ProtocolRecord = { readonly [key: string]: SliceWalletProtocolValue }

const isRecord = (value: SliceWalletProtocolValue): value is ProtocolRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const record = (value: SliceWalletProtocolValue, label: string) => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

const assertKeys = (
  value: ProtocolRecord,
  required: readonly string[],
  optional: readonly string[] = []
) => {
  const allowed = new Set([...required, ...optional])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Slice wallet protocol contains an unknown field.")
  }
  if (required.some((key) => !(key in value))) {
    throw new Error("Slice wallet protocol is missing a required field.")
  }
}

const stringValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`)
  return value
}

const integerValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`)
  }
  return value
}

const bigintValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`${label} must be a non-negative bigint.`)
  }
  return value
}

const addressValue = (value: SliceWalletProtocolValue, label: string) => {
  const parsed = stringValue(value, label)
  if (!isAddress(parsed)) throw new Error(`${label} must be an address.`)
  return parsed as Address
}

const hexValue = (value: SliceWalletProtocolValue, label: string) => {
  const parsed = stringValue(value, label)
  if (!isHex(parsed, { strict: true })) throw new Error(`${label} must be hex.`)
  return parsed as Hex
}

const grantKindValue = (value: SliceWalletProtocolValue): WalletGrantKind => {
  if (value !== "checkout" && value !== "generic" && value !== "management") {
    throw new Error("Unsupported wallet grant kind.")
  }
  return value
}

const parseCheckoutGrant = (
  value: SliceWalletProtocolValue
): SliceWalletCheckoutGrant => {
  const input = record(value, "Checkout grant")
  assertKeys(
    input,
    ["allowanceUsdMicros", "coSignerAddress"],
    ["budgetPeriodSec"]
  )
  const allowanceUsdMicros = stringValue(
    input.allowanceUsdMicros,
    "Checkout allowance"
  )
  if (!/^\d+$/.test(allowanceUsdMicros) || BigInt(allowanceUsdMicros) <= 0n) {
    throw new Error("Checkout allowance must be a positive integer.")
  }
  const budgetPeriodSec =
    input.budgetPeriodSec === undefined
      ? undefined
      : integerValue(input.budgetPeriodSec, "Checkout budget period")
  if (budgetPeriodSec !== undefined && budgetPeriodSec <= 0) {
    throw new Error("Checkout budget period must be positive.")
  }
  return {
    allowanceUsdMicros,
    ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
    coSignerAddress: addressValue(input.coSignerAddress, "Checkout co-signer")
  }
}

const arrayValue = (
  value: SliceWalletProtocolValue,
  label: string
): readonly SliceWalletProtocolValue[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value
}

const parseSessionKey = (
  value: SliceWalletProtocolValue
): SliceWalletFrameSessionKey => {
  const input = record(value, "Session key")
  assertKeys(input, ["account", "chainId", "grantKind"], ["slicerId"])
  const grantKind = grantKindValue(input.grantKind)
  const slicerId =
    input.slicerId === undefined
      ? undefined
      : integerValue(input.slicerId, "Session slicer id")
  if (
    (grantKind === "management" && (slicerId === undefined || slicerId < 0)) ||
    (grantKind !== "management" && slicerId !== undefined)
  ) {
    throw new Error("Management session keys require a non-negative slicer id.")
  }
  return {
    account: addressValue(input.account, "Session account"),
    chainId: integerValue(input.chainId, "Session chain id"),
    grantKind,
    ...(slicerId === undefined ? {} : { slicerId })
  }
}

const parseParameterRule = (
  value: SliceWalletProtocolValue
): WalletPolicyParameterRule => {
  const input = record(value, "Policy parameter rule")
  assertKeys(input, ["condition", "offset", "params"])
  if (
    input.condition !== "equal" &&
    input.condition !== "greater_than" &&
    input.condition !== "less_than_or_equal"
  ) {
    throw new Error("Unsupported policy parameter condition.")
  }
  return {
    condition: input.condition,
    offset: integerValue(input.offset, "Policy parameter offset"),
    params: arrayValue(input.params, "Policy parameter values").map((item) =>
      hexValue(item, "Policy parameter value")
    )
  }
}

const parseCallRule = (
  value: SliceWalletProtocolValue
): WalletPolicyCallRule => {
  const input = record(value, "Policy call rule")
  assertKeys(input, ["parameterRules", "selector", "target", "valueLimit"])
  return {
    parameterRules: arrayValue(
      input.parameterRules,
      "Policy parameter rules"
    ).map(parseParameterRule),
    selector: hexValue(input.selector, "Policy selector"),
    target: addressValue(input.target, "Policy target"),
    valueLimit: bigintValue(input.valueLimit, "Policy value limit")
  }
}

export const parseSliceWalletPolicyDescriptor = (
  value: SliceWalletProtocolValue
): WalletPolicyDescriptor => {
  const input = record(value, "Policy descriptor")
  assertKeys(
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

  let rateLimit: WalletPolicyDescriptor["rateLimit"]
  if (input.rateLimit !== undefined) {
    const value = record(input.rateLimit, "Policy rate limit")
    assertKeys(value, ["count", "intervalSec"])
    rateLimit = {
      count: integerValue(value.count, "Policy rate count"),
      intervalSec: integerValue(value.intervalSec, "Policy rate interval")
    }
  }

  return normalizeWalletPolicyDescriptor({
    account: addressValue(input.account, "Policy account"),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    calls: arrayValue(input.calls, "Policy calls").map(parseCallRule),
    chainId: integerValue(input.chainId, "Policy chain id"),
    grantKind: grantKindValue(input.grantKind),
    validAfter: integerValue(input.validAfter, "Policy valid-after"),
    validUntil: integerValue(input.validUntil, "Policy valid-until"),
    version: 1
  })
}

export const parseSliceWalletUnsignedUserOperation = (
  value: SliceWalletProtocolValue
): SliceWalletUnsignedUserOperation => {
  const input = record(value, "Unsigned user operation")
  assertKeys(
    input,
    [
      "callData",
      "callGasLimit",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "nonce",
      "preVerificationGas",
      "sender",
      "verificationGasLimit"
    ],
    [
      "factory",
      "factoryData",
      "paymaster",
      "paymasterData",
      "paymasterPostOpGasLimit",
      "paymasterVerificationGasLimit"
    ]
  )

  const optionalAddress = (key: "factory" | "paymaster") =>
    input[key] === undefined ? {} : { [key]: addressValue(input[key], key) }
  const optionalHex = (key: "factoryData" | "paymasterData") =>
    input[key] === undefined ? {} : { [key]: hexValue(input[key], key) }
  const optionalBigint = (
    key: "paymasterPostOpGasLimit" | "paymasterVerificationGasLimit"
  ) => (input[key] === undefined ? {} : { [key]: bigintValue(input[key], key) })

  return {
    callData: hexValue(input.callData, "User operation calldata"),
    callGasLimit: bigintValue(input.callGasLimit, "User operation call gas"),
    ...optionalAddress("factory"),
    ...optionalHex("factoryData"),
    maxFeePerGas: bigintValue(input.maxFeePerGas, "User operation max fee"),
    maxPriorityFeePerGas: bigintValue(
      input.maxPriorityFeePerGas,
      "User operation priority fee"
    ),
    nonce: bigintValue(input.nonce, "User operation nonce"),
    ...optionalAddress("paymaster"),
    ...optionalHex("paymasterData"),
    ...optionalBigint("paymasterPostOpGasLimit"),
    ...optionalBigint("paymasterVerificationGasLimit"),
    preVerificationGas: bigintValue(
      input.preVerificationGas,
      "User operation pre-verification gas"
    ),
    sender: addressValue(input.sender, "User operation sender"),
    verificationGasLimit: bigintValue(
      input.verificationGasLimit,
      "User operation verification gas"
    )
  } as SliceWalletUnsignedUserOperation
}

export const parseSliceWalletFrameRequest = (
  value: SliceWalletProtocolValue
): SliceWalletFrameRequest => {
  const input = record(value, "Frame request")
  assertKeys(input, ["id", "method", "params", "version"])
  if (input.version !== 1)
    throw new Error("Unsupported wallet protocol version.")
  const id = stringValue(input.id, "Request id")
  const method = stringValue(input.method, "Request method")
  const params = record(input.params, "Request parameters")

  if (method === "createSession") {
    assertKeys(params, ["policy"], ["checkout", "slicerId"])
    const policy = parseSliceWalletPolicyDescriptor(params.policy)
    const checkout =
      params.checkout === undefined
        ? undefined
        : parseCheckoutGrant(params.checkout)
    const slicerId =
      params.slicerId === undefined
        ? undefined
        : integerValue(params.slicerId, "Session slicer id")
    if ((policy.grantKind === "checkout") !== (checkout !== undefined)) {
      throw new Error(
        "Checkout policy and checkout grant metadata must be provided together."
      )
    }
    if (
      (policy.grantKind === "management" &&
        (slicerId === undefined || slicerId < 0)) ||
      (policy.grantKind !== "management" && slicerId !== undefined)
    ) {
      throw new Error("Management sessions require a non-negative slicer id.")
    }
    return {
      id,
      method,
      params: {
        ...(checkout === undefined ? {} : { checkout }),
        policy,
        ...(slicerId === undefined ? {} : { slicerId })
      },
      version: 1
    }
  }
  if (
    method === "getSession" ||
    method === "getPendingSession" ||
    method === "clearSession" ||
    method === "commitSession" ||
    method === "discardSession" ||
    method === "consumeAuthorization"
  ) {
    return { id, method, params: parseSessionKey(params), version: 1 }
  }
  if (method === "lockAccount" || method === "getAccountLockState") {
    assertKeys(params, ["account"])
    return {
      id,
      method,
      params: { account: addressValue(params.account, "Wallet account") },
      version: 1
    }
  }
  if (method === "signCheckoutProposal") {
    assertKeys(params, ["callData", "nonce", "sender", "session"])
    return {
      id,
      method,
      params: {
        callData: hexValue(params.callData, "Checkout call data"),
        nonce: bigintValue(params.nonce, "Checkout account nonce"),
        sender: addressValue(params.sender, "Checkout sender"),
        session: parseSessionKey(params.session)
      },
      version: 1
    }
  }
  if (method === "signGrantProof") {
    assertKeys(params, ["expiresAt", "nonce", "scopes", "session"])
    return {
      id,
      method,
      params: {
        expiresAt: integerValue(params.expiresAt, "Grant expiration"),
        nonce: hexValue(params.nonce, "Grant nonce"),
        scopes: arrayValue(params.scopes, "Grant scopes").map((scope) =>
          stringValue(scope, "Grant scope")
        ),
        session: parseSessionKey(params.session)
      },
      version: 1
    }
  }
  if (method === "signCoSignRequest") {
    assertKeys(params, [
      "challenge",
      "delegationId",
      "expiresAt",
      "session",
      "userOperation"
    ])
    return {
      id,
      method,
      params: {
        challenge: hexValue(params.challenge, "Co-sign challenge"),
        delegationId: stringValue(params.delegationId, "Delegation id"),
        expiresAt: integerValue(params.expiresAt, "Co-sign expiration"),
        session: parseSessionKey(params.session),
        userOperation: parseSliceWalletUnsignedUserOperation(
          params.userOperation
        )
      },
      version: 1
    }
  }
  if (method === "signSessionRequest") {
    assertKeys(params, [
      "action",
      "challenge",
      "delegationId",
      "expiresAt",
      "session"
    ])
    if (
      params.action !== "finalize_replacement" &&
      params.action !== "predecessor_descriptors" &&
      params.action !== "revoke" &&
      params.action !== "status"
    ) {
      throw new Error("Unsupported wallet session request action.")
    }
    return {
      id,
      method,
      params: {
        action: params.action,
        challenge: hexValue(params.challenge, "Session request challenge"),
        delegationId: stringValue(params.delegationId, "Delegation id"),
        expiresAt: integerValue(params.expiresAt, "Session request expiration"),
        session: parseSessionKey(params.session)
      },
      version: 1
    }
  }
  if (method === "signScopedUserOperation") {
    assertKeys(params, ["session", "userOperation"])
    return {
      id,
      method,
      params: {
        session: parseSessionKey(params.session),
        userOperation: parseSliceWalletUnsignedUserOperation(
          params.userOperation
        )
      },
      version: 1
    }
  }

  throw new Error("Unsupported wallet frame method.")
}
