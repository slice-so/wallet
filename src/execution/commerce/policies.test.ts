import { describe, expect, test } from "bun:test"
import {
  fundsModuleAbi,
  productsModuleAbi,
  sliceCoreAbi,
  slicerAbi
} from "@slicekit/abi"
import { type Address, encodeFunctionData, zeroAddress } from "viem"
import {
  assertWalletCallsMatchPolicy,
  walletPolicyWildcardTarget
} from "../../policy"
import {
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress
} from "../generated/commerceFacts"
import {
  assertSliceStoreManagementPolicyDescriptor,
  bindSliceStoreManagementPolicySigner,
  createSliceStoreManagementPolicyDescriptor
} from "./policies"

const account: Address = "0x1111111111111111111111111111111111111111"
const slicerAddress: Address = "0x2222222222222222222222222222222222222222"
const sessionSignerAddress =
  "0x3333333333333333333333333333333333333333" satisfies Address
const collaboratorAddress =
  "0x4444444444444444444444444444444444444444" satisfies Address
const sliceProductsModuleAddress = getProductsModuleAddress(8453)
const sliceFundsModuleAddress = getFundsModuleAddress(8453)
const sliceCoreAddress = getSliceCoreAddress(8453)

const policy = createSliceStoreManagementPolicyDescriptor({
  account,
  chainId: 8453,
  expiresAt: 2_000_000_000,
  sessionSignerAddress,
  startsAt: 1_900_000_000
})

describe("Slice store-management wallet policy", () => {
  test("binds an unbound universal descriptor to its session signer", () => {
    const unbound = createSliceStoreManagementPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 2_000_000_000,
      startsAt: 1_900_000_000
    })

    expect(
      bindSliceStoreManagementPolicySigner(unbound, sessionSignerAddress)
    ).toEqual(policy)
  })

  test("accepts an allowlisted zero-value call for any slicer id", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: productsModuleAbi,
              functionName: "removeProduct",
              args: [999_999n, 1n]
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

  test("accepts adding currencies on any slicer", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: slicerAbi,
              functionName: "_addCurrencies",
              args: [[zeroAddress]]
            }),
            to: collaboratorAddress,
            value: 0n
          }
        ],
        policy
      )
    ).not.toThrow()
  })

  test("accepts store configuration for any slicer id", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: productsModuleAbi,
              functionName: "setStoreConfig",
              args: [
                999_999n,
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

  test("allows role changes except for the isolated session signer", () => {
    const setRoles = (grantee: `0x${string}`) => ({
      data: encodeFunctionData({
        abi: slicerAbi,
        functionName: "setRoles",
        args: [`0x${"01".padStart(64, "0")}`, grantee]
      }),
      to: collaboratorAddress as Address,
      value: 0n
    })

    expect(() =>
      assertWalletCallsMatchPolicy([setRoles(collaboratorAddress)], policy)
    ).not.toThrow()
    expect(() =>
      assertWalletCallsMatchPolicy([setRoles(sessionSignerAddress)], policy)
    ).toThrow("outside the delegated policy")
  })

  test("allows zero-value calls that withdraw only to the wallet account", () => {
    const release = (recipient: `0x${string}`, withdraw: boolean) => ({
      data: encodeFunctionData({
        abi: slicerAbi,
        functionName: "release",
        args: [recipient, zeroAddress, withdraw]
      }),
      to: collaboratorAddress as Address,
      value: 0n
    })
    const batchWithdraw = (recipient: `0x${string}`) => ({
      data: encodeFunctionData({
        abi: fundsModuleAbi,
        functionName: "batchWithdraw",
        args: [recipient, [zeroAddress]]
      }),
      to: sliceFundsModuleAddress,
      value: 0n
    })

    expect(() =>
      assertWalletCallsMatchPolicy(
        [release(account, true), batchWithdraw(account)],
        policy
      )
    ).not.toThrow()
    expect(() =>
      assertWalletCallsMatchPolicy([release(collaboratorAddress, true)], policy)
    ).toThrow("outside the delegated policy")
    expect(() =>
      assertWalletCallsMatchPolicy([release(account, false)], policy)
    ).toThrow("outside the delegated policy")
    expect(() =>
      assertWalletCallsMatchPolicy([batchWithdraw(collaboratorAddress)], policy)
    ).toThrow("outside the delegated policy")
  })

  test("allows SliceCore store creation without attached ETH", () => {
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: sliceCoreAbi,
              functionName: "slice",
              args: [
                {
                  controller: account,
                  currencies: [],
                  minimumShares: 1n,
                  payees: [
                    {
                      account,
                      shares: 1,
                      transfersAllowedWhileLocked: false
                    }
                  ],
                  releaseTimelock: 0n,
                  sliceCoreFlags: 0,
                  slicerFlags: 0,
                  transferTimelock: 0
                }
              ]
            }),
            to: sliceCoreAddress,
            value: 0n
          }
        ],
        policy
      )
    ).not.toThrow()
  })

  test("accepts the same selector for a different slicer", () => {
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
    ).not.toThrow()
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
      assertSliceStoreManagementPolicyDescriptor({
        ...policy,
        calls: policy.calls.map((rule) =>
          rule.target === walletPolicyWildcardTarget
            ? { ...rule, valueLimit: 1n }
            : rule
        )
      })
    ).toThrow()
  })

  test("rejects legacy per-slicer management descriptors", () => {
    const legacyPolicy = {
      ...policy,
      calls: policy.calls.map((rule) =>
        rule.target === walletPolicyWildcardTarget
          ? { ...rule, target: slicerAddress }
          : rule
      )
    }

    expect(() =>
      assertSliceStoreManagementPolicyDescriptor(legacyPolicy)
    ).toThrow("unsupported authority")
  })
})
