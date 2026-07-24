import { describe, expect, test } from "bun:test"
import { productsModuleAbi, slicerAbi } from "@slicekit/abi"
import { encodeFunctionData, zeroAddress } from "viem"
import { assertWalletCallsMatchPolicy } from "../../policy"
import { getProductsModuleAddress } from "../generated/commerceFacts"
import {
  assertSliceStoreManagementPolicyDescriptor,
  createSliceStoreManagementPolicyDescriptor,
  deriveSliceStoreManagementPolicyScope
} from "./policies"

const account = "0x1111111111111111111111111111111111111111"
const slicerAddress = "0x2222222222222222222222222222222222222222"
const sliceProductsModuleAddress = getProductsModuleAddress(8453)

const policy = createSliceStoreManagementPolicyDescriptor({
  account,
  chainId: 8453,
  expiresAt: 2_000_000_000,
  slicerAddress,
  slicerId: 2913,
  startsAt: 1_900_000_000
})

describe("Slice store-management wallet policy", () => {
  test("accepts slicer zero as a valid policy scope", () => {
    const zeroPolicy = createSliceStoreManagementPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 2_000_000_000,
      slicerAddress,
      slicerId: 0,
      startsAt: 1_900_000_000
    })

    expect(deriveSliceStoreManagementPolicyScope(zeroPolicy)).toEqual({
      slicerAddress,
      slicerId: 0
    })
  })

  test("accepts an allowlisted zero-value call for the bound slicer", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: productsModuleAbi,
              functionName: "removeProduct",
              args: [2913n, 1n]
            }),
            to: sliceProductsModuleAddress,
            value: 0n
          }
        ],
        policy
      )
    ).not.toThrow()
  })

  test("accepts ProductsModule multicall for batched management calls", () => {
    const setProductType = encodeFunctionData({
      abi: productsModuleAbi,
      functionName: "setProductType",
      args: [2913n, 1n, "2"]
    })

    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: productsModuleAbi,
              functionName: "multicall",
              args: [[setProductType]]
            }),
            to: sliceProductsModuleAddress,
            value: 0n
          }
        ],
        policy
      )
    ).not.toThrow()
  })

  test("accepts adding currencies on the bound slicer", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: slicerAbi,
              functionName: "_addCurrencies",
              args: [[zeroAddress]]
            }),
            to: slicerAddress,
            value: 0n
          }
        ],
        policy
      )
    ).not.toThrow()
  })

  test("accepts store configuration for the bound slicer", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: productsModuleAbi,
              functionName: "setStoreConfig",
              args: [
                2913n,
                {
                  isClosed: true,
                  productTypeActions: [],
                  productTypePricingStrategies: [],
                  referralFeeStore: 0,
                  slicerActions: [],
                  slicerPricingStrategies: []
                }
              ]
            }),
            to: sliceProductsModuleAddress,
            value: 0n
          }
        ],
        policy
      )
    ).not.toThrow()
  })

  test("rejects the same selector for a different slicer", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: productsModuleAbi,
              functionName: "removeProduct",
              args: [2914n, 1n]
            }),
            to: sliceProductsModuleAddress,
            value: 0n
          }
        ],
        policy
      )
    ).toThrow("outside the delegated policy")
  })

  test("rejects value and descriptor substitutions", () => {
    const call = {
      data: encodeFunctionData({
        abi: productsModuleAbi,
        functionName: "removeProduct",
        args: [2913n, 1n]
      }),
      to: sliceProductsModuleAddress,
      value: 1n
    }
    expect(() => assertWalletCallsMatchPolicy([call], policy)).toThrow()
    expect(() =>
      assertSliceStoreManagementPolicyDescriptor(policy, {
        slicerAddress: zeroAddress,
        slicerId: 2913
      })
    ).toThrow("unsupported authority")
  })

  test("derives the exact slicer address and padded slicer id", () => {
    expect(deriveSliceStoreManagementPolicyScope(policy)).toEqual({
      slicerAddress,
      slicerId: 2913
    })
  })
})
