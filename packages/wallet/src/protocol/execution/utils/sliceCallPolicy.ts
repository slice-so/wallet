/**
 * Transport-neutral sponsorship decision core. This module performs no
 * sponsorship execution or I/O: no submission, bundler, paymaster, payer, or
 * envelope concerns belong here. The boundary is enforced by
 * scripts/check-import-boundaries.ts.
 *
 * Executor-related policy facts, such as the CDP Base paymaster being an
 * accepted approval spender, remain policy data and must be reviewed when the
 * executor changes (CDP paymaster today; payer or paymaster-frame later).
 */

import {
  productsModuleAbi,
  registryProductActionAbi,
  sliceCoreAbi
} from "@slicekit/abi"
import {
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress,
  isSliceHookAddress
} from "@slicekit/abi/deployments"
import {
  type Address,
  decodeFunctionData,
  erc20Abi,
  type Hex,
  isAddress,
  isAddressEqual,
  size,
  slice,
  zeroAddress
} from "viem"
import { anvil, base } from "viem/chains"
import { sliceWalletKernelAddresses } from "../../constants"
import {
  kernelValidationManagementAbi,
  kernelWebAuthnValidatorLifecycleAbi
} from "../../kernel/abi"
import { kernelPermissionExecuteSelector } from "../../kernel/permission"
import type {
  SliceCallsBatchClassification,
  SliceCallsBatchClassified,
  SliceCheckoutSpendIntent,
  SliceSmartAccountCall
} from "../../types/commerce"
import { sliceKernelTimelockPolicyAddress } from "./sliceKernelAddresses"
import { kernelTimelockPolicyCancelAbi } from "./slicePaymasterAbis"
import { maxAcceptedSliceCallsPerBatch } from "./sliceUserOperationLimits"

type SmartAccountCallClassification =
  | "account"
  | "auxiliary"
  | "invalid"
  | "slice"
  | "unknown"

const acceptedProductsModuleFunctions = [
  "addProduct",
  "buy",
  "buyWithAuthorization",
  "editProduct",
  "editProductMetadata",
  "pay",
  "payWithAuthorization",
  "removeProduct",
  "setProductType",
  "setStoreConfig"
] as const
const acceptedSliceCoreFunctions = ["slice"] as const
const acceptedKernelValidationManagementFunctions = [
  "installModule",
  "setNonce",
  "uninstallModule"
] as const

const acceptedKernelPolicyModules = [
  sliceWalletKernelAddresses.callPolicyV005,
  sliceWalletKernelAddresses.rateLimitPolicy,
  sliceWalletKernelAddresses.slicerRegistryPolicy,
  sliceWalletKernelAddresses.sudoPolicy,
  sliceWalletKernelAddresses.timelockPolicy,
  sliceWalletKernelAddresses.timestampPolicy
] as const
const acceptedKernelSignerModules = [
  sliceWalletKernelAddresses.ecdsaSigner,
  sliceWalletKernelAddresses.webAuthnSignerV004,
  sliceWalletKernelAddresses.weightedP256Signer
] as const
const kernelNoHookInstalledSentinel: Address =
  "0x0000000000000000000000000000000000000001"

const cdpBasePaymasterAddress =
  "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" satisfies Address

const normalizeAddress = (address: string) => address.toLowerCase()

const isAcceptedProductsModuleFunction = (functionName: string) =>
  acceptedProductsModuleFunctions.includes(
    functionName as (typeof acceptedProductsModuleFunctions)[number]
  )

const isAcceptedSliceCoreFunction = (functionName: string) =>
  acceptedSliceCoreFunctions.includes(
    functionName as (typeof acceptedSliceCoreFunctions)[number]
  )

const isAcceptedProductsModuleCalldata = (data: Hex, depth = 0): boolean => {
  if (depth > 1) return false

  try {
    const decoded = decodeFunctionData({ abi: productsModuleAbi, data })
    if (decoded.functionName === "multicall") {
      return decoded.args[0].every((innerData) =>
        isAcceptedProductsModuleCalldata(innerData, depth + 1)
      )
    }
    return isAcceptedProductsModuleFunction(decoded.functionName)
  } catch {
    return false
  }
}

