import { describe, expect, it } from "bun:test"
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  toFunctionSelector,
  zeroAddress
} from "viem"
import {
  assertWalletCallsMatchPolicy,
  createErc20ApproveCallRule,
  createErc20TransferCallRule,
  createErc20TransferFromCallRule,
  createNativeTransferCallRule,
  encodeWalletPolicyDescriptor,
  getWalletPermissionId,
  getWalletPermissionValidAfter,
  toWalletPermissionPolicies,
  walletPolicyWildcardTarget
} from "./policy"
import type { WalletPolicyDescriptor } from "./types"

const account = "0x1000000000000000000000000000000000000001" as Address
const recipient = "0x2000000000000000000000000000000000000002" as Address
const otherRecipient = "0x3000000000000000000000000000000000000003" as Address
const token = "0x4000000000000000000000000000000000000004" as Address
const spender = "0x5000000000000000000000000000000000000005" as Address
const signer = "0x6000000000000000000000000000000000000006" as Address

const descriptor = (
  calls: WalletPolicyDescriptor["calls"]
): WalletPolicyDescriptor => ({
  account,
  calls,
  chainId: 8453,
  grantKind: "generic",
  rateLimit: { count: 1, intervalSec: 60 },
  validAfter: 100,
  validUntil: 200,
  version: 1
})

describe("normalized wallet policies", () => {
  it("allows for block timestamp lag when activating a permission", () => {
    expect(getWalletPermissionValidAfter(1_000_000)).toBe(700)
    expect(getWalletPermissionValidAfter(100_000)).toBe(0)
  })

  it("encodes deterministically and maps to Kernel v4 policies", () => {
    const transfer = createErc20TransferCallRule({
      maximumAmount: 100n,
      recipient,
      token
    })
    const approve = createErc20ApproveCallRule({
      maximumAmount: 200n,
      spender,
      token
    })
    const first = descriptor([transfer, approve])
    const second = descriptor([approve, transfer])

    expect(encodeWalletPolicyDescriptor(first)).toBe(
      encodeWalletPolicyDescriptor(second)
    )
    expect(getWalletPermissionId(first, signer)).toBe(
      getWalletPermissionId(second, signer)
    )
    expect(
      getWalletPermissionId(first, "0x7000000000000000000000000000000000000007")
    ).not.toBe(getWalletPermissionId(first, signer))
    expect(getWalletPermissionId({ ...first, chainId: 10 }, signer)).not.toBe(
      getWalletPermissionId(first, signer)
    )

    const policies = toWalletPermissionPolicies(first)
    expect(policies).toHaveLength(3)
    expect(policies.map((policy) => policy.kind)).toEqual([
      "call",
      "timestamp",
      "rate-limit"
    ])
  })

  it("accepts only the constrained native and ERC-20 templates", () => {
    const policy = descriptor([
      createNativeTransferCallRule({ maximumValue: 2n, recipient }),
      createErc20TransferCallRule({
        maximumAmount: 100n,
        recipient,
        token
      }),
      createErc20ApproveCallRule({
        maximumAmount: 50n,
        spender,
        token
      }),
      createErc20TransferFromCallRule({
        account,
        maximumAmount: 75n,
        recipient,
        token
      })
    ])

    const allowedCalls = [
      { to: recipient, value: 2n },
      {
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, 100n]
        }),
        to: token
      },
      {
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, 50n]
        }),
        to: token
      },
      {
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transferFrom",
          args: [account, recipient, 75n]
        }),
        to: token
      }
    ] as const
    for (const call of allowedCalls) {
      expect(() => assertWalletCallsMatchPolicy([call], policy)).not.toThrow()
    }
    expect(() =>
      assertWalletCallsMatchPolicy(allowedCalls, policy)
    ).not.toThrow()

    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [otherRecipient, 1n]
            }),
            to: token
          }
        ],
        policy
      )
    ).toThrow("parameter")

    expect(() =>
      assertWalletCallsMatchPolicy(
        [
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [spender, 51n]
            }),
            to: token
          }
        ],
        policy
      )
    ).toThrow("parameter")
  })

  it("rejects duplicate rules and invalid validity windows", () => {
    const transfer = createErc20TransferCallRule({
      maximumAmount: 100n,
      recipient,
      token
    })
    expect(() =>
      encodeWalletPolicyDescriptor(descriptor([transfer, transfer]))
    ).toThrow("duplicate")
    expect(() =>
      encodeWalletPolicyDescriptor({
        ...descriptor([transfer]),
        validAfter: 200,
        validUntil: 200
      })
    ).toThrow("validity")
  })

  it("rejects wildcard targets in generic permissions", () => {
    expect(() =>
      encodeWalletPolicyDescriptor(
        descriptor([
          createErc20TransferCallRule({
            maximumAmount: 100n,
            recipient,
            token: zeroAddress
          })
        ])
      )
    ).toThrow("wildcard target")
  })

  it("prefers exact-target rules over management wildcard rules", () => {
    const transferSelector = toFunctionSelector("transfer(address,uint256)")
    const policy: WalletPolicyDescriptor = {
      ...descriptor([
        createErc20TransferCallRule({
          maximumAmount: 100n,
          recipient,
          token
        }),
        {
          parameterRules: [],
          selector: transferSelector,
          target: walletPolicyWildcardTarget,
          valueLimit: 0n
        }
      ]),
      grantKind: "management",
      rateLimit: undefined
    }
    const transfer = (target: Address, to: Address) => ({
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to, 1n]
      }),
      to: target
    })

    expect(() =>
      assertWalletCallsMatchPolicy(
        [transfer(otherRecipient, otherRecipient)],
        policy
      )
    ).not.toThrow()
    expect(() =>
      assertWalletCallsMatchPolicy([transfer(token, otherRecipient)], policy)
    ).toThrow("parameter")
  })

  it("rejects unsafe wildcard native and value-bearing rules", () => {
    expect(() =>
      encodeWalletPolicyDescriptor(
        descriptor([
          {
            parameterRules: [],
            selector: "0x00000000",
            target: zeroAddress,
            valueLimit: 0n
          }
        ])
      )
    ).toThrow("native transfers")
    expect(() =>
      encodeWalletPolicyDescriptor(
        descriptor([
          {
            parameterRules: [],
            selector: toFunctionSelector("transfer(address,uint256)"),
            target: zeroAddress,
            valueLimit: 1n
          }
        ])
      )
    ).toThrow("zero value")
  })
})
