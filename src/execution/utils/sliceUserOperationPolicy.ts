/** ERC-4337 envelope adapter over the decision core in sliceCallPolicy.ts. */

import {
  type Address,
  decodeFunctionData,
  type Hex,
  hexToBigInt,
  hexToNumber,
  isAddress,
  isHex,
  keccak256,
  sliceHex
} from "viem"
import {
  type EntryPointVersion,
  entryPoint06Address,
  entryPoint07Address,
  entryPoint08Address,
  entryPoint09Address
} from "viem/account-abstraction"
import type { SliceCheckoutSpendIntent } from "../../types/commerce"
import {
  defaultSliceChainId,
  supportedSliceCheckoutChainIds
} from "../generated/commerceFacts"
import {
  classifySliceSmartAccountCall,
  classifySliceSmartAccountCallsBatch,
  getSliceCheckoutSpendIntentFromCalls,
  isAcceptedSliceCallsOutcome
} from "./sliceCallPolicy"
import {
  sliceKernelBaseV33Addresses,
  sliceKernelTimelockPolicyAddress
} from "./sliceKernelAddresses"
import { getSliceSmartAccountCalls } from "./sliceSmartAccountCalls"
import { maxAcceptedSliceCallsPerBatch } from "./sliceUserOperationLimits"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue | undefined }
export type SliceJsonRpcId = string | number | null
export type SliceJsonRpcErrorCode =
  | -32700
  | -32600
  | -32603
  | -32031
  | -32030
  | -32000
export type SliceUpstreamJsonRpcError = {
  code: number
  data?: JsonValue
  message: string
}

export type SliceUserOperation = JsonObject & {
  sender: Address
  nonce: Hex
  callData: Hex
  factory?: Address | "0x7702"
  factoryData?: Hex
  initCode?: Hex
  eip7702Auth?: JsonValue
}

export type SliceUserOperationPolicyFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type SliceSenderAccountSnapshot = {
  code: Hex
  /** Raw 32-byte value of the ERC-1967 implementation slot. */
  erc1967Implementation: Hex
}

export type SliceSenderAccountFetch = (
  sender: Address
) => Promise<SliceSenderAccountSnapshot | null>

export type SliceAcceptedSenderCode = {
  codeHash: Hex
  /**
   * Required ERC-1967 implementation for proxies whose runtime code does not
   * embed the implementation address (it lives in the ERC-1967 slot, so the
   * code hash alone does not pin what the account executes).
   */
  erc1967Implementation?: Address
}

type SliceSenderVerification = "unknown" | "verified"

const supportedEntryPointAddressVersions = [
  { address: entryPoint06Address, version: "0.6" },
  { address: entryPoint07Address, version: "0.7" },
  { address: entryPoint08Address, version: "0.8" },
  { address: entryPoint09Address, version: "0.9" }
] as const satisfies readonly {
  address: Address
  version: EntryPointVersion
}[]

const userOperationQuantityFields = [
  "nonce",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit"
] as const
const eip7702AuthorizationQuantityFields = [
  "chainId",
  "nonce",
  "yParity"
] as const

const eip7702FactoryMarker = "0x7702" as const
const kernelMetaFactoryAbi = [
  {
    inputs: [
      { name: "factory", type: "address" },
      { name: "createData", type: "bytes" },
      { name: "salt", type: "bytes32" }
    ],
    name: "deployWithFactory",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "payable",
    type: "function"
  }
] as const
const sliceSponsorableFactories = [
  sliceKernelBaseV33Addresses.factory,
  sliceKernelBaseV33Addresses.metaFactory
] as const

/** Slot defined by ERC-1967 for the proxy implementation address. */
const erc1967ImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" satisfies Hex
/** EIP-7702 delegation designator prefix (0xef0100 || delegate address). */
const eip7702CodePrefix = "0xef0100"
const eip7702CodeLength = 2 + 23 * 2