const isAcceptedSliceCoreCalldata = (data: Hex) => {
  try {
    const decoded = decodeFunctionData({ abi: sliceCoreAbi, data })
    return isAcceptedSliceCoreFunction(decoded.functionName)
  } catch {
    return false
  }
}

const isAcceptedTokenApproval = ({
  chainId,
  data,
  fundsModuleAddress,
  productsModuleAddress,
  target,
  value
}: SliceSmartAccountCall & {
  chainId: number
  fundsModuleAddress: Address
  productsModuleAddress: Address
}) => {
  if (value !== 0n || !isAddress(target)) return false

  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data })
    if (decoded.functionName !== "approve") return false

    const [spender] = decoded.args
    return (
      normalizeAddress(spender) === normalizeAddress(productsModuleAddress) ||
      normalizeAddress(spender) === normalizeAddress(fundsModuleAddress) ||
      ((chainId === base.id || chainId === anvil.id) &&
        normalizeAddress(spender) === normalizeAddress(cdpBasePaymasterAddress))
    )
  } catch {
    return false
  }
}

const isAcceptedGeneratedHookCalldata = ({
  data,
  target,
  value
}: SliceSmartAccountCall) => {
  if (value !== 0n || !isSliceHookAddress(target)) return false

  try {
    const decoded = decodeFunctionData({ abi: registryProductActionAbi, data })
    return decoded.functionName === "configureProduct"
  } catch {
    return false
  }
}

const isAcceptedKernelValidationManagementFunction = (functionName: string) =>
  acceptedKernelValidationManagementFunctions.includes(
    functionName as (typeof acceptedKernelValidationManagementFunctions)[number]
  )

const isAcceptedKernelModule = (moduleType: bigint, module: Address) => {
  if (moduleType === 5n) {
    return acceptedKernelPolicyModules.some((candidate) =>
      isAddressEqual(candidate, module)
    )
  }
  if (moduleType === 6n) {
    return acceptedKernelSignerModules.some((candidate) =>
      isAddressEqual(candidate, module)
    )
  }
  return false
}

const isAcceptedKernelInstall = (install: {
  internalData: Hex
  module: Address
  moduleType: bigint
}) => {
  if (!isAcceptedKernelModule(install.moduleType, install.module)) return false
  if (install.moduleType !== 6n) return true
  if (size(install.internalData) !== 28) return false
  const hook = slice(install.internalData, 4, 24) as Address
  return (
    (isAddressEqual(hook, zeroAddress) ||
      isAddressEqual(hook, kernelNoHookInstalledSentinel)) &&
    slice(install.internalData, 24, 28) === kernelPermissionExecuteSelector
  )
}

/** Root-authorized recovery administration on the account itself. */
const isAcceptedAccountValidationManagementCall = ({
  call,
  sender
}: {
  call: SliceSmartAccountCall
  sender: Address
}) => {
  if (call.value !== 0n) return false
  if (normalizeAddress(call.target) !== normalizeAddress(sender)) return false

  try {
    const decoded = decodeFunctionData({
      abi: kernelValidationManagementAbi,
      data: call.data
    })
    if (!isAcceptedKernelValidationManagementFunction(decoded.functionName)) {
      return false
    }
    if (decoded.functionName === "setNonce") {
      const [nonceKey, sequence] = decoded.args
      return nonceKey === 0n && sequence > 0n
    }
    if (decoded.functionName === "uninstallModule") {
      return isAcceptedKernelModule(decoded.args[0], decoded.args[1])
    }
    const [packages] = decoded.args
    return (
      packages.length >= 2 &&
      packages.at(-1)?.moduleType === 6n &&
      packages.slice(0, -1).every((install) => install.moduleType === 5n) &&
      packages.every(isAcceptedKernelInstall)
    )
  } catch {
    return false
  }
}

