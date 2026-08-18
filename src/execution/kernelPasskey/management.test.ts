import { describe, expect, it } from "bun:test"
import { ParamCondition } from "@zerodev/permissions/policies"
import { toFunctionSelector, zeroAddress } from "viem"
import { base } from "viem/chains"
import { sliceWalletKernelAddresses } from "../../constants"
import { toWalletPermissionPolicies } from "../../policy"
import {
  createSliceStoreManagementPermissionPolicies,
  createSliceStoreManagementPolicyDescriptor
} from "../commerce/policies"

const account = "0x2222222222222222222222222222222222222222"
const parameters = {
  account,
  chainId: base.id,
  expiresAt: 2_000_000_000,
  startsAt: 1_900_000_000
} as const

const releaseSelector = toFunctionSelector("release(address,address,bool)")
const roleMutationSelectors = [
  toFunctionSelector("grantRoles(bytes32,address)"),
  toFunctionSelector("revokeRoles(bytes32,address)"),
  toFunctionSelector("setRoles(bytes32,address)"),
  toFunctionSelector("renounceRoles(bytes32)")
] as const

describe("store management permission policies", () => {
  it("encodes identical policy bytes through commerce and Kernel entry paths", () => {
    const descriptorPolicies = toWalletPermissionPolicies(
      createSliceStoreManagementPolicyDescriptor(parameters)
    )
    const kernelPolicies =
      createSliceStoreManagementPermissionPolicies(parameters)

    expect(kernelPolicies.map((policy) => policy.getPolicyData())).toEqual(
      descriptorPolicies.map((policy) => policy.getPolicyData())
    )
    expect(
      kernelPolicies.map((policy) => policy.getPolicyInfoInBytes())
    ).toEqual(descriptorPolicies.map((policy) => policy.getPolicyInfoInBytes()))
    expect(kernelPolicies).toHaveLength(3)
    expect(kernelPolicies[1]?.policyParams).toMatchObject({
      policyAddress: sliceWalletKernelAddresses.slicerRegistryPolicy,
      type: "sudo"
    })
    expect({
      policyData: kernelPolicies.map((policy) => policy.getPolicyData()),
      policyInfoInBytes: kernelPolicies.map((policy) =>
        policy.getPolicyInfoInBytes()
      )
    }).toMatchSnapshot()
  })

  it("omits role changes and pins wildcard release arguments", () => {
    const [callPolicy] =
      createSliceStoreManagementPermissionPolicies(parameters)
    if (callPolicy?.policyParams.type !== "call") {
      throw new Error("Store management policy must start with a call policy.")
    }

    const roleMutations = callPolicy.policyParams.permissions?.filter(
      (permission) =>
        roleMutationSelectors.some(
          (selector) => selector === permission.selector
        )
    )
    const release = callPolicy.policyParams.permissions?.find(
      (permission) => permission.selector === releaseSelector
    )

    expect(roleMutations).toEqual([])
    expect(release).toMatchObject({
      rules: [
        {
          condition: ParamCondition.EQUAL,
          offset: 0
        },
        {
          condition: ParamCondition.EQUAL,
          offset: 64
        }
      ],
      target: zeroAddress,
      valueLimit: 0n
    })
  })
})