/**
 * Runtime bytecode hash of accounts deployed by the pinned Slice Kernel
 * factory: a solady ERC-1967 proxy that delegates to the address stored in
 * the ERC-1967 implementation slot. The code does not embed the
 * implementation, so verification must also match the slot against the
 * pinned Kernel v3.3 implementation.
 */
export const sliceKernelBaseV33SenderCode = {
  codeHash:
    "0xaaa52c8cc8a0e3fd27ce756cc6b4e70c51423e9b597b11f32d3e49f8b1fc890d",
  erc1967Implementation: sliceKernelBaseV33Addresses.implementation
} as const satisfies SliceAcceptedSenderCode

const defaultAcceptedSenderCode = [
  sliceKernelBaseV33SenderCode
] as const satisfies readonly SliceAcceptedSenderCode[]

const isCanonicalSliceWalletFactoryData = (factoryData: Hex) => {
  try {
    const deployment = decodeFunctionData({
      abi: kernelMetaFactoryAbi,
      data: factoryData
    })
    return (
      deployment.functionName === "deployWithFactory" &&
      deployment.args[0].toLowerCase() ===
        sliceKernelBaseV33Addresses.factory.toLowerCase() &&
      deployment.args[1] !== "0x"
    )
  } catch {
    return false
  }
}

export const sliceUserOperationPolicyDescription = [
  "The UserOperation callData must decode as a supported smart-account execution envelope.",
  "Deployment UserOperations must use the pinned Slice Kernel factory or meta-factory.",
  "Every account call must be an accepted Slice protocol action, any FundsModule or indexed slicer action, a generated Slice hook, or an ERC20 approve whose spender is the chain's ProductsModule, FundsModule, or configured paymaster.",
  "Root-validated (passkey) UserOperations from a verified Slice Kernel sender may additionally administer the sender's own Kernel validations: installValidations, uninstallValidation, and grantAccess on the sender itself, plus recovery timelock cancelProposal for the sender.",
  "EIP-7702 authorizations must be chain-scoped to the request and use a configured trusted delegate contract.",
  "Batches are capped at 10 account calls, and at least one call must target a Slice protocol contract, indexed slicer contract, generated Slice hook, or accepted account administration, so approval-only batches are not accepted."
].join(" ")

export const createJsonRpcError = ({
  code,
  data,
  id,
  message
}: {
  code: SliceJsonRpcErrorCode
  data?: JsonValue
  id?: SliceJsonRpcId
  message: string
}) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) }
})

export const createProxyResponse = (response: Response) => {
  const headers = new Headers()
  const contentType = response.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)

  return new Response(response.body, { headers, status: response.status })
}

export const readUpstreamJsonRpcError = async (
  response: Response
): Promise<SliceUpstreamJsonRpcError | null> => {
  let body: JsonValue
  try {
    body = (await response.clone().json()) as JsonValue
  } catch {
    return null
  }

  if (!isJsonObject(body) || !isJsonObject(body.error)) return null

  const { code, data, message } = body.error
  if (typeof code !== "number" || typeof message !== "string") return null

  return {
    code,
    ...(data === undefined ? {} : { data }),
    message
  }
}

const normalizeAddress = (address: string) => address.toLowerCase()

export const getSupportedEntryPointVersion = (entryPoint: Address) =>
  supportedEntryPointAddressVersions.find(
    ({ address }) => normalizeAddress(address) === normalizeAddress(entryPoint)
  )?.version ?? null

export const isJsonObject = (
  value: JsonValue | undefined
): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

export const isJsonRpcId = (
  value: JsonValue | undefined
): value is SliceJsonRpcId =>
  value === undefined ||
  value === null ||
  typeof value === "string" ||
  typeof value === "number"

export const isHexString = (value: JsonValue | undefined): value is Hex =>
  typeof value === "string" && isHex(value)

export const isAddressString = (
  value: JsonValue | undefined
): value is Address => typeof value === "string" && isAddress(value)

const isJsonRpcQuantityString = (value: string) =>
  /^0x[0-9a-fA-F]+$/.test(value)

