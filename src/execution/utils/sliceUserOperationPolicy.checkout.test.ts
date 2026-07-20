import { describe, expect, it } from "bun:test"
import { productsModuleAbi } from "@slicekit/abi"
import { type Address, encodeFunctionData, erc20Abi, zeroAddress } from "viem"
import { entryPoint07Address } from "viem/account-abstraction"
import { anvil, base } from "viem/chains"
import { getProductsModuleAddress } from "../generated/commerceFacts"
import { coinbaseSmartWalletExecutionAbi } from "./slicePaymasterAbis"
import {
  getSliceUserOperationCheckoutSpendIntent,
  isAcceptedSliceUserOperation
} from "./sliceUserOperationPolicy"

const buyer = "0x0000000000000000000000000000000000000001" as Address
const token = "0x0000000000000000000000000000000000000002" as Address
const productsModuleAddress = getProductsModuleAddress(base.id)

const buyCallData = encodeFunctionData({
  abi: productsModuleAbi,
  functionName: "buy",
  args: [
    buyer,
    [
      {
        currency: token,
        data: { actionData: ["0x12"], pricingData: ["0x34"] },
        products: [{ productId: 7, quantity: 2, variantId: 3 }],
        slicerId: 9n
      }
    ],
    [
      {
        amount: 5n,
        currency: token,
        data: [],
        recipient: zeroAddress,
        slicerId: 9n
      }
    ],
    zeroAddress,
    zeroAddress,
    []
  ]
})

describe("getSliceUserOperationCheckoutSpendIntent", () => {
  it("decodes product purchases and additional payments", () => {
    const callData = encodeFunctionData({
      abi: coinbaseSmartWalletExecutionAbi,
      functionName: "execute",
      args: [productsModuleAddress, 11n, buyCallData]
    })

    expect(getSliceUserOperationCheckoutSpendIntent(callData, base.id)).toEqual(
      {
        approvals: [],
        nativeValue: 11n,
        payments: [{ amount: 5n, currency: token }],
        purchases: [
          {
            buyer,
            currency: token,
            platform: zeroAddress,
            pricingData: ["0x34"],
            products: [{ productId: 7, quantity: 2, variantId: 3 }],
            referrer: zeroAddress,
            slicerId: 9n
          }
        ]
      }
    )
  })

  it("extracts an existing approval without requiring one", () => {
    const approval = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [productsModuleAddress, 20n]
    })
    const callData = encodeFunctionData({
      abi: coinbaseSmartWalletExecutionAbi,
      functionName: "executeBatch",
      args: [
        [
          { data: approval, target: token, value: 0n },
          { data: buyCallData, target: productsModuleAddress, value: 11n }
        ]
      ]
    })

    expect(
      getSliceUserOperationCheckoutSpendIntent(callData, base.id)?.approvals
    ).toEqual([{ amount: 20n, currency: token }])
  })
})

describe("isAcceptedSliceUserOperation", () => {
  const userOperation = {
    callData: encodeFunctionData({
      abi: coinbaseSmartWalletExecutionAbi,
      functionName: "execute",
      args: [productsModuleAddress, 0n, buyCallData]
    }),
    nonce: "0x0",
    sender: buyer
  } as const
  const fetchSlicer = async () => {
    throw new Error("Known Slice targets must not require a slicer lookup.")
  }

  it("accepts a configured development chain without changing the Base default", async () => {
    await expect(
      isAcceptedSliceUserOperation({
        chainId: anvil.id,
        entryPoint: entryPoint07Address,
        fetchSlicer,
        userOperation
      })
    ).resolves.toBe(false)

    await expect(
      isAcceptedSliceUserOperation({
        acceptedChainIds: [anvil.id],
        chainId: anvil.id,
        entryPoint: entryPoint07Address,
        fetchSlicer,
        userOperation
      })
    ).resolves.toBe(true)
  })

  it("rejects an empty nonce instead of throwing", async () => {
    await expect(
      isAcceptedSliceUserOperation({
        chainId: base.id,
        entryPoint: entryPoint07Address,
        fetchSlicer,
        userOperation: { ...userOperation, nonce: "0x" }
      })
    ).resolves.toBe(false)
  })
})