const isAcceptedWebAuthnRootLifecycleCall = ({
  call
}: {
  call: SliceSmartAccountCall
}) => {
  if (
    call.value !== 0n ||
    !isAddressEqual(
      call.target,
      sliceWalletKernelAddresses.webAuthnRootValidator
    )
  ) {
    return false
  }
  try {
    const decoded = decodeFunctionData({
      abi: kernelWebAuthnValidatorLifecycleAbi,
      data: call.data
    })
    const [data] = decoded.args
    return decoded.functionName === "onInstall"
      ? size(data) === 96
      : decoded.functionName === "onUninstall" && data === "0x"
  } catch {
    return false
  }
}

/** Root-authorized cancellation of a recovery proposal for the account. */
const isAcceptedRecoveryTimelockCancelCall = ({
  call,
  sender
}: {
  call: SliceSmartAccountCall
  sender: Address
}) => {
  if (call.value !== 0n) return false
  if (
    normalizeAddress(call.target) !==
    normalizeAddress(sliceKernelTimelockPolicyAddress)
  ) {
    return false
  }

  try {
    const decoded = decodeFunctionData({
      abi: kernelTimelockPolicyCancelAbi,
      data: call.data
    })
    if (decoded.functionName !== "cancelProposal") return false

    const [, account] = decoded.args
    return normalizeAddress(account) === normalizeAddress(sender)
  } catch {
    return false
  }
}

/**
 * Classifies a call against the static Slice policy. Dynamic slicer-address
 * resolution remains the responsibility of the caller.
 */
export const classifySliceSmartAccountCall = (
  call: SliceSmartAccountCall,
  {
    allowAccountAdministration,
    chainId,
    sender
  }: {
    allowAccountAdministration: boolean
    chainId: number
    sender: Address
  }
): SmartAccountCallClassification => {
  if (
    allowAccountAdministration &&
    (isAcceptedAccountValidationManagementCall({ call, sender }) ||
      isAcceptedWebAuthnRootLifecycleCall({ call }) ||
      isAcceptedRecoveryTimelockCancelCall({ call, sender }))
  ) {
    return "account"
  }

  // Commerce addresses exist only on Slice commerce chains. Resolve them only
  // after chain-agnostic Kernel administration has been classified.
  let productsModuleAddress: Address
  let fundsModuleAddress: Address
  let sliceCoreAddress: Address
  try {
    productsModuleAddress = getProductsModuleAddress(chainId)
    fundsModuleAddress = getFundsModuleAddress(chainId)
    sliceCoreAddress = getSliceCoreAddress(chainId)
  } catch {
    return "invalid"
  }
  const target = normalizeAddress(call.target)

  if (target === normalizeAddress(productsModuleAddress)) {
    return isAcceptedProductsModuleCalldata(call.data) ? "slice" : "invalid"
  }
  if (target === normalizeAddress(fundsModuleAddress)) return "slice"
  if (target === normalizeAddress(sliceCoreAddress)) {
    return isAcceptedSliceCoreCalldata(call.data) ? "slice" : "invalid"
  }
  if (isAcceptedGeneratedHookCalldata(call)) return "slice"
  if (
    isAcceptedTokenApproval({
      ...call,
      chainId,
      fundsModuleAddress,
      productsModuleAddress
    })
  ) {
    return "auxiliary"
  }
  return "unknown"
}

export const classifySliceSmartAccountCallsBatch = (
  calls: readonly SliceSmartAccountCall[],
  context: {
    allowAccountAdministration: boolean
    chainId: number
    sender: Address
  }
): SliceCallsBatchClassification => {
  if (calls.length === 0) return { status: "rejected", reason: "empty" }
  if (calls.length > maxAcceptedSliceCallsPerBatch) {
    return { status: "rejected", reason: "too_many_calls" }
  }

  const classifications = calls.map((call) =>
    classifySliceSmartAccountCall(call, context)
  )
  if (classifications.includes("invalid")) {
    return { status: "rejected", reason: "invalid_call" }
  }

  return {
    status: "classified",
    includesAccountAdministration: classifications.includes("account"),
    includesSliceIntent: classifications.some(
      (classification) =>
        classification === "slice" || classification === "account"
    ),
    unknownTargets: [
      ...new Set(
        calls
          .filter((_, index) => classifications[index] === "unknown")
          .map((call) => normalizeAddress(call.target) as Address)
      )
    ]
  }
}