const normalizeJsonRpcQuantity = (value: JsonValue | undefined) => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `0x${value.toString(16)}`
  }
  if (typeof value !== "string" || !isJsonRpcQuantityString(value)) {
    return value
  }

  return `0x${BigInt(value).toString(16)}`
}

const normalizeJsonRpcQuantityFields = ({
  fields,
  object
}: {
  fields: readonly string[]
  object: JsonObject
}) => {
  let normalizedObject: JsonObject | null = null

  for (const field of fields) {
    const value = object[field]
    if (value === undefined) continue

    const normalizedValue = normalizeJsonRpcQuantity(value)
    if (normalizedValue === value) continue

    normalizedObject ??= { ...object }
    normalizedObject[field] = normalizedValue
  }

  return normalizedObject ?? object
}

const normalizeSliceUserOperationQuantities = (
  userOperation: JsonObject
): JsonObject => {
  let normalizedValue = normalizeJsonRpcQuantityFields({
    fields: userOperationQuantityFields,
    object: userOperation
  })

  if (isJsonObject(normalizedValue.eip7702Auth)) {
    const normalizedAuthorization = normalizeJsonRpcQuantityFields({
      fields: eip7702AuthorizationQuantityFields,
      object: normalizedValue.eip7702Auth
    })
    if (normalizedAuthorization !== normalizedValue.eip7702Auth) {
      normalizedValue = {
        ...normalizedValue,
        eip7702Auth: normalizedAuthorization
      }
    }
  }

  return normalizedValue
}

const getJsonObjectField = (object: JsonObject, keys: readonly string[]) => {
  for (const key of keys) {
    const value = object[key]
    if (value !== undefined) return value
  }
  return undefined
}

export const parseSliceUserOperation = (
  value: JsonValue | undefined
): SliceUserOperation | null => {
  if (!isJsonObject(value)) return null
  if (!isAddressString(value.sender)) return null
  if (!isHexString(value.nonce)) return null
  if (!isHexString(value.callData)) return null
  if (value.initCode !== undefined && !isHexString(value.initCode)) return null

  const factory =
    value.factory === eip7702FactoryMarker
      ? eip7702FactoryMarker
      : isAddressString(value.factory)
        ? value.factory
        : undefined
  if (value.factory !== undefined && factory === undefined) return null
  if (value.factoryData !== undefined && !isHexString(value.factoryData)) {
    return null
  }

  const normalizedValue = normalizeSliceUserOperationQuantities(value)
  const nonce = isHexString(normalizedValue.nonce)
    ? normalizedValue.nonce
    : value.nonce

  return {
    ...normalizedValue,
    sender: value.sender,
    nonce,
    callData: value.callData,
    ...(factory === undefined ? {} : { factory }),
    ...(value.factoryData === undefined
      ? {}
      : { factoryData: value.factoryData }),
    ...(value.initCode === undefined ? {} : { initCode: value.initCode })
  }
}

export const parseSliceChainId = (chainId: string | number) => {
  if (typeof chainId === "number") {
    return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null
  }
  if (/^0x[0-9a-fA-F]+$/.test(chainId)) return hexToNumber(chainId as Hex)
  if (/^\d+$/.test(chainId)) {
    const decimalChainId = Number(chainId)
    return Number.isSafeInteger(decimalChainId) && decimalChainId > 0
      ? decimalChainId
      : null
  }
  return null
}

const parseUserOperationNonce = (nonce: Hex): bigint | null => {
  try {
    return hexToBigInt(nonce)
  } catch {
    return null
  }
}

const eip7702DelegateAddressKeys = [
  "address",
  "contractAddress",
  "delegate",
  "delegateAddress",
  "implementation",
  "implementationAddress"
] as const
const eip7702ChainIdKeys = ["chainId", "chain_id"] as const

