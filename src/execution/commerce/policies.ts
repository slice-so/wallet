import {
  generatedHookAddressList,
  getProductsModuleAddress
} from "../generated/commerceFacts"
import {
  productsModuleAbi,
  registryProductActionAbi,
  slicerAbi
} from "@slicekit/abi"
import {
  createPositiveAmountRule,
  getWalletPolicyHash,
  normalizeWalletPolicyDescriptor,
  type WalletPolicyCallRule,
  type WalletPolicyDescriptor
} from "../../policy"
import {
  type Abi,
  type AbiFunction,
  type Address,
  hexToBigInt,
  maxUint256,
  pad,
  toFunctionSelector,
  toHex
} from "viem"
import type {
  CreateSliceCheckoutPolicyParameters,
  CreateSliceStoreManagementPolicyParameters
} from "../../types/commerce"

export const sliceStoreManagementOperations = [
  "addProduct",
  "editProduct",
  "editProductMetadata",
  "removeProduct",
  "setProductType",
  "setStoreConfig",
  "configureProduct",
  "_addCurrencies"
] as const

const walletPermissionActivationSkewSeconds = 300

const getWalletPermissionValidAfter = () =>
  Math.max(
    0,
    Math.floor(Date.now() / 1_000) - walletPermissionActivationSkewSeconds
  )

