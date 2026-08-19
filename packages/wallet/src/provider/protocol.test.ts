import { describe, expect, test } from "bun:test"
import { assertWalletCallsMatchPolicy } from "@slicekit/wallet-primitives/server"
import { type Address, encodeFunctionData, type Hex, numberToHex } from "viem"
import type { SliceWalletProviderValue } from "../types"
import { SliceWalletProviderRpcError } from "./errors"
import {
  parseSliceWalletGrantPermissions,
  parseSliceWalletSendCalls,
  parseSliceWalletTransaction,
  toSliceWalletGenericPermissions
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
      chainId,
      from: account
    })
  })

  test("preserves the transaction chain binding while dropping EOA-only hints", () => {
    expect(
      parseSliceWalletTransaction([
        { chainId: "0xa", from: account, to: recipient }
      ]).chainId
    ).toBe(10)
    expect(() =>
      parseSliceWalletTransaction([
        {
          chainId: "0x20000000000000",
          from: account,
          to: recipient
        }
      ])
    ).toThrow("chainId is too large")
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
              required: false,
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
    expect(parsed.permissions[0]).not.toHaveProperty("required")
    expect(toSliceWalletGenericPermissions(parsed.policy)).toEqual(
      parsed.permissions
    )
    const allowedCalls = [
      { data: "0x" as Hex, to: recipient, value: 1_000_000n },
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
    ]
    for (const call of allowedCalls) {
      expect(() =>
        assertWalletCallsMatchPolicy([call], parsed.policy)
      ).not.toThrow()
    }
    expect(() =>
      assertWalletCallsMatchPolicy(allowedCalls, parsed.policy)
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

  test("skips unsupported optional permissions", () => {
    const parsed = parseSliceWalletGrantPermissions({
      account,
      chainId,
      now,
      params: asProviderValue([
        {
          expiry: now + 3600,
          permissions: [
            {
              data: { target: token },
              policies: [],
              required: false,
              type: "contract-call"
            },
            {
              data: {
                maximumValue: "0x1",
                recipient,
                template: "native-transfer"
              },
              policies: [
                {
                  data: { count: 1, intervalSec: 3600 },
                  type: "rate-limit"
                }
              ],
              type: "slice-call"
            }
          ]
        }
      ])
    })

    expect(parsed.permissions).toHaveLength(1)
    expect(parsed.permissions[0]?.data).toMatchObject({
      template: "native-transfer"
    })
  })

  test("enforces canonical generic grant ceilings at the provider boundary", () => {
    const permission = {
      data: {
        maximumValue: "0x1",
        recipient,
        template: "native-transfer"
      },
      policies: [
        {
          data: { count: 1, intervalSec: 60 },
          type: "rate-limit"
        }
      ],
      type: "slice-call"
    } as const
    const parse = (
      permissions: SliceWalletProviderValue[],
      expiry = now + 3_600
    ) =>
      parseSliceWalletGrantPermissions({
        account,
        chainId,
        now,
        params: [{ expiry, permissions }]
      })

    expect(() => parse([permission], now + 30 * 24 * 60 * 60 + 1)).toThrow(
      "within the next 30 days"
    )
    expect(() => parse(Array.from({ length: 17 }, () => permission))).toThrow(
      "between 1 and 16"
    )
    expect(() =>
      parse([
        {
          ...permission,
          policies: [
            {
              data: { count: 101, intervalSec: 60 },
              type: "rate-limit"
            }
          ]
        }
      ])
    ).toThrow("count 1 to 100")
    expect(() =>
      parse([
        permission,
        {
          ...permission,
          policies: [
            {
              data: { count: 1, intervalSec: 61 },
              type: "rate-limit"
            }
          ]
        }
      ])
    ).toThrow("same rate limit")
    expect(() =>
      parse([
        {
          ...permission,
          data: { ...permission.data, unexpected: true }
        }
      ])
    ).toThrow("unknown field")
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

    expect(
      parseSliceWalletSendCalls({
        ...baseRequest,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [{ to: recipient }],
            chainId: "0xa",
            version: "2.0.0"
          }
        ]),
        supportedChainIds: [chainId, 10]
      }).chainId
    ).toBe(10)

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

    expect(() =>
      parseSliceWalletSendCalls({
        account,
        chainId,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [{ to: recipient }],
            chainId: numberToHex(chainId),
            version: "1.0.0"
          }
        ]),
        paymasterAvailable: false
      })
    ).toThrow("wallet_sendCalls 2.0.0")

    try {
      parseSliceWalletSendCalls({
        account,
        chainId,
        params: asProviderValue([
          {
            atomicRequired: true,
            calls: [{ to: recipient }],
            chainId: "0x89",
            version: "2.0.0"
          }
        ]),
        paymasterAvailable: false,
        supportedChainIds: [chainId, 10]
      })
      throw new Error("Expected unsupported chain rejection.")
    } catch (error) {
      expect(error).toBeInstanceOf(SliceWalletProviderRpcError)
      expect((error as SliceWalletProviderRpcError).code).toBe(5710)
    }
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

  test("accepts only canonical public maximum amounts", () => {
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
                maximumAmount: "0x19",
                spender: recipient,
                template: "erc20-approve",
                token
              },
              policies: [
                {
                  data: { count: 1, intervalSec: 60 },
                  type: "rate-limit"
                }
              ],
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
