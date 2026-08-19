import { describe, expect, it } from "bun:test"
import { productsModuleAbi } from "@slicekit/abi"
import { getProductsModuleAddress } from "@slicekit/abi/deployments"
import { type Address, encodeFunctionData, maxUint256, zeroAddress } from "viem"
import { base } from "viem/chains"
import {
  assertSliceCheckoutCalls,
  buildSliceCheckoutAllowanceEnvelope,
  getSliceCheckoutSpendIntent
} from "./checkout"
import { createSliceCheckoutPolicyDescriptor } from "./policies"

const buyer = "0x0000000000000000000000000000000000000001" as Address
const tokenA = "0x0000000000000000000000000000000000000002" as Address
const tokenB = "0x0000000000000000000000000000000000000003" as Address
const recipient = "0x0000000000000000000000000000000000000004" as Address
const unusedToken = "0x0000000000000000000000000000000000000005" as Address
const productsModule = getProductsModuleAddress(base.id)
const checkoutCall = {
  data: encodeFunctionData({
    abi: productsModuleAbi,
    functionName: "pay",
    args: [
      buyer,
      [
        {
          amount: 8n,
          currency: tokenA,
          data: [],
          recipient,
          slicerId: 0n
        },
        {
          amount: 5n,
          currency: tokenB,
          data: [],
          recipient,
          slicerId: 0n
        }
      ],
      []
    ]
  }),
  to: productsModule,
  value: 0n
} as const

describe("checkout allowance envelope", () => {
  const policy = createSliceCheckoutPolicyDescriptor({
    account: buyer,
    chainId: base.id,
    expiresAt: 2_000_000_000,
    startsAt: 1_900_000_000,
    tokenAddresses: [tokenA, tokenB]
  })

  it("builds deterministic aggregate approvals", () => {
    const calls = buildSliceCheckoutAllowanceEnvelope({
      chainId: base.id,
      checkoutCall,
      tokenTotals: [
        { amount: 3n, currency: tokenA },
        { amount: 5n, currency: tokenB },
        { amount: 5n, currency: tokenA }
      ]
    })

    expect(calls).toHaveLength(3)
    expect(getSliceCheckoutSpendIntent(calls, base.id, buyer)).toMatchObject({
      approvals: [
        { amount: 8n, currency: tokenA },
        { amount: 5n, currency: tokenB }
      ]
    })
    expect(() => assertSliceCheckoutCalls(calls, policy)).not.toThrow()
  })

  it("rejects missing, reordered, or duplicate approvals", () => {
    const calls = buildSliceCheckoutAllowanceEnvelope({
      chainId: base.id,
      checkoutCall,
      tokenTotals: [
        { amount: 8n, currency: tokenA },
        { amount: 5n, currency: tokenB }
      ]
    })
    expect(
      getSliceCheckoutSpendIntent([calls[1], checkoutCall], base.id)
    ).toBeNull()
    expect(
      getSliceCheckoutSpendIntent([calls[1], calls[0], checkoutCall], base.id)
    ).toBeNull()
    expect(
      getSliceCheckoutSpendIntent([calls[0], calls[0], checkoutCall], base.id)
    ).toBeNull()
  })

  it("rejects unused approvals and checked-sum overflow", () => {
    const calls = buildSliceCheckoutAllowanceEnvelope({
      chainId: base.id,
      checkoutCall,
      tokenTotals: [
        { amount: 8n, currency: tokenA },
        { amount: 5n, currency: tokenB },
        { amount: 1n, currency: unusedToken }
      ]
    })
    expect(getSliceCheckoutSpendIntent(calls, base.id, buyer)).toBeNull()

    expect(() =>
      buildSliceCheckoutAllowanceEnvelope({
        chainId: base.id,
        checkoutCall,
        tokenTotals: [
          { amount: maxUint256, currency: tokenA },
          { amount: 1n, currency: tokenA }
        ]
      })
    ).toThrow()
  })

  it("rejects buyer mismatch and empty pay", () => {
    expect(
      getSliceCheckoutSpendIntent(
        buildSliceCheckoutAllowanceEnvelope({
          chainId: base.id,
          checkoutCall,
          tokenTotals: [
            { amount: 8n, currency: tokenA },
            { amount: 5n, currency: tokenB }
          ]
        }),
        base.id,
        zeroAddress
      )
    ).toBeNull()

    const wrongBuyerCall = {
      ...checkoutCall,
      data: encodeFunctionData({
        abi: productsModuleAbi,
        functionName: "pay",
        args: [zeroAddress, [], []]
      })
    }
    expect(() => assertSliceCheckoutCalls([wrongBuyerCall], policy)).toThrow()

    const emptyPay = {
      ...checkoutCall,
      data: encodeFunctionData({
        abi: productsModuleAbi,
        functionName: "pay",
        args: [buyer, [], []]
      })
    }
    expect(getSliceCheckoutSpendIntent([emptyPay], base.id, buyer)).toBeNull()
  })
})
