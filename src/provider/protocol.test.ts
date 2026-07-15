import { describe, expect, test } from "bun:test"
import { type Address, encodeFunctionData, type Hex, numberToHex } from "viem"
import { assertWalletCallsMatchPolicy } from "../policy"
import type { SliceWalletProviderValue } from "../types"
import { SliceWalletProviderRpcError } from "./errors"
import {
  parseSliceWalletGrantPermissions,
  parseSliceWalletSendCalls,
  parseSliceWalletTransaction
} from "./protocol"

const account = "0x0000000000000000000000000000000000000001" as Address
const recipient = "0x0000000000000000000000000000000000000002" as Address
const token = "0x0000000000000000000000000000000000000003" as Address
const chainId = 8453
const now = 1_800_000_000

const asProviderValue = (value: SliceWalletProviderValue) => value

describe("portable wallet provider protocol", () => {
  test("accepts standard EOA transaction hints without forwarding them", () => {
    expect(
      parseSliceWalletTransaction([
        {
          chainId: "0x2105",
          data: "0x1234",
          from: account,
          gas: "0x5208",
          gasPrice: "0x3b9aca00",
          maxFeePerGas: "0x77359400",
          maxPriorityFeePerGas: "0x3b9aca00",
          nonce: "0x7",
          to: recipient,
          type: "0x2",
          value: "0x1"
        }
      ])
    ).toEqual({
      call: { data: "0x1234", to: recipient, value: 1n },
      from: account
    })
  })

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
            chainId: numberToHex(chainId),
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

  test("requires a 5792 chain id and canonicalizes request-scoped paymaster context", () => {
    const parsed = parseSliceWalletSendCalls({
      account,
      chainId,
      params: asProviderValue([
        {
          atomicRequired: true,
          calls: [{ to: recipient }],
          capabilities: {
            paymasterService: {
              context: {
                policy: { version: 1, id: "checkout" },
                tags: ["portable", "buyer"]
              },
              url: "https://paymaster.example"
            }
          },
          chainId: numberToHex(chainId),
          version: "2.0.0"
        }
      ]),
      paymasterAvailable: false
    })

    expect(parsed.paymasterService).toMatchObject({
      context: {
        canonicalJson:
          '{"policy":{"id":"checkout","version":1},"tags":["portable","buyer"]}',
        value: {
          policy: { id: "checkout", version: 1 },
          tags: ["portable", "buyer"]
        }
      },
      url: "https://paymaster.example/"
    })
    expect(Object.isFrozen(parsed.paymasterService?.context?.value)).toBe(true)

    expect(() =>
      parseSliceWalletSendCalls({
        account,
        chainId,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [{ to: recipient }],
            version: "2.0.0"
          }
        ]),
        paymasterAvailable: false
      })
    ).toThrow("missing a required field")
  })

  test("rejects request-scoped paymasters on individual calls", () => {
    expect(() =>
      parseSliceWalletSendCalls({
        account,
        chainId,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [
              {
                capabilities: {
                  paymasterService: {
                    url: "https://paymaster.example"
                  }
                },
                to: recipient
              }
            ],
            chainId: numberToHex(chainId),
            version: "2.0.0"
          }
        ]),
        paymasterAvailable: false
      })
    ).toThrow("Unsupported required wallet capability: paymasterService")
  })

  test("enforces the final EIP-5792 call-id byte limit", () => {
    const request = (id: string) =>
      parseSliceWalletSendCalls({
        account,
        chainId,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [{ to: recipient }],
            chainId: numberToHex(chainId),
            id,
            version: "2.0.0"
          }
        ]),
        paymasterAvailable: false
      })

    expect(request("a".repeat(4_096)).id).toHaveLength(4_096)
    expect(() => request("a".repeat(4_097))).toThrow(
      "Call id must contain between 1 and 4096"
    )
    expect(() => request("💳".repeat(1_025))).toThrow(
      "Call id must contain between 1 and 4096"
    )
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
