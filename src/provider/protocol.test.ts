import { describe, expect, test } from "bun:test"
import { type Address, encodeFunctionData, type Hex, numberToHex } from "viem"
import { assertWalletCallsMatchPolicy } from "../policy"
import type { SliceWalletProviderValue } from "../types"
import { SliceWalletProviderRpcError } from "./errors"
import {
  parseSliceWalletGrantPermissions,
  parseSliceWalletSendCalls
} from "./protocol"

const account = "0x0000000000000000000000000000000000000001" as Address
const recipient = "0x0000000000000000000000000000000000000002" as Address
const token = "0x0000000000000000000000000000000000000003" as Address
const chainId = 8453
const now = 1_800_000_000

const asProviderValue = (value: SliceWalletProviderValue) => value

describe("portable wallet provider protocol", () => {
  test("maps supported generic templates to exact on-chain rules", () => {
    const parsed = parseSliceWalletGrantPermissions({
      account,
      chainId,
      now,
      params: asProviderValue([
        {
          expiry: now + 3600,
          permissions: [
            {
              data: {
                maximumValue: numberToHex(1_000_000n),
                recipient,
                template: "native-transfer"
              },
              policies: [
                {
                  data: { count: 10, intervalSec: 3600 },
                  type: "rate-limit"
                }
              ],
              type: "slice-call"
            },
            {
              data: {
                maximumAmount: numberToHex(500n),
                recipient,
                template: "erc20-transfer",
                token
              },
              policies: [
                {
                  data: { count: 10, intervalSec: 3600 },
                  type: "rate-limit"
                }
              ],
              type: "slice-call"
            }
          ]
        }
      ])
    })

    expect(parsed.policy.grantKind).toBe("generic")
    expect(parsed.policy.rateLimit).toEqual({ count: 10, intervalSec: 3600 })
    expect(parsed.policy.calls).toHaveLength(2)
    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          { data: "0x", to: recipient, value: 1_000_000n },
          {
            data: encodeFunctionData({
              abi: [
                {
                  inputs: [
                    { name: "to", type: "address" },
                    { name: "amount", type: "uint256" }
                  ],
                  name: "transfer",
                  outputs: [{ name: "", type: "bool" }],
                  stateMutability: "nonpayable",
                  type: "function"
                }
              ],
              args: [recipient, 500n],
              functionName: "transfer"
            }),
            to: token,
            value: 0n
          }
        ],
        parsed.policy
      )
    ).not.toThrow()
  })

  test("rejects parent-provided signers and opaque required permissions", () => {
    const request = {
      account,
      chainId,
      now
    }
    expect(() =>
      parseSliceWalletGrantPermissions({
        ...request,
        params: asProviderValue([
          {
            expiry: now + 3600,
            permissions: [],
            signer: { data: account, type: "address" }
          }
        ])
      })
    ).toThrow("isolated frame")
    expect(() =>
      parseSliceWalletGrantPermissions({
        ...request,
        params: asProviderValue([
          {
            expiry: now + 3600,
            permissions: [
              {
                data: { target: token },
                policies: [],
                required: true,
                type: "contract-call"
              }
            ]
          }
        ])
      })
    ).toThrow("Unsupported wallet permission type")
  })

  test("validates 5792 chain, sender, and required capabilities", () => {
    const baseRequest = {
      account,
      chainId,
      params: asProviderValue([
        {
          atomicRequired: true,
          calls: [{ to: recipient, value: "0x1" }],
          chainId: numberToHex(chainId),
          from: account,
          version: "2.0.0"
        }
      ]),
      paymasterAvailable: false
    }
    expect(parseSliceWalletSendCalls(baseRequest).calls).toEqual([
      { data: "0x", to: recipient, value: 1n }
    ])

    try {
      parseSliceWalletSendCalls({
        ...baseRequest,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [{ to: recipient }],
            capabilities: { paymasterService: {} },
            version: "2.0.0"
          }
        ])
      })
      throw new Error("Expected required capability rejection.")
    } catch (error) {
      expect(error).toBeInstanceOf(SliceWalletProviderRpcError)
      expect((error as SliceWalletProviderRpcError).code).toBe(5700)
    }
  })

  test("normalizes all public maximum amounts as hex quantities", () => {
    const parsed = parseSliceWalletGrantPermissions({
      account,
      chainId,
      now,
      params: asProviderValue([
        {
          expiry: now + 60,
          permissions: [
            {
              data: {
                maximumAmount: 25n,
                spender: recipient,
                template: "erc20-approve",
                token
              },
              policies: [],
              type: "slice-call"
            }
          ]
        }
      ])
    })
    expect(parsed.permissions[0]?.data).toEqual({
      maximumAmount: "0x19" as Hex,
      spender: recipient,
      template: "erc20-approve",
      token
    })
  })
})
