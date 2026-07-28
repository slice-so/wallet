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
const sessionSignerAddress = "0x3333333333333333333333333333333333333333"
const parameters = {
  account,
  chainId: base.id,
  expiresAt: 2_000_000_000,
  sessionSignerAddress,
  startsAt: 1_900_000_000
} as const

const selectorFor = (functionName: "release" | "setRoles") =>
  toFunctionSelector(
    functionName === "setRoles"
      ? "setRoles(bytes32,address)"
      : "release(address,address,bool)"
  )

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

  it("keeps wildcard slicer calls zero-value and pins sensitive arguments", () => {
    const [callPolicy] =
      createSliceStoreManagementPermissionPolicies(parameters)
    if (callPolicy?.policyParams.type !== "call") {
      throw new Error("Store management policy must start with a call policy.")
    }

    const setRoles = callPolicy.policyParams.permissions?.find(
      (permission) => permission.selector === selectorFor("setRoles")
    )
    const release = callPolicy.policyParams.permissions?.find(
      (permission) => permission.selector === selectorFor("release")
    )

    expect(setRoles).toMatchObject({
      rules: [
        {
          condition: ParamCondition.NOT_EQUAL,
          offset: 32
        }
      ],
      target: zeroAddress,
      valueLimit: 0n
    })
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
