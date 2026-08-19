import { describe, expect, it } from "bun:test"
import {
  productsModuleAbi,
  registryProductActionAbi,
  sliceCoreAbi
} from "@slicekit/abi"
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  zeroAddress
} from "viem"
import { base } from "viem/chains"
import type {
  SliceCallsBatchClassified,
  SliceSmartAccountCall
} from "../../types/commerce"
import {
  generatedHookAddressList,
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress
} from "../generated/commerceFacts"
import {
  classifySliceSmartAccountCall,
  classifySliceSmartAccountCallsBatch,
  isAcceptedSliceCallsOutcome
} from "./sliceCallPolicy"
import { sliceKernelTimelockPolicyAddress } from "./sliceKernelAddresses"
import {
  kernelTimelockPolicyCancelAbi,
  kernelValidationManagementAbi
} from "./slicePaymasterAbis"
import { maxAcceptedSliceCallsPerBatch } from "./sliceUserOperationLimits"

const sender = "0x0000000000000000000000000000000000000001" satisfies Address
const token = "0x0000000000000000000000000000000000000002" satisfies Address
const otherAccount =
  "0x0000000000000000000000000000000000000003" satisfies Address
const unknownTarget =
  "0x0000000000000000000000000000000000000004" satisfies Address
const mixedCaseUnknownTarget =
  "0x00000000000000000000000000000000000000aB" satisfies Address
const productsModule = getProductsModuleAddress(base.id)
const fundsModule = getFundsModuleAddress(base.id)
const sliceCore = getSliceCoreAddress(base.id)
const generatedHook = generatedHookAddressList[0] as Address
const cdpBasePaymaster =
  "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" satisfies Address
const recoveryValidationId = `0x02${"11".repeat(20)}` as Hex
const recoveryProposalId = `0x${"22".repeat(32)}` as Hex
const unprivilegedContext = {
  allowAccountAdministration: false,
  chainId: base.id,
  sender
} as const satisfies {
  allowAccountAdministration: boolean
  chainId: number
  sender: Address
}
const rootContext = {
  allowAccountAdministration: true,
  chainId: base.id,
  sender
} as const satisfies {
  allowAccountAdministration: boolean
  chainId: number
  sender: Address
}

const classify = ({
  data,
  target,
  value = 0n,
  root = false
}: {
  data: Hex
  target: Address
  value?: bigint
  root?: boolean
}) =>
  classifySliceSmartAccountCall(
    { data, target, value },
    root ? rootContext : unprivilegedContext
  )

const encodeSetProductType = () =>
  encodeFunctionData({
    abi: productsModuleAbi,
    args: [1n, 2n, "type"],
    functionName: "setProductType"
  })

const encodeProductsMulticall = (data: readonly Hex[]) =>
  encodeFunctionData({
    abi: productsModuleAbi,
    args: [[...data]],
    functionName: "multicall"
  })

const encodeKernelAdministration = (
  functionName: "grantAccess" | "installValidations" | "uninstallValidation"
) => {
  if (functionName === "grantAccess") {
    return encodeFunctionData({
      abi: kernelValidationManagementAbi,
      args: [recoveryValidationId, "0xe9ae5c53", true],
      functionName
    })
  }
  if (functionName === "installValidations") {
    return encodeFunctionData({
      abi: kernelValidationManagementAbi,
      args: [
        [recoveryValidationId],
        [{ hook: zeroAddress, nonce: 1 }],
        ["0x"],
        ["0x"]
      ],
      functionName
    })
  }
  return encodeFunctionData({
    abi: kernelValidationManagementAbi,
    args: [recoveryValidationId, "0x", "0x"],
    functionName
  })
}

