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
  type Address,
  decodeFunctionData,
  erc20Abi,
  type Hex,
  isAddress,
  isAddressEqual
} from "viem"
import { anvil, base } from "viem/chains"
import type {
  SliceCallsBatchClassification,
  SliceCallsBatchClassified,
  SliceCheckoutSpendIntent,
  SliceSmartAccountCall
} from "../../types/commerce"
import {
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress,
  isGeneratedHookAddress
} from "../generated/commerceFacts"
import { sliceKernelTimelockPolicyAddress } from "./sliceKernelAddresses"
import {
  kernelTimelockPolicyCancelAbi,
  kernelValidationManagementAbi
} from "./slicePaymasterAbis"
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
  "grantAccess",
  "installValidations",
  "uninstallValidation"
] as const

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
  if (value !== 0n || !isGeneratedHookAddress(target)) return false

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
    return isAcceptedKernelValidationManagementFunction(decoded.functionName)
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
      isAcceptedRecoveryTimelockCancelCall({ call, sender }))
  ) {
    return "account"
  }

  // Commerce addresses exist only on Slice commerce chains. Resolve them only
  // after chain-agnostic Kernel administration has been classified.
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const fundsModuleAddress = getFundsModuleAddress(chainId)
  const sliceCoreAddress = getSliceCoreAddress(chainId)
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
  chainId: number
): SliceCheckoutSpendIntent | null => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const intent: SliceCheckoutSpendIntent = {
    approvals: [],
    nativeValue: 0n,
    payments: [],
    purchases: []
  }
  let hasCheckoutCall = false

  for (const call of calls) {
    if (!isAddressEqual(call.target, productsModuleAddress)) {
      if (call.value !== 0n) return null

      try {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
        if (decoded.functionName !== "approve") return null

        const [spender, amount] = decoded.args
        if (!isAddressEqual(spender, productsModuleAddress) || amount === 0n) {
          return null
        }
        intent.approvals.push({ amount, currency: call.target })
        continue
      } catch {
        return null
      }
    }

    let decoded: ReturnType<typeof decodeFunctionData<typeof productsModuleAbi>>
    try {
      decoded = decodeFunctionData({
        abi: productsModuleAbi,
        data: call.data
      })
    } catch {
      continue
    }

    if (decoded.functionName !== "buy" && decoded.functionName !== "pay") {
      return null
    }

    hasCheckoutCall = true
    intent.nativeValue += call.value

    const [buyer, paymentParams] =
      decoded.functionName === "buy"
        ? [decoded.args[0], decoded.args[2]]
        : [decoded.args[0], decoded.args[1]]

    for (const payment of paymentParams) {
      intent.payments.push({
        amount: payment.amount,
        currency: payment.currency
      })
    }

    if (decoded.functionName === "buy") {
      const [, purchases, , referrer, platform] = decoded.args
      for (const purchase of purchases) {
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
  }

  return hasCheckoutCall ? intent : null
}