export const isAcceptedSliceCallsOutcome = ({
  batch,
  unknownTargetsAreSlicers
}: {
  batch: SliceCallsBatchClassified
  unknownTargetsAreSlicers: readonly boolean[]
}): boolean => {
  if (unknownTargetsAreSlicers.length !== batch.unknownTargets.length) {
    return false
  }
  if (unknownTargetsAreSlicers.some((isSlicer) => isSlicer !== true)) {
    return false
  }
  return batch.unknownTargets.length > 0 || batch.includesSliceIntent
}

export const getSliceCheckoutSpendIntentFromCalls = (
  calls: readonly SliceSmartAccountCall[],
  chainId: number,
  expectedBuyer?: Address
): SliceCheckoutSpendIntent | null => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const intent: SliceCheckoutSpendIntent = {
    approvals: [],
    nativeValue: 0n,
    payments: [],
    purchases: []
  }
  if (calls.length === 0) return null
  const checkoutCall = calls[calls.length - 1]
  if (!isAddressEqual(checkoutCall.target, productsModuleAddress)) return null

  let previousToken: Address | undefined
  for (let index = 0; index < calls.length - 1; index += 1) {
    const approvalCall = calls[index]
    if (approvalCall.value !== 0n) return null
    try {
      const approval = decodeFunctionData({
        abi: erc20Abi,
        data: approvalCall.data
      })
      if (approval.functionName !== "approve") return null
      const [spender, amount] = approval.args
      const token = approvalCall.target
      if (
        amount === 0n ||
        !isAddressEqual(spender, productsModuleAddress) ||
        (previousToken !== undefined &&
          previousToken.toLowerCase() >= token.toLowerCase())
      ) {
        return null
      }
      previousToken = token
      intent.approvals.push({ amount, currency: token })
    } catch {
      return null
    }
  }

  let decoded: ReturnType<typeof decodeFunctionData<typeof productsModuleAbi>>
  try {
    decoded = decodeFunctionData({
      abi: productsModuleAbi,
      data: checkoutCall.data
    })
  } catch {
    return null
  }
  if (decoded.functionName !== "buy" && decoded.functionName !== "pay") {
    return null
  }

  intent.nativeValue = checkoutCall.value
  const [buyer, paymentParams] =
    decoded.functionName === "buy"
      ? [decoded.args[0], decoded.args[2]]
      : [decoded.args[0], decoded.args[1]]
  if (expectedBuyer !== undefined && !isAddressEqual(buyer, expectedBuyer)) {
    return null
  }
  if (
    (decoded.functionName === "buy" && decoded.args[1].length === 0) ||
    (decoded.functionName === "pay" && paymentParams.length === 0)
  ) {
    return null
  }

  const usedCurrencies = new Set<string>()
  for (const payment of paymentParams) {
    intent.payments.push({
      amount: payment.amount,
      currency: payment.currency,
      recipient: payment.recipient,
      slicerId: payment.slicerId
    })
    if (!isAddressEqual(payment.currency, zeroAddress)) {
      usedCurrencies.add(payment.currency.toLowerCase())
    }
  }

  if (decoded.functionName === "buy") {
    const [, purchases, , referrer, platform] = decoded.args
    for (const purchase of purchases) {
      if (!isAddressEqual(purchase.currency, zeroAddress)) {
        usedCurrencies.add(purchase.currency.toLowerCase())
      }
      intent.purchases.push({
        buyer,
        currency: purchase.currency,
        platform,
        pricingData: [...purchase.data.pricingData],
        products: purchase.products.map((product) => ({
          productId: product.productId,
          quantity: product.quantity,
          variantId: product.variantId
        })),
        referrer,
        slicerId: purchase.slicerId
      })
    }
  }

  const approvedCurrencies = new Set(
    intent.approvals.map(({ currency }) => currency.toLowerCase())
  )
  if (
    approvedCurrencies.size !== usedCurrencies.size ||
    [...usedCurrencies].some((currency) => !approvedCurrencies.has(currency))
  ) {
    return null
  }
  return intent
}
