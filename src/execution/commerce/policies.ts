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
  maxUint256,
  pad,
  slice,
  toFunctionSelector,
  toHex
} from "viem"
import {
  createPositiveAmountRule,
  getWalletPolicyHash,
  normalizeWalletPolicyDescriptor,
  toWalletPermissionPolicies,
  type WalletPolicyCallRule,
  type WalletPolicyDescriptor,
  walletPolicyWildcardTarget
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
  startsAt = getWalletPermissionValidAfter()
}: CreateSliceStoreManagementPolicyParameters): WalletPolicyDescriptor => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const fundsModuleAddress = getFundsModuleAddress(chainId)
  const sliceCoreAddress = getSliceCoreAddress(chainId)
  return {
    account,
    calls: [
      ...productManagementSelectors.map((selector) => ({
        parameterRules: [],
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
        parameterRules: [],
        selector: configureProductSelector,
        target,
        valueLimit: 0n
      })),
      {
        parameterRules: [],
        selector: addCurrenciesSelector,
        target: walletPolicyWildcardTarget,
        valueLimit: 0n
      },
      {
        parameterRules:
          sessionSignerAddress === undefined
            ? []
            : [
                {
                  condition: "not_equal" as const,
                  offset: 32,
                  params: [pad(sessionSignerAddress, { size: 32 })]
                }
              ],
        selector: setRolesSelector,
        target: walletPolicyWildcardTarget,
        valueLimit: 0n
      },
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
        target: walletPolicyWildcardTarget,
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
  descriptor: WalletPolicyDescriptor
) => {
  const normalized = normalizeWalletPolicyDescriptor(descriptor)
  if (normalized.grantKind !== "management") {
    throw new Error("Expected a store-management wallet policy.")
  }
  const setRolesCall = normalized.calls.find(
    (call) =>
      call.selector === setRolesSelector &&
      call.target === walletPolicyWildcardTarget
  )
  const signerRule = setRolesCall?.parameterRules[0]
  const sessionSignerAddress =
    signerRule?.condition === "not_equal" &&
    signerRule.offset === 32 &&
    signerRule.params.length === 1
      ? (slice(signerRule.params[0], 12, 32) as Address)
      : undefined
  const expected = createSliceStoreManagementPolicyDescriptor({
    account: normalized.account,
    chainId: normalized.chainId,
    expiresAt: normalized.validUntil,
    sessionSignerAddress,
    startsAt: normalized.validAfter
  })
  if (getWalletPolicyHash(normalized) !== getWalletPolicyHash(expected)) {
    throw new Error("Store-management policy contains unsupported authority.")
  }
  return normalized
}

export const bindSliceStoreManagementPolicySigner = (
  descriptor: WalletPolicyDescriptor,
  sessionSignerAddress: Address
) => {
  const normalized = assertSliceStoreManagementPolicyDescriptor(descriptor)
  const unbound = createSliceStoreManagementPolicyDescriptor({
    account: normalized.account,
    chainId: normalized.chainId,
    expiresAt: normalized.validUntil,
    startsAt: normalized.validAfter
  })
  if (getWalletPolicyHash(normalized) !== getWalletPolicyHash(unbound)) {
    throw new Error("Store-management policy is already signer-bound.")
  }

  return createSliceStoreManagementPolicyDescriptor({
    account: normalized.account,
    chainId: normalized.chainId,
    expiresAt: normalized.validUntil,
    sessionSignerAddress,
    startsAt: normalized.validAfter
  })
}

export const createSliceStoreManagementPermissionPolicies = (
  parameters: CreateSliceStoreManagementPolicyParameters
) =>
  toWalletPermissionPolicies(
    createSliceStoreManagementPolicyDescriptor(parameters)
  )
