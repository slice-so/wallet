import { describe, expect, test } from "bun:test"
import {
  sliceWalletKernelAddresses,
  toWalletPermissionPolicies
} from "@slicekit/wallet-primitives"
import { toFunctionSelector, zeroAddress } from "viem"
import { base } from "viem/chains"
import {
  createSliceStoreManagementPermissionPolicies,
  createSliceStoreManagementPolicyDescriptor
} from "../commerce/policies"

const parameters = {
  account: "0x2222222222222222222222222222222222222222",
  chainId: base.id,
  expiresAt: 2_000_000_000,
  startsAt: 1_900_000_000
} as const

const roleMutationSelectors = [
  toFunctionSelector("grantRoles(bytes32,address)"),
  toFunctionSelector("revokeRoles(bytes32,address)"),
  toFunctionSelector("setRoles(bytes32,address)"),
  toFunctionSelector("renounceRoles(bytes32)")
] as const

describe("store management permission policies", () => {
  test("uses the same Kernel v4 module encodings at both entry points", () => {
    const descriptorPolicies = toWalletPermissionPolicies(
      createSliceStoreManagementPolicyDescriptor(parameters)
    )
    const policies = createSliceStoreManagementPermissionPolicies(parameters)
    expect(policies).toEqual(descriptorPolicies)
    expect(policies.map((policy) => policy.kind)).toEqual([
      "call",
      "slicer-registry",
      "timestamp"
    ])
    expect(policies[1]?.address).toBe(
      sliceWalletKernelAddresses.slicerRegistryPolicy
    )
  })

  test("omits role changes and pins wildcard release arguments", () => {
    const descriptor = createSliceStoreManagementPolicyDescriptor(parameters)
    expect(
      descriptor.calls.filter((call) =>
        roleMutationSelectors.includes(
          call.selector as (typeof roleMutationSelectors)[number]
        )
      )
    ).toEqual([])
    const release = descriptor.calls.find(
      (call) =>
        call.selector === toFunctionSelector("release(address,address,bool)")
    )
    expect(release).toMatchObject({
      parameterRules: [
        { condition: "equal", offset: 0 },
        { condition: "equal", offset: 64 }
      ],
      target: zeroAddress,
      valueLimit: 0n
    })
  })
})
