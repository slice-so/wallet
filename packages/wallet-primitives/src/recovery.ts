import { type Policy, PolicyFlags } from "@zerodev/permissions"
import { CallPolicyVersion, toCallPolicy } from "@zerodev/permissions/policies"
import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  pad,
  size,
  slice,
  toFunctionSelector,
  zeroAddress
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
import type { SliceTimelockPolicyParameters } from "./types/recovery"

export const sliceRecoveryTimelockDelaySec = 3 * 24 * 60 * 60
export const sliceRecoveryTimelockExpirationSec = 30 * 24 * 60 * 60
export const sliceWalletTimelockPolicyAddress =
  sliceWalletKernelAddresses.timelockPolicy

const permissionValidatorType = "0x02" satisfies Hex
const emptyCallSelector = "0x00000000" satisfies Hex
const executeSelector = toFunctionSelector("execute(bytes32,bytes)")

const webAuthnValidatorLifecycleAbi = [
  {
    inputs: [{ name: "data", type: "bytes" }],
    name: "onInstall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ name: "data", type: "bytes" }],
    name: "onUninstall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

const kernelRecoveryInitAbi = [
  {
    inputs: [
      { name: "vId", type: "bytes21" },
      { name: "selector", type: "bytes4" },
      { name: "allow", type: "bool" }
    ],
    name: "grantAccess",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { name: "vIds", type: "bytes21[]" },
      {
        components: [
          { name: "nonce", type: "uint32" },
          { name: "hook", type: "address" }
        ],
        name: "configs",
        type: "tuple[]"
      },
      { name: "validationData", type: "bytes[]" },
      { name: "hookData", type: "bytes[]" }
    ],
    name: "installValidations",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { name: "execMode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" }
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

const toSliceTimelockPolicy = ({
  delaySec = sliceRecoveryTimelockDelaySec,
  expirationSec = sliceRecoveryTimelockExpirationSec,
  guardian = zeroAddress,
  policyAddress = sliceWalletTimelockPolicyAddress,
  policyFlag = PolicyFlags.FOR_ALL_VALIDATION
}: SliceTimelockPolicyParameters = {}): Policy => ({
  getPolicyData: () =>
    encodeAbiParameters(
      [
        { name: "delay", type: "uint48" },
        { name: "expirationPeriod", type: "uint48" },
        { name: "guardian", type: "address" }
      ],
      [delaySec, expirationSec, guardian]
    ),
  getPolicyInfoInBytes: () => concat([policyFlag, policyAddress]),
  policyParams: {
    policyAddress,
    policyFlag,
    type: "timestamp",
    validAfter: delaySec,
    validUntil: expirationSec
  }
})

const createRecoveryCallPolicy = () =>
  toCallPolicy({
    permissions: [
      { selector: emptyCallSelector, target: zeroAddress },
      {
        selector: toFunctionSelector(webAuthnValidatorLifecycleAbi[1]),
        target: sliceWalletKernelAddresses.webAuthnRootValidator
      },
      {
        selector: toFunctionSelector(webAuthnValidatorLifecycleAbi[0]),
        target: sliceWalletKernelAddresses.webAuthnRootValidator
      }
    ],
    policyVersion: CallPolicyVersion.V0_0_5
  })

const getRecoveryPermissionData = ({
  recoverySignerAddress,
  recoveryTimelock
}: {
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
}) => {
  const policies = [
    createRecoveryCallPolicy(),
    toSliceTimelockPolicy(recoveryTimelock)
  ]
  const policyData = policies.map((policy) =>
    concat([policy.getPolicyInfoInBytes(), policy.getPolicyData()])
  )
  const signer = concat([
    PolicyFlags.NOT_FOR_VALIDATE_SIG,
    sliceWalletKernelAddresses.ecdsaSigner,
    recoverySignerAddress
  ])
  const policyId = encodeAbiParameters(
    [{ name: "policiesData", type: "bytes[]" }],
    [policyData]
  )
  const signerId = encodeAbiParameters(
    [{ name: "signerData", type: "bytes" }],
    [concat([sliceWalletKernelAddresses.ecdsaSigner, recoverySignerAddress])]
  )
  const permissionId = slice(
    keccak256(
      encodeAbiParameters(
        [{ name: "policyAndSignerData", type: "bytes[]" }],
        [[policyId, PolicyFlags.NOT_FOR_VALIDATE_SIG, signerId]]
      )
    ),
    0,
    4
  )
  return {
    permissionId,
    validationData: encodeAbiParameters(
      [{ name: "policyAndSignerData", type: "bytes[]" }],
      [[...policyData, signer]]
    )
  }
}

export const buildRecoveryPermissionInitConfig = ({
  recoverySignerAddress,
  recoveryTimelock
}: {
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
}) => {
  const { permissionId, validationData } = getRecoveryPermissionData({
    recoverySignerAddress,
    recoveryTimelock
  })
  const validationId = pad(concat([permissionValidatorType, permissionId]), {
    dir: "right",
    size: 21
  })
  const install = encodeFunctionData({
    abi: kernelRecoveryInitAbi,
    args: [
      [validationId],
      [{ hook: zeroAddress, nonce: 1 }],
      [validationData],
      ["0x"]
    ],
    functionName: "installValidations"
  })
  const grantAccess = encodeFunctionData({
    abi: kernelRecoveryInitAbi,
    args: [validationId, executeSelector, true],
    functionName: "grantAccess"
  })
  const delegateMode = `0xff${"00".repeat(31)}` as Hex
  const delegateCall = encodeFunctionData({
    abi: kernelRecoveryInitAbi,
    args: [
      delegateMode,
      concat([sliceWalletKernelAddresses.implementation, grantAccess])
    ],
    functionName: "execute"
  })
  return { initConfig: [install, delegateCall], permissionId }
}

export const assertRecoveryPermissionInitConfig = ({
  initConfig
}: {
  initConfig: readonly Hex[]
}) => {
  if (initConfig.length !== 2 || initConfig[0] === undefined) {
    throw new Error("Wallet recovery init config must contain two calls.")
  }
  const install = decodeFunctionData({
    abi: kernelRecoveryInitAbi,
    data: initConfig[0]
  })
  if (
    install.functionName !== "installValidations" ||
    install.args[0].length !== 1 ||
    install.args[1].length !== 1 ||
    install.args[2].length !== 1 ||
    install.args[3].length !== 1
  ) {
    throw new Error("Wallet recovery init config is not canonical.")
  }
  const [policyAndSignerData] = decodeAbiParameters(
    [{ name: "policyAndSignerData", type: "bytes[]" }],
    install.args[2][0]
  )
  const signerData = policyAndSignerData.at(-1)
  if (
    signerData === undefined ||
    size(signerData) !== 42 ||
    slice(signerData, 0, 2) !== PolicyFlags.NOT_FOR_VALIDATE_SIG ||
    !isAddressEqual(
      getAddress(slice(signerData, 2, 22)),
      sliceWalletKernelAddresses.ecdsaSigner
    )
  ) {
    throw new Error("Wallet recovery init config signer is invalid.")
  }
  const recoverySignerAddress = getAddress(slice(signerData, 22, 42))
  const expected = buildRecoveryPermissionInitConfig({ recoverySignerAddress })
  if (
    expected.initConfig.some(
      (call, index) => call.toLowerCase() !== initConfig[index]?.toLowerCase()
    )
  ) {
    throw new Error("Wallet recovery init config is not canonical.")
  }
  return { permissionId: expected.permissionId, recoverySignerAddress }
}