const getEip7702AuthorizationDelegate = (authorization: JsonObject) => {
  const rawDelegate = getJsonObjectField(
    authorization,
    eip7702DelegateAddressKeys
  )
  return isAddressString(rawDelegate) ? rawDelegate : null
}

const getEip7702AuthorizationChainId = (authorization: JsonObject) => {
  const rawChainId = getJsonObjectField(authorization, eip7702ChainIdKeys)
  return typeof rawChainId === "string" || typeof rawChainId === "number"
    ? rawChainId
    : null
}

const isAddressInList = (address: Address, addresses: readonly Address[]) =>
  addresses.some(
    (listedAddress) =>
      normalizeAddress(listedAddress) === normalizeAddress(address)
  )

const isAcceptedEip7702Authorization = ({
  authorization,
  requestChainId,
  trustedDelegates
}: {
  authorization: JsonValue | undefined
  requestChainId: string | number
  trustedDelegates: readonly Address[]
}) => {
  if (authorization === undefined) return true
  if (!isJsonObject(authorization)) return false

  const delegate = getEip7702AuthorizationDelegate(authorization)
  const authChainId = getEip7702AuthorizationChainId(authorization)
  if (!delegate || authChainId === null) return false

  const parsedAuthChainId = parseSliceChainId(authChainId)
  const parsedRequestChainId = parseSliceChainId(requestChainId)
  if (
    parsedAuthChainId === null ||
    parsedRequestChainId === null ||
    parsedAuthChainId !== parsedRequestChainId
  ) {
    return false
  }

  return (
    trustedDelegates.length > 0 && isAddressInList(delegate, trustedDelegates)
  )
}

const isAcceptedUserOperationFactory = (userOperation: SliceUserOperation) => {
  if (
    userOperation.factory !== undefined &&
    userOperation.factory !== eip7702FactoryMarker &&
    !isAddressInList(userOperation.factory, sliceSponsorableFactories)
  ) {
    return false
  }

  if (userOperation.initCode !== undefined && userOperation.initCode !== "0x") {
    const initCodeFactoryHexLength = 2 + 20 * 2
    if (userOperation.initCode.length < initCodeFactoryHexLength) {
      return false
    }

    const initCodeFactory = sliceHex(userOperation.initCode, 0, 20)
    if (
      !isAddress(initCodeFactory) ||
      !isAddressInList(initCodeFactory, sliceSponsorableFactories)
    ) {
      return false
    }
  }

  return true
}

const isIndexedSlicerAddress = async ({
  address,
  fetchSlicer,
  policyBaseUrl
}: {
  address: Address
  fetchSlicer: SliceUserOperationPolicyFetch
  policyBaseUrl?: string
}) => {
  if (policyBaseUrl === undefined) return false
  const url = new URL(
    `/slicers/validate-address/${encodeURIComponent(address)}`,
    policyBaseUrl
  ).toString()

  let response: Response
  try {
    response = await fetchSlicer(url, { method: "GET" })
  } catch {
    return false
  }

  if (!response.ok) return false

  let body: JsonValue
  try {
    body = (await response.json()) as JsonValue
  } catch {
    return false
  }

  return isJsonObject(body) && body.isSlicer === true
}

/**
 * Reads the sender's runtime code and ERC-1967 implementation slot in a
 * single batched JSON-RPC request. Returns null on RPC failure so the
 * policy fails closed.
 */
export const createSliceSenderAccountFetch = ({
  fetchRpc = fetch,
  rpcUrl
}: {
  fetchRpc?: SliceUserOperationPolicyFetch
  rpcUrl: string
}): SliceSenderAccountFetch => {
  return async (sender) => {
    let response: Response
    try {
      response = await fetchRpc(rpcUrl, {
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getCode",
            params: [sender, "latest"]
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "eth_getStorageAt",
            params: [sender, erc1967ImplementationSlot, "latest"]
          }
        ]),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
    } catch {
      return null
    }
    if (!response.ok) return null

    let body: JsonValue
    try {
      body = (await response.json()) as JsonValue
    } catch {
      return null
    }
    if (!Array.isArray(body)) return null

    const results = new Map<number, JsonValue | undefined>()
    for (const item of body) {
      if (isJsonObject(item) && typeof item.id === "number") {
        results.set(item.id, item.result)
      }
    }
    const code = results.get(1)
    const implementation = results.get(2)
    if (!isHexString(code) || !isHexString(implementation)) return null

    return {
      code,
      erc1967Implementation: implementation
    }
  }
}