describe("classifySliceSmartAccountCall", () => {
  it("accepts known Slice targets and rejects malformed calldata", () => {
    expect(classify({ data: "0x", target: fundsModule })).toBe("slice")
    expect(classify({ data: "0x", target: productsModule })).toBe("invalid")
    expect(classify({ data: "0x", target: unknownTarget })).toBe("unknown")
  })

  it("enforces the ProductsModule multicall depth limit", () => {
    const directCall = encodeSetProductType()
    const oneLevel = encodeProductsMulticall([directCall])
    const twoLevels = encodeProductsMulticall([oneLevel])

    expect(classify({ data: oneLevel, target: productsModule })).toBe("slice")
    expect(classify({ data: twoLevels, target: productsModule })).toBe(
      "invalid"
    )
  })

  it("accepts SliceCore.slice and rejects other SliceCore calldata", () => {
    const sliceData = encodeFunctionData({
      abi: sliceCoreAbi,
      args: [
        {
          controller: sender,
          currencies: [],
          minimumShares: 1n,
          payees: [
            {
              account: sender,
              shares: 1,
              transfersAllowedWhileLocked: false
            }
          ],
          releaseTimelock: 0n,
          sliceCoreFlags: 0,
          slicerFlags: 0,
          transferTimelock: 0
        }
      ],
      functionName: "slice"
    })

    expect(classify({ data: sliceData, target: sliceCore })).toBe("slice")
    expect(classify({ data: "0x", target: sliceCore })).toBe("invalid")
  })

  it("accepts only zero-value configureProduct calls on generated hooks", () => {
    const data = encodeFunctionData({
      abi: registryProductActionAbi,
      args: [1n, 2n, 0n, "0x"],
      functionName: "configureProduct"
    })

    expect(classify({ data, target: generatedHook })).toBe("slice")
    expect(classify({ data, target: generatedHook, value: 1n })).toBe("unknown")
    expect(classify({ data: "0x", target: generatedHook })).toBe("unknown")
  })

  it("accepts approvals only for the exact auxiliary spenders", () => {
    const acceptedSpenders = [
      productsModule,
      fundsModule,
      cdpBasePaymaster
    ] as const satisfies readonly Address[]

    for (const spender of acceptedSpenders) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        args: [spender, 1n],
        functionName: "approve"
      })
      expect(classify({ data, target: token })).toBe("auxiliary")
      expect(classify({ data, target: token, value: 1n })).toBe("unknown")
    }

    expect(
      classify({
        data: encodeFunctionData({
          abi: erc20Abi,
          args: [unknownTarget, 1n],
          functionName: "approve"
        }),
        target: token
      })
    ).toBe("unknown")
  })

  it("classifies every supported Kernel administration function only for root authority", () => {
    for (const functionName of [
      "grantAccess",
      "installValidations",
      "uninstallValidation"
    ] as const) {
      const data = encodeKernelAdministration(functionName)
      expect(classify({ data, root: true, target: sender })).toBe("account")
      expect(classify({ data, target: sender })).toBe("unknown")
      expect(classify({ data, root: true, target: otherAccount })).toBe(
        "unknown"
      )
      expect(classify({ data, root: true, target: sender, value: 1n })).toBe(
        "unknown"
      )
    }
  })

  it("classifies Kernel administration without requiring Slice commerce contracts", () => {
    expect(
      classifySliceSmartAccountCall(
        {
          data: encodeKernelAdministration("installValidations"),
          target: sender,
          value: 0n
        },
        { allowAccountAdministration: true, chainId: 10, sender }
      )
    ).toBe("account")
    expect(
      classifySliceSmartAccountCall(
        { data: "0x", target: unknownTarget, value: 0n },
        { allowAccountAdministration: false, chainId: 10, sender }
      )
    ).toBe("invalid")
  })

  it("binds recovery cancellation to the timelock and sender account", () => {
    const encodeCancelProposal = (account: Address) =>
      encodeFunctionData({
        abi: kernelTimelockPolicyCancelAbi,
        args: [recoveryProposalId, account, "0x", 0n],
        functionName: "cancelProposal"
      })
    const senderCancellation = encodeCancelProposal(sender)

    expect(
      classify({
        data: senderCancellation,
        root: true,
        target: sliceKernelTimelockPolicyAddress
      })
    ).toBe("account")
    expect(
      classify({
        data: senderCancellation,
        target: sliceKernelTimelockPolicyAddress
      })
    ).toBe("unknown")
    expect(
      classify({ data: senderCancellation, root: true, target: otherAccount })
    ).toBe("unknown")
    expect(
      classify({
        data: encodeCancelProposal(otherAccount),
        root: true,
        target: sliceKernelTimelockPolicyAddress
      })
    ).toBe("unknown")
    expect(
      classify({
        data: senderCancellation,
        root: true,
        target: sliceKernelTimelockPolicyAddress,
        value: 1n
      })
    ).toBe("unknown")
  })
})

