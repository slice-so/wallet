import { describe, expect, it } from "bun:test"
import { productsModuleAbi } from "@slicekit/abi"
import { getProductsModuleAddress } from "@slicekit/abi/deployments"
import { type Address, encodeFunctionData, erc20Abi, zeroAddress } from "viem"
import { entryPoint07Address } from "viem/account-abstraction"
import { anvil, base } from "viem/chains"
import { buildSliceCheckoutAllowanceEnvelope } from "../commerce/checkout"
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
    const envelope = buildSliceCheckoutAllowanceEnvelope({
      chainId: base.id,
      checkoutCall: {
        data: buyCallData,
        to: productsModuleAddress,
        value: 11n
      },
      tokenTotals: [{ amount: 20n, currency: token }]
    })
    const callData = encodeFunctionData({
      abi: coinbaseSmartWalletExecutionAbi,
      functionName: "executeBatch",
      args: [
        envelope.map((call) => ({
          data: call.data ?? "0x",
          target: call.to,
          value: call.value ?? 0n
        }))
      ]
    })

    expect(getSliceUserOperationCheckoutSpendIntent(callData, base.id)).toEqual(
      {
        approvals: [{ amount: 20n, currency: token }],
        nativeValue: 11n,
        payments: [
          {
            amount: 5n,
            currency: token,
            recipient: zeroAddress,
            slicerId: 9n
          }
        ],
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

  it("rejects an approval for another spender", () => {
    const approval = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [buyer, 20n]
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
      getSliceUserOperationCheckoutSpendIntent(callData, base.id)
    ).toBeNull()
  })
})

describe("isAcceptedSliceUserOperation", () => {
  const envelope = buildSliceCheckoutAllowanceEnvelope({
    chainId: base.id,
    checkoutCall: {
      data: buyCallData,
      to: productsModuleAddress,
      value: 0n
    },
    tokenTotals: [{ amount: 20n, currency: token }]
  })
  const userOperation = {
    callData: encodeFunctionData({
      abi: coinbaseSmartWalletExecutionAbi,
      functionName: "executeBatch",
      args: [
        envelope.map((call) => ({
          data: call.data ?? "0x",
          target: call.to,
          value: call.value ?? 0n
        }))
      ]
    }),
    nonce: "0x0",
    sender: buyer
  } as const
  const isSlicerAddress = async () => {
    throw new Error("Known Slice targets must not require a slicer lookup.")
  }

  it("accepts a configured development chain without changing the Base default", async () => {
    await expect(
      isAcceptedSliceUserOperation({
        chainId: anvil.id,
        entryPoint: entryPoint07Address,
        isSlicerAddress,
        userOperation
      })
    ).resolves.toBe(false)

    await expect(
      isAcceptedSliceUserOperation({
        acceptedChainIds: [anvil.id],
        chainId: anvil.id,
        entryPoint: entryPoint07Address,
        isSlicerAddress,
        userOperation
      })
    ).resolves.toBe(true)
  })

  it("rejects an empty nonce instead of throwing", async () => {
    await expect(
      isAcceptedSliceUserOperation({
        chainId: base.id,
        entryPoint: entryPoint07Address,
        isSlicerAddress,
        userOperation: { ...userOperation, nonce: "0x" }
      })
    ).resolves.toBe(false)
  })
})
