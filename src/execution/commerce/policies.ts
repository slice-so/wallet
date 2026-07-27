import {
  fundsModuleAbi,
  productsModuleAbi,
  registryProductActionAbi,
  sliceCoreAbi,
  slicerAbi
} from "@slicekit/abi"
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
import {
  createPositiveAmountRule,
  getWalletPolicyHash,
  normalizeWalletPolicyDescriptor,
  type WalletPolicyCallRule,
  type WalletPolicyDescriptor
} from "../../policy"
import type {
  CreateSliceCheckoutPolicyParameters,
  CreateSliceStoreManagementPolicyParameters
} from "../../types/commerce"
import {
  generatedHookAddressList,
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress
} from "../generated/commerceFacts"

export const sliceStoreManagementOperations = [
  "batchWithdraw",
  "addProduct",
  "editProduct",
  "editProductMetadata",
  "multicall",
  "release",
  "removeProduct",
  "setRoles",
  "setProductType",
  "setStoreConfig",
  "slice",
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
const multicallSelector = getSelector({
  abi: productsModuleAbi,
  functionName: "multicall"
})
const setRolesSelector = getSelector({
  abi: slicerAbi,
  functionName: "setRoles"
})
const releaseSelector = getSelector({
  abi: slicerAbi,
  functionName: "release"
})
const batchWithdrawSelector = getSelector({
  abi: fundsModuleAbi,
  functionName: "batchWithdraw"
})
const sliceSelector = getSelector({
  abi: sliceCoreAbi,
  functionName: "slice"
})

const productManagementSelectors = sliceStoreManagementOperations
  .filter(
    (operation) =>
      operation !== "batchWithdraw" &&
      operation !== "configureProduct" &&
      operation !== "_addCurrencies" &&
      operation !== "multicall" &&
      operation !== "release" &&
      operation !== "setRoles" &&
      operation !== "slice"
  )
  .map((functionName) => getSelector({ abi: productsModuleAbi, functionName }))

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
  sessionSignerAddress,
  slicerAddress,
  slicerId,
  startsAt = getWalletPermissionValidAfter()
}: CreateSliceStoreManagementPolicyParameters): WalletPolicyDescriptor => {
  if (!Number.isSafeInteger(slicerId) || slicerId < 0) {
    throw new Error(
      "Store management policies require a non-negative slicer id."
    )
  }
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const fundsModuleAddress = getFundsModuleAddress(chainId)
  const sliceCoreAddress = getSliceCoreAddress(chainId)
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
      {
        parameterRules: [],
        selector: multicallSelector,
        target: productsModuleAddress,
        valueLimit: 0n
      },
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
      },
      ...(sessionSignerAddress === undefined
        ? []
        : [
            {
              parameterRules: [
                {
                  condition: "not_equal" as const,
                  offset: 32,
                  params: [pad(sessionSignerAddress, { size: 32 })]
                }
              ],
              selector: setRolesSelector,
              target: slicerAddress,
              valueLimit: 0n
            }
          ]),
      {
        parameterRules: [
          {
            condition: "equal",
            offset: 0,
            params: [pad(account, { size: 32 })]
          },
          {
            condition: "equal",
            offset: 64,
            params: [pad(toHex(1), { size: 32 })]
          }
        ],
        selector: releaseSelector,
        target: slicerAddress,
        valueLimit: 0n
      },
      {
        parameterRules: [
          {
            condition: "equal",
            offset: 0,
            params: [pad(account, { size: 32 })]
          }
        ],
        selector: batchWithdrawSelector,
        target: fundsModuleAddress,
        valueLimit: 0n
      },
      {
        parameterRules: [],
        selector: sliceSelector,
        target: sliceCoreAddress,
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
    sessionSignerAddress,
    slicerAddress,
    slicerId
  }: Pick<
    CreateSliceStoreManagementPolicyParameters,
    "sessionSignerAddress" | "slicerAddress" | "slicerId"
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
    sessionSignerAddress,
    slicerAddress,
    slicerId,
    startsAt: normalized.validAfter
  })
  if (getWalletPolicyHash(normalized) !== getWalletPolicyHash(expected)) {
    throw new Error("Store-management policy contains unsupported authority.")
  }
  return normalized
}

export const getSliceStoreManagementPolicyScope = (
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
  const productsModuleAddress = getProductsModuleAddress(normalized.chainId)
  const productManagementSelectorSet = new Set(productManagementSelectors)
  const slicerIdValues = new Set(
    normalized.calls
      .filter(
        (call) =>
          call.target.toLowerCase() === productsModuleAddress.toLowerCase() &&
          productManagementSelectorSet.has(call.selector)
      )
      .flatMap((call) =>
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
  if (!Number.isSafeInteger(slicerId) || slicerId < 0) {
    throw new Error("Store-management policy slicer id is invalid.")
  }
  return { slicerAddress: slicerCall.target, slicerId }
}

export const deriveSliceStoreManagementPolicyScope = (
  descriptor: WalletPolicyDescriptor,
  sessionSignerAddress?: Address
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  const { slicerAddress, slicerId } =
    getSliceStoreManagementPolicyScope(normalized)
  assertSliceStoreManagementPolicyDescriptor(normalized, {
    sessionSignerAddress,
    slicerAddress,
    slicerId
  })
  return { slicerAddress, slicerId }
}

export const bindSliceStoreManagementPolicySigner = (
  descriptor: WalletPolicyDescriptor,
  sessionSignerAddress: Address
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  const { slicerAddress, slicerId } =
    deriveSliceStoreManagementPolicyScope(normalized)

  return createSliceStoreManagementPolicyDescriptor({
    account: normalized.account,
    chainId: normalized.chainId,
    expiresAt: normalized.validUntil,
    sessionSignerAddress,
    slicerAddress,
    slicerId,
    startsAt: normalized.validAfter
  })
}