const matchesAcceptedSenderCode = (
  snapshot: SliceSenderAccountSnapshot,
  acceptedSenderCode: readonly SliceAcceptedSenderCode[]
) => {
  const codeHash = keccak256(snapshot.code)
  const slotImplementation =
    snapshot.erc1967Implementation.length === 66
      ? sliceHex(snapshot.erc1967Implementation, 12, 32)
      : null

  return acceptedSenderCode.some((entry) => {
    if (normalizeAddress(entry.codeHash) !== normalizeAddress(codeHash)) {
      return false
    }
    if (entry.erc1967Implementation === undefined) return true
    return (
      slotImplementation !== null &&
      normalizeAddress(slotImplementation) ===
        normalizeAddress(entry.erc1967Implementation)
    )
  })
}

const hasDeploymentArgs = (userOperation: SliceUserOperation) =>
  userOperation.factory !== undefined ||
  (userOperation.initCode !== undefined && userOperation.initCode !== "0x")

/**
 * Verifies the sender is an account whose execution semantics are known:
 * a deployed account matching an accepted code hash (and pinned ERC-1967
 * implementation where required), an undeployed account carrying deployment
 * args (already pinned to the Slice Kernel factories), or an EIP-7702
 * account delegating to an allowlisted contract. Without this, the policy
 * decodes callData on trust — a malicious account contract could declare
 * accepted calls and execute something else.
 */
const verifySliceSenderAccount = async ({
  acceptedSenderCode,
  eip7702DelegateAllowlist,
  fetchSenderAccount,
  userOperation
}: {
  acceptedSenderCode: readonly SliceAcceptedSenderCode[]
  eip7702DelegateAllowlist: readonly Address[]
  fetchSenderAccount: SliceSenderAccountFetch
  userOperation: SliceUserOperation
}): Promise<SliceSenderVerification> => {
  const snapshot = await fetchSenderAccount(userOperation.sender)
  if (!snapshot) return "unknown"

  if (snapshot.code === "0x") {
    return hasDeploymentArgs(userOperation) ? "verified" : "unknown"
  }

  if (snapshot.code.toLowerCase().startsWith(eip7702CodePrefix)) {
    if (snapshot.code.length !== eip7702CodeLength) return "unknown"
    const delegate = sliceHex(snapshot.code, 3, 23)
    return isAddress(delegate) &&
      isAddressInList(delegate, eip7702DelegateAllowlist)
      ? "verified"
      : "unknown"
  }

  return matchesAcceptedSenderCode(snapshot, acceptedSenderCode)
    ? "verified"
    : "unknown"
}

/**
 * Public wallet bundlers do not sponsor calls, so they constrain account
 * identity rather than call intent. Only the configured canonical Kernel v3.3
 * account and EntryPoint v0.7 deployment path are accepted.
 */
export const isAcceptedSliceWalletSenderUserOperation = async ({
  acceptedChainIds = supportedSliceCheckoutChainIds,
  chainId,
  entryPoint,
  fetchSenderAccount,
  userOperation
}: {
  acceptedChainIds?: readonly number[]
  chainId: string | number
  entryPoint: Address
  fetchSenderAccount: SliceSenderAccountFetch
  userOperation: SliceUserOperation
}) => {
  if (
    !acceptedChainIds.includes(parseSliceChainId(chainId) ?? -1) ||
    normalizeAddress(entryPoint) !== normalizeAddress(entryPoint07Address) ||
    userOperation.eip7702Auth !== undefined ||
    userOperation.initCode !== undefined ||
    userOperation.factory === eip7702FactoryMarker
  ) {
    return false
  }

  const snapshot = await fetchSenderAccount(userOperation.sender)
  if (!snapshot) return false

  if (snapshot.code === "0x") {
    return (
      userOperation.factory !== undefined &&
      isAddressInList(userOperation.factory, [
        sliceKernelBaseV33Addresses.metaFactory
      ]) &&
      userOperation.factoryData !== undefined &&
      isCanonicalSliceWalletFactoryData(userOperation.factoryData)
    )
  }

  return matchesAcceptedSenderCode(snapshot, defaultAcceptedSenderCode)
}