describe("classifySliceSmartAccountCallsBatch", () => {
  it("rejects empty, oversized, and invalid batches", () => {
    expect(
      classifySliceSmartAccountCallsBatch([], unprivilegedContext)
    ).toEqual({ status: "rejected", reason: "empty" })

    const oversizedBatch = Array.from(
      { length: maxAcceptedSliceCallsPerBatch + 1 },
      (): SliceSmartAccountCall => ({
        data: "0x",
        target: fundsModule,
        value: 0n
      })
    )
    expect(
      classifySliceSmartAccountCallsBatch(oversizedBatch, unprivilegedContext)
    ).toEqual({ status: "rejected", reason: "too_many_calls" })

    expect(
      classifySliceSmartAccountCallsBatch(
        [{ data: "0x", target: productsModule, value: 0n }],
        unprivilegedContext
      )
    ).toEqual({ status: "rejected", reason: "invalid_call" })
  })

  it("aggregates administration and Slice intent while normalizing and deduping unknown targets", () => {
    const batch = classifySliceSmartAccountCallsBatch(
      [
        {
          data: encodeKernelAdministration("installValidations"),
          target: sender,
          value: 0n
        },
        { data: "0x", target: fundsModule, value: 0n },
        { data: "0x", target: mixedCaseUnknownTarget, value: 0n },
        {
          data: "0x",
          target: mixedCaseUnknownTarget.toLowerCase() as Address,
          value: 0n
        },
        { data: "0x", target: unknownTarget, value: 0n }
      ],
      rootContext
    )

    expect(batch).toEqual({
      status: "classified",
      includesAccountAdministration: true,
      includesSliceIntent: true,
      unknownTargets: [
        mixedCaseUnknownTarget.toLowerCase() as Address,
        unknownTarget
      ]
    })
  })
})

describe("isAcceptedSliceCallsOutcome", () => {
  const approvalOnlyBatch = {
    status: "classified",
    includesAccountAdministration: false,
    includesSliceIntent: false,
    unknownTargets: []
  } as const satisfies SliceCallsBatchClassified
  const unknownOnlyBatch = {
    status: "classified",
    includesAccountAdministration: false,
    includesSliceIntent: false,
    unknownTargets: [unknownTarget]
  } as const satisfies SliceCallsBatchClassified
  const twoUnknownTargetsBatch = {
    status: "classified",
    includesAccountAdministration: false,
    includesSliceIntent: false,
    unknownTargets: [unknownTarget, mixedCaseUnknownTarget]
  } as const satisfies SliceCallsBatchClassified

  it("rejects approval-only and non-slicer outcomes while accepting an indexed unknown target", () => {
    expect(
      isAcceptedSliceCallsOutcome({
        batch: approvalOnlyBatch,
        unknownTargetsAreSlicers: []
      })
    ).toBe(false)
    expect(
      isAcceptedSliceCallsOutcome({
        batch: unknownOnlyBatch,
        unknownTargetsAreSlicers: [false]
      })
    ).toBe(false)
    expect(
      isAcceptedSliceCallsOutcome({
        batch: unknownOnlyBatch,
        unknownTargetsAreSlicers: [true]
      })
    ).toBe(true)
  })

  it("accepts a Slice-intent batch without unknown targets", () => {
    expect(
      isAcceptedSliceCallsOutcome({
        batch: {
          status: "classified",
          includesAccountAdministration: false,
          includesSliceIntent: true,
          unknownTargets: []
        },
        unknownTargetsAreSlicers: []
      })
    ).toBe(true)
  })

  it("rejects short, empty, and over-length resolver arrays", () => {
    for (const unknownTargetsAreSlicers of [[], [true], [true, true, true]]) {
      expect(
        isAcceptedSliceCallsOutcome({
          batch: twoUnknownTargetsBatch,
          unknownTargetsAreSlicers
        })
      ).toBe(false)
    }
  })

  it("requires resolver elements to be strictly true", () => {
    expect(
      isAcceptedSliceCallsOutcome({
        batch: unknownOnlyBatch,
        unknownTargetsAreSlicers: [1 as never]
      })
    ).toBe(false)
  })
})
