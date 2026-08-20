import { describe, expect, it } from "bun:test"
import {
  productsModuleAbi,
  registryProductActionAbi,
  sliceCoreAbi
} from "@slicekit/abi"
import {
  getFundsModuleAddress,
  getProductsModuleAddress,
  getSliceCoreAddress,
  sliceHookAddressList
} from "@slicekit/abi/deployments"
import {
  type Address,
  concat,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  zeroAddress
} from "viem"
import { base } from "viem/chains"
import { sliceWalletKernelAddresses } from "../../constants"
import {
  kernelValidationManagementAbi,
  kernelWebAuthnValidatorLifecycleAbi
} from "../../kernel/abi"
import { kernelPermissionExecuteSelector } from "../../kernel/permission"
import type {
  SliceCallsBatchClassified,
  SliceSmartAccountCall
} from "../../types/commerce"
import {
  classifySliceSmartAccountCall,
  classifySliceSmartAccountCallsBatch,
  isAcceptedSliceCallsOutcome
} from "./sliceCallPolicy"
import { sliceKernelTimelockPolicyAddress } from "./sliceKernelAddresses"
import { kernelTimelockPolicyCancelAbi } from "./slicePaymasterAbis"
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
const generatedHook = sliceHookAddressList[0] as Address
const cdpBasePaymaster =
  "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" satisfies Address
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
  functionName: "installModule" | "setNonce" | "uninstallModule",
  signerInternalData: Hex = concat([
    "0x12345678",
    zeroAddress,
    kernelPermissionExecuteSelector
  ])
) => {
  if (functionName === "setNonce") {
    return encodeFunctionData({
      abi: kernelValidationManagementAbi,
      args: [0n, 1n],
      functionName
    })
  }
  if (functionName === "installModule") {
    return encodeFunctionData({
      abi: kernelValidationManagementAbi,
      args: [
        [
          {
            internalData: "0x12345678",
            module: sliceWalletKernelAddresses.sudoPolicy,
            moduleData: "0x",
            moduleType: 5n
          },
          {
            internalData: signerInternalData,
            module: sliceWalletKernelAddresses.ecdsaSigner,
            moduleData: "0x",
            moduleType: 6n
          }
        ]
      ],
      functionName
    })
  }
  return encodeFunctionData({
    abi: kernelValidationManagementAbi,
    args: [6n, sliceWalletKernelAddresses.ecdsaSigner, "0x"],
    functionName
  })
}

const upgradeAbi = [
  {
    inputs: [
      { name: "newImplementation", type: "address" },
      { name: "data", type: "bytes" }
    ],
    name: "upgradeToAndCall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

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
      "installModule",
      "setNonce",
      "uninstallModule"
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

  it("rejects privileged self, upgrade, root lifecycle, and module calls from ordinary authority", () => {
    const rootInstall = encodeFunctionData({
      abi: kernelWebAuthnValidatorLifecycleAbi,
      args: [`0x${"11".repeat(96)}`],
      functionName: "onInstall"
    })
    const rootUninstall = encodeFunctionData({
      abi: kernelWebAuthnValidatorLifecycleAbi,
      args: ["0x"],
      functionName: "onUninstall"
    })
    const upgrade = encodeFunctionData({
      abi: upgradeAbi,
      args: [otherAccount, "0x"],
      functionName: "upgradeToAndCall"
    })
    const arbitraryValidatorInstall = encodeFunctionData({
      abi: kernelValidationManagementAbi,
      args: [
        [
          {
            internalData: "0x",
            module: otherAccount,
            moduleData: "0x",
            moduleType: 1n
          }
        ]
      ],
      functionName: "installModule"
    })

    for (const call of [
      { data: "0x12345678" as Hex, target: sender },
      { data: upgrade, target: sender },
      {
        data: rootInstall,
        target: sliceWalletKernelAddresses.webAuthnRootValidator as Address
      },
      {
        data: rootUninstall,
        target: sliceWalletKernelAddresses.webAuthnRootValidator as Address
      },
      { data: arbitraryValidatorInstall, target: sender }
    ] satisfies readonly { data: Hex; target: Address }[]) {
      expect(classify(call)).toBe("unknown")
    }
  })

  it("admits only the existing root lifecycle targets and restrictions", () => {
    for (const [functionName, data] of [
      ["onUninstall", "0x"],
      ["onInstall", `0x${"11".repeat(96)}`]
    ] as const) {
      const lifecycle = encodeFunctionData({
        abi: kernelWebAuthnValidatorLifecycleAbi,
        args: [data],
        functionName
      })
      expect(
        classify({
          data: lifecycle,
          root: true,
          target: sliceWalletKernelAddresses.webAuthnRootValidator
        })
      ).toBe("account")
      expect(
        classify({ data: lifecycle, root: true, target: otherAccount })
      ).toBe("unknown")
      expect(
        classify({
          data: lifecycle,
          root: true,
          target: sliceWalletKernelAddresses.webAuthnRootValidator,
          value: 1n
        })
      ).toBe("unknown")
    }

    for (const [functionName, data] of [
      ["onUninstall", "0x01"],
      ["onInstall", `0x${"11".repeat(95)}`]
    ] as const) {
      expect(
        classify({
          data: encodeFunctionData({
            abi: kernelWebAuthnValidatorLifecycleAbi,
            args: [data],
            functionName
          }),
          root: true,
          target: sliceWalletKernelAddresses.webAuthnRootValidator
        })
      ).toBe("unknown")
    }

    expect(
      classify({
        data: encodeFunctionData({
          abi: upgradeAbi,
          args: [otherAccount, "0x"],
          functionName: "upgradeToAndCall"
        }),
        root: true,
        target: sender
      })
    ).toBe("unknown")
  })

  it("classifies Kernel administration without requiring Slice commerce contracts", () => {
    expect(
      classifySliceSmartAccountCall(
        {
          data: encodeKernelAdministration("installModule"),
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

  it("restricts signer installs to Kernel execute with the zero or selector hook", () => {
    const hookSelector = "0x0000000000000000000000000000000000000001" as const
    expect(
      classify({
        data: encodeKernelAdministration(
          "installModule",
          concat(["0x12345678", hookSelector, kernelPermissionExecuteSelector])
        ),
        root: true,
        target: sender
      })
    ).toBe("account")
    for (const internalData of [
      concat(["0x12345678", otherAccount, kernelPermissionExecuteSelector]),
      concat(["0x12345678", zeroAddress, "0x12345678"]),
      "0x12345678"
    ] as const) {
      expect(
        classify({
          data: encodeKernelAdministration("installModule", internalData),
          root: true,
          target: sender
        })
      ).toBe("unknown")
    }
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
          data: encodeKernelAdministration("installModule"),
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