export const isSupportedSliceEntryPointRequest = ({
  chainId,
  entryPoint
}: {
  chainId: string | number
  entryPoint: Address
}) => {
  const parsedChainId = parseSliceChainId(chainId)
  return (
    parsedChainId !== null &&
    supportedSliceCheckoutChainIds.includes(
      parsedChainId as (typeof supportedSliceCheckoutChainIds)[number]
    ) &&
    Boolean(getSupportedEntryPointVersion(entryPoint))
  )
}

export const isAcceptedSliceUserOperation = async ({
  acceptedSenderCode = defaultAcceptedSenderCode,
  acceptedChainIds = [defaultSliceChainId],
  chainId,
  eip7702DelegateAllowlist = [],
  entryPoint,
  fetchSenderAccount,
  fetchSlicer,
  policyBaseUrl,
  requireVerifiedSender = false,
  userOperation
}: {
  acceptedSenderCode?: readonly SliceAcceptedSenderCode[]
  acceptedChainIds?: readonly number[]
  chainId: string | number
  eip7702DelegateAllowlist?: readonly Address[]
  entryPoint: Address
  fetchSenderAccount?: SliceSenderAccountFetch
  fetchSlicer: SliceUserOperationPolicyFetch
  policyBaseUrl?: string
  /**
   * Rejects operations whose sender account cannot be verified. Enable only
   * on endpoints whose traffic is exclusively Slice Kernel wallets; external
   * smart wallets have unknown (but legitimate) code.
   */
  requireVerifiedSender?: boolean
  userOperation: SliceUserOperation
}) => {
  const parsedChainId = parseSliceChainId(chainId)
  if (
    parsedChainId === null ||
    !acceptedChainIds.includes(parsedChainId) ||
    !getSupportedEntryPointVersion(entryPoint)
  ) {
    return false
  }
  if (!isAcceptedUserOperationFactory(userOperation)) return false
  if (
    !isAcceptedEip7702Authorization({
      authorization: userOperation.eip7702Auth,
      requestChainId: chainId,
      trustedDelegates: eip7702DelegateAllowlist
    })
  ) {
    return false
  }

  const calls = getSliceSmartAccountCalls(userOperation.callData)
  if (calls === null) return false
  const nonce = parseUserOperationNonce(userOperation.nonce)
  if (nonce === null) return false
  const batch = classifySliceSmartAccountCallsBatch(calls, {
    allowAccountAdministration: isKernelRootValidationNonce(nonce),
    chainId: parsedChainId,
    sender: userOperation.sender
  })
  if (batch.status === "rejected") return false

  // Account administration (wallet recovery) is only ever legitimate from a
  // verified Slice Kernel sender; unverified senders could declare admin
  // calls while executing arbitrary code.
  const needsVerifiedSender =
    requireVerifiedSender || batch.includesAccountAdministration
  if (needsVerifiedSender) {
    if (fetchSenderAccount === undefined) return false
    const verification = await verifySliceSenderAccount({
      acceptedSenderCode,
      eip7702DelegateAllowlist,
      fetchSenderAccount,
      userOperation
    })
    if (verification !== "verified") return false
  }

  const slicerLookups = await Promise.all(
    batch.unknownTargets.map((target) =>
      isIndexedSlicerAddress({ address: target, fetchSlicer, policyBaseUrl })
    )
  )
  return isAcceptedSliceCallsOutcome({
    batch,
    unknownTargetsAreSlicers: slicerLookups
  })
}

