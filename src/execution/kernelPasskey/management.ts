import {
  fundsModuleAbi,
  productsModuleAbi,
  registryProductActionAbi,
  sliceCoreAbi,
  slicerAbi
} from "@slicekit/abi"
import {
  CallPolicyVersion,
  ParamCondition,
  toCallPolicy
} from "@zerodev/permissions/policies"
import {
  type Abi,
  type AbiFunction,
  type Address,
  toFunctionSelector
} from "viem"
import type { WalletDelegationOperation } from "../../types/delegation"
import {
  generatedHookAddressList,
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress
} from "../generated/commerceFacts"

export const storeManagementAllowedOperations = [
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
] as const satisfies readonly WalletDelegationOperation[]

const getFunctionSelector = ({
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

const productManagementSelectors = storeManagementAllowedOperations
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
  .map((functionName) =>
    getFunctionSelector({ abi: productsModuleAbi, functionName })
  )

const configureProductSelector = getFunctionSelector({
  abi: registryProductActionAbi,
  functionName: "configureProduct"
})
const addCurrenciesSelector = getFunctionSelector({
  abi: slicerAbi,
  functionName: "_addCurrencies"
})
const multicallSelector = getFunctionSelector({
  abi: productsModuleAbi,
  functionName: "multicall"
})
const sliceSelector = getFunctionSelector({
  abi: sliceCoreAbi,
  functionName: "slice"
})

const generatedHookAddresses = generatedHookAddressList

export const createStoreManagementCallPolicy = (
  chainId: number,
  slicerAddress: Address,
  accountAddress: Address,
  sessionSignerAddress: Address
) => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  const fundsModuleAddress = getFundsModuleAddress(chainId)
  const sliceCoreAddress = getSliceCoreAddress(chainId)
  return toCallPolicy({
    permissions: [
      ...productManagementSelectors.map((selector) => ({
        selector,
        target: productsModuleAddress
      })),
      {
        selector: multicallSelector,
        target: productsModuleAddress
      },
      ...generatedHookAddresses.map((target) => ({
        selector: configureProductSelector,
        target
      })),
      {
        selector: addCurrenciesSelector,
        target: slicerAddress
      },
      {
        abi: slicerAbi,
        args: [
          null,
          {
            condition: ParamCondition.NOT_EQUAL,
            value: sessionSignerAddress
          }
        ],
        functionName: "setRoles",
        target: slicerAddress
      },
      {
        abi: slicerAbi,
        args: [
          { condition: ParamCondition.EQUAL, value: accountAddress },
          null,
          { condition: ParamCondition.EQUAL, value: true }
        ],
        functionName: "release",
        target: slicerAddress
      },
      {
        abi: fundsModuleAbi,
        args: [
          { condition: ParamCondition.EQUAL, value: accountAddress },
          null
        ],
        functionName: "batchWithdraw",
        target: fundsModuleAddress
      },
      {
        selector: sliceSelector,
        target: sliceCoreAddress
      }
    ],
    policyVersion: CallPolicyVersion.V0_0_5
  })
}
