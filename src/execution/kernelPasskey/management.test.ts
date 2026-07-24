import { describe, expect, it } from "bun:test"
import {
  productsModuleAbi,
  registryProductActionAbi,
  slicerAbi
} from "@slicekit/abi"
import { type Abi, type AbiFunction, toFunctionSelector } from "viem"
import { base } from "viem/chains"
import {
  generatedHookAddressList,
  getProductsModuleAddress
} from "../generated/commerceFacts"
import {
  createStoreManagementCallPolicy,
  storeManagementAllowedOperations
} from "./management"

const selectorFor = (abi: Abi, functionName: string) => {
  const item = abi.find(
    (candidate): candidate is AbiFunction =>
      candidate.type === "function" && candidate.name === functionName
  )
  if (!item) throw new Error(`Missing ${functionName} ABI function.`)
  return toFunctionSelector(item)
}

describe("store management call policy", () => {
  const slicerAddress = "0x1111111111111111111111111111111111111111"

  it("allows only the intended product-management selectors", () => {
    const policy = createStoreManagementCallPolicy(base.id, slicerAddress)
    if (policy.policyParams.type !== "call") {
      throw new Error("Store management policy must be a call policy.")
    }

    const permissions = policy.policyParams.permissions ?? []
    const productsModuleAddress = getProductsModuleAddress(
      base.id
    ).toLowerCase()
    const productsModuleSelectors = permissions
      .filter(
        (permission) =>
          permission.target.toLowerCase() === productsModuleAddress
      )
      .map((permission) => permission.selector)

    expect(productsModuleSelectors.sort()).toEqual(
      storeManagementAllowedOperations
        .filter(
          (operation) =>
            operation !== "configureProduct" && operation !== "_addCurrencies"
        )
        .map((operation) => selectorFor(productsModuleAbi, operation))
        .sort()
    )
    expect(productsModuleSelectors).not.toContain(
      selectorFor(productsModuleAbi, "buy")
    )
    expect(productsModuleSelectors).not.toContain(
      selectorFor(productsModuleAbi, "pay")
    )
    expect(productsModuleSelectors).toContain(
      selectorFor(productsModuleAbi, "multicall")
    )
  })

  it("allows configureProduct only on generated product-action hooks", () => {
    const policy = createStoreManagementCallPolicy(base.id, slicerAddress)
    if (policy.policyParams.type !== "call") {
      throw new Error("Store management policy must be a call policy.")
    }

    const permissions = policy.policyParams.permissions ?? []
    const configureProductSelector = selectorFor(
      registryProductActionAbi,
      "configureProduct"
    )
    const configuredTargets = permissions
      .filter((permission) => permission.selector === configureProductSelector)
      .map((permission) => permission.target.toLowerCase())
    const generatedTargets = generatedHookAddressList.map((address) =>
      address.toLowerCase()
    )

    expect(configuredTargets.sort()).toEqual(generatedTargets.sort())
  })

  it("allows adding currencies only on the bound slicer", () => {
    const policy = createStoreManagementCallPolicy(base.id, slicerAddress)
    if (policy.policyParams.type !== "call") {
      throw new Error("Store management policy must be a call policy.")
    }

    const permissions = policy.policyParams.permissions ?? []
    const addCurrenciesSelector = selectorFor(slicerAbi, "_addCurrencies")
    const configuredTargets = permissions
      .filter((permission) => permission.selector === addCurrenciesSelector)
      .map((permission) => permission.target.toLowerCase())

    expect(configuredTargets).toEqual([slicerAddress.toLowerCase()])
  })
})