/**
 * Kernel v3 packs validation routing into the userop nonce:
 * [1B mode][1B validator type][20B validator id][2B key][8B sequence].
 * Root (passkey) operations use mode 0x00 + type 0x00; session-key
 * operations run in enable mode (0x01) or through a permission validator
 * (type 0x02).
 */
export const getKernelNonceValidation = (nonce: bigint) => ({
  mode: Number((nonce >> 248n) & 0xffn),
  validatorAddress: `0x${((nonce >> 80n) & ((1n << 160n) - 1n))
    .toString(16)
    .padStart(40, "0")}` as Address,
  validatorType: Number((nonce >> 240n) & 0xffn)
})

export const isKernelRootValidationNonce = (nonce: bigint) => {
  const { mode, validatorType } = getKernelNonceValidation(nonce)
  return mode === 0 && validatorType === 0
}

/**
 * Narrow policy for the ID recovery surface. It accepts only root-authorized,
 * zero-value cancellations of recovery proposals for the sender itself.
 */
export const isAcceptedSliceRecoveryCancellationUserOperation = ({
  chainId,
  userOperation
}: {
  chainId: string | number
  userOperation: SliceUserOperation
}) => {
  const parsedChainId = parseSliceChainId(chainId)
  if (parsedChainId === null) return false
  const nonce = parseUserOperationNonce(userOperation.nonce)
  if (nonce === null || !isKernelRootValidationNonce(nonce)) {
    return false
  }

  const calls = getSliceSmartAccountCalls(userOperation.callData)
  if (!calls?.length || calls.length > maxAcceptedSliceCallsPerBatch) {
    return false
  }

  return calls.every(
    (call) =>
      call.value === 0n &&
      call.target.toLowerCase() ===
        sliceKernelTimelockPolicyAddress.toLowerCase() &&
      classifySliceSmartAccountCall(call, {
        allowAccountAdministration: true,
        chainId: parsedChainId,
        sender: userOperation.sender
      }) === "account"
  )
}

/**
 * Narrow sponsorship policy for id.slice.so security ceremonies. In addition
 * to recovery cancellation, it accepts only zero-value Kernel validation
 * lifecycle calls on the sender itself. Account verification and signature
 * validation still run independently in the bundler/paymaster pipeline.
 */
export const isAcceptedSliceIdSecurityOperationUserOperation = ({
  chainId,
  userOperation
}: {
  chainId: string | number
  userOperation: SliceUserOperation
}) => {
  if (
    isAcceptedSliceRecoveryCancellationUserOperation({ chainId, userOperation })
  ) {
    return true
  }
  const parsedChainId = parseSliceChainId(chainId)
  if (parsedChainId === null) return false
  if (parseUserOperationNonce(userOperation.nonce) === null) return false
  const calls = getSliceSmartAccountCalls(userOperation.callData)
  if (!calls?.length || calls.length > maxAcceptedSliceCallsPerBatch) {
    return false
  }
  return calls.every(
    (call) =>
      call.value === 0n &&
      call.target.toLowerCase() === userOperation.sender.toLowerCase() &&
      classifySliceSmartAccountCall(call, {
        allowAccountAdministration: true,
        chainId: parsedChainId,
        sender: userOperation.sender
      }) === "account"
  )
}

/**
 * Extracts the complete checkout intent from a buyer execution userop. Unlike
 * the general sponsorship policy, this accepts only ProductsModule buy/pay and
 * token approvals to ProductsModule so the co-signer can fail closed.
 */
export const getSliceUserOperationCheckoutSpendIntent = (
  callData: Hex,
  chainId: number
): SliceCheckoutSpendIntent | null => {
  const calls = getSliceSmartAccountCalls(callData)
  if (!calls) return null

  return getSliceCheckoutSpendIntentFromCalls(calls, chainId)
}
