import { productsModuleAbi, registryProductActionAbi } from "@slicekit/abi"
import { CallPolicyVersion, toCallPolicy } from "@zerodev/permissions/policies"
import { type Abi, type AbiFunction, toFunctionSelector } from "viem"
import type { WalletDelegationOperation } from "../../types/delegation"
import {
  generatedHookAddressList,
  getProductsModuleAddress
} from "../generated/commerceFacts"

export const storeManagementAllowedOperations = [
  "addProduct",
  "editProduct",
  "editProductMetadata",
  "removeProduct",
  "setProductType",
  "setStoreConfig",
  "configureProduct"
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
  .filter((operation) => operation !== "configureProduct")
  .map((functionName) =>
    getFunctionSelector({ abi: productsModuleAbi, functionName })
  )

const configureProductSelector = getFunctionSelector({
  abi: registryProductActionAbi,
  functionName: "configureProduct"
})

const generatedHookAddresses = generatedHookAddressList

export const createStoreManagementCallPolicy = (chainId: number) => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  return toCallPolicy({
    permissions: [
      ...productManagementSelectors.map((selector) => ({
        selector,
        target: productsModuleAddress
      })),
      ...generatedHookAddresses.map((target) => ({
        selector: configureProductSelector,
        target
      }))
    ],
    policyVersion: CallPolicyVersion.V0_0_5
  })
}