const getSelector = ({
  abi,
  functionName
}: {
  abi: Abi
  functionName: string
}) => {
  const matches = abi.filter(
    (item): item is AbiFunction =>
      item.type === "function" && item.name === functionName
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one ABI function named ${functionName}.`)
  }
  return toFunctionSelector(matches[0])
}

const buySelector = getSelector({ abi: productsModuleAbi, functionName: "buy" })
const paySelector = getSelector({ abi: productsModuleAbi, functionName: "pay" })
const approveSelector = toFunctionSelector("approve(address,uint256)")
const configureProductSelector = getSelector({
  abi: registryProductActionAbi,
  functionName: "configureProduct"
})
const addCurrenciesSelector = getSelector({
  abi: slicerAbi,
  functionName: "_addCurrencies"
})

const productManagementSelectors = sliceStoreManagementOperations
  .filter(
    (operation) =>
      operation !== "configureProduct" && operation !== "_addCurrencies"
  )
  .map((functionName) => getSelector({ abi: productsModuleAbi, functionName }))

type GeneratedHookDeployment = { address: string }

const generatedHookAddresses = generatedHookAddressList

const uniqueAddresses = (values: readonly Address[]) => [
  ...new Map(values.map((value) => [value.toLowerCase(), value])).values()
]

export const createSliceCheckoutPolicyDescriptor = ({
  account,
  chainId,
  expiresAt,
  startsAt = getWalletPermissionValidAfter(),
  tokenAddresses = []
}: CreateSliceCheckoutPolicyParameters): WalletPolicyDescriptor => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  return {
    account,
    calls: [
      {
        parameterRules: [],
        selector: buySelector,
        target: productsModuleAddress,
        valueLimit: maxUint256
      },
      {
        parameterRules: [],
        selector: paySelector,
        target: productsModuleAddress,
        valueLimit: maxUint256
      },
      ...uniqueAddresses(tokenAddresses).map(
        (target): WalletPolicyCallRule => ({
          parameterRules: [
            {
              condition: "equal",
              offset: 0,
              params: [pad(productsModuleAddress, { size: 32 })]
            },
            createPositiveAmountRule(32)
          ],
          selector: approveSelector,
          target,
          valueLimit: 0n
        })
      )
    ],
    chainId,
    grantKind: "checkout",
    validAfter: startsAt,
    validUntil: expiresAt,
    version: 1
  }
}

export const assertSliceCheckoutPolicyDescriptor = (
  descriptor: WalletPolicyDescriptor
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  if (normalized.grantKind !== "checkout") {
    throw new Error("Expected a checkout wallet policy.")
  }

  const productsModuleAddress = getProductsModuleAddress(normalized.chainId)
  const tokenAddresses = normalized.calls
    .filter(
      (call) =>
        call.target.toLowerCase() !== productsModuleAddress.toLowerCase()
    )
    .map((call) => call.target)
  const expected = createSliceCheckoutPolicyDescriptor({
    account: normalized.account,
    chainId: normalized.chainId,
    expiresAt: normalized.validUntil,
    startsAt: normalized.validAfter,
    tokenAddresses
  })

  if (getWalletPolicyHash(normalized) !== getWalletPolicyHash(expected)) {
    throw new Error("Checkout wallet policy contains unsupported authority.")
  }
  return normalized
}

export const createSliceStoreManagementPolicyDescriptor = ({
  account,
  chainId,
  expiresAt,
  slicerAddress,
  slicerId,
  startsAt = getWalletPermissionValidAfter()
}: CreateSliceStoreManagementPolicyParameters): WalletPolicyDescriptor => {
  if (!Number.isSafeInteger(slicerId) || slicerId <= 0) {
    throw new Error("Store management policies require a positive slicer id.")
  }
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const slicerIdRule = {
    condition: "equal" as const,
    offset: 0,
    params: [pad(toHex(slicerId), { size: 32 })]
  }
  return {
    account,
    calls: [
      ...productManagementSelectors.map((selector) => ({
        parameterRules: [slicerIdRule],
        selector,
        target: productsModuleAddress,
        valueLimit: 0n
      })),
      ...generatedHookAddresses.map((target) => ({
        parameterRules: [slicerIdRule],
        selector: configureProductSelector,
        target,
        valueLimit: 0n
      })),
      {
        parameterRules: [],
        selector: addCurrenciesSelector,
        target: slicerAddress,
        valueLimit: 0n
      }
    ],
    chainId,
    grantKind: "management",
    validAfter: startsAt,
    validUntil: expiresAt,
    version: 1
  }
}

export const assertSliceStoreManagementPolicyDescriptor = (
  descriptor: WalletPolicyDescriptor,
  {
    slicerAddress,
    slicerId
  }: Pick<
    CreateSliceStoreManagementPolicyParameters,
    "slicerAddress" | "slicerId"
  >
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  if (normalized.grantKind !== "management") {
    throw new Error("Expected a store-management wallet policy.")
  }
  const expected = createSliceStoreManagementPolicyDescriptor({
    account: normalized.account,
    chainId: normalized.chainId,
    expiresAt: normalized.validUntil,
    slicerAddress,
    slicerId,
    startsAt: normalized.validAfter
  })
  if (getWalletPolicyHash(normalized) !== getWalletPolicyHash(expected)) {
    throw new Error("Store-management policy contains unsupported authority.")
  }
  return normalized
}

export const deriveSliceStoreManagementPolicyScope = (
  descriptor: WalletPolicyDescriptor
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  if (normalized.grantKind !== "management") {
    throw new Error("Expected a store-management wallet policy.")
  }
  const slicerCall = normalized.calls.find(
    (call) =>
      call.selector === addCurrenciesSelector &&
      call.parameterRules.length === 0
  )
  const slicerIdValues = new Set(
    normalized.calls.flatMap((call) =>
      call.parameterRules.flatMap((rule) =>
        rule.offset === 0 &&
        rule.condition === "equal" &&
        rule.params.length === 1
          ? rule.params
          : []
      )
    )
  )
  if (slicerCall === undefined || slicerIdValues.size !== 1) {
    throw new Error("Store-management policy scope is invalid.")
  }
  const [slicerIdValue] = slicerIdValues
  if (slicerIdValue === undefined) {
    throw new Error("Store-management policy scope is invalid.")
  }
  const slicerId = Number(hexToBigInt(slicerIdValue))
  if (!Number.isSafeInteger(slicerId) || slicerId <= 0) {
    throw new Error("Store-management policy slicer id is invalid.")
  }
  assertSliceStoreManagementPolicyDescriptor(normalized, {
    slicerAddress: slicerCall.target,
    slicerId
  })
  return { slicerAddress: slicerCall.target, slicerId }
}
