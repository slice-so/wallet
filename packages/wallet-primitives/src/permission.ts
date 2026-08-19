import { PolicyFlags } from "@zerodev/permissions"
import {
  type Address,
  bytesToBigInt,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  isAddressEqual,
  keccak256,
  pad,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress
} from "viem"
import { getCode, multicall, readContract } from "viem/actions"
import { getAction } from "viem/utils"
import {
  sliceWalletKernelAddresses,
  sliceWalletKernelVersion
} from "./constants"
import { sliceKernelWeightedP256SignerAddress } from "./execution/utils/sliceKernelAddresses"
import { getWalletPermissionId, toWalletPermissionPolicies } from "./policy"
import type { SliceWalletFrameSession } from "./types/frame"
import type { BuildSliceWalletPermissionEnableTypedDataParameters } from "./types/permission"

const permissionValidatorType = "0x02" satisfies Hex
const kernelExecuteSelector = toFunctionSelector({
  inputs: [
    { name: "mode", type: "bytes32" },
    { name: "executionCalldata", type: "bytes" }
  ],
  name: "execute",
  outputs: [],
  stateMutability: "payable",
  type: "function"
})

const kernelPermissionLifecycleAbi = [
  {
    inputs: [],
    name: "currentNonce",
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { name: "vId", type: "bytes21" },
      { name: "selector", type: "bytes4" }
    ],
    name: "isAllowedSelector",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
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
      { name: "vId", type: "bytes21" },
      { name: "data", type: "bytes" },
      { name: "hookData", type: "bytes" }
    ],
    name: "uninstallValidation",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ name: "pId", type: "bytes4" }],
    name: "permissionConfig",
    outputs: [
      {
        components: [
          { name: "permissionFlag", type: "bytes2" },
          { name: "signer", type: "address" },
          { name: "policyData", type: "bytes22[]" }
        ],
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "vId", type: "bytes21" }],
    name: "validationConfig",
    outputs: [
      {
        components: [
          { name: "nonce", type: "uint32" },
          { name: "hook", type: "address" }
        ],
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

const getP256Coordinates = (publicKey: Hex) => {
  const bytes = hexToBytes(publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Expected an uncompressed P-256 session public key.")
  }
  return {
    x: bytesToBigInt(bytes.slice(1, 33)),
    y: bytesToBigInt(bytes.slice(33, 65))
  }
}

const getPermissionSigner = (session: SliceWalletFrameSession) => {
  const { x, y } = getP256Coordinates(session.publicKey)
  if (session.grantKind === "checkout") {
    if (session.checkout === undefined) {
      throw new Error("Checkout wallet session is missing co-signer metadata.")
    }
    return {
      address: sliceKernelWeightedP256SignerAddress,
      data: encodeAbiParameters(
        [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" },
          { name: "coSigner", type: "address" }
        ],
        [x, y, session.checkout.coSignerAddress]
      )
    }
  }
  return {
    address: sliceWalletKernelAddresses.webAuthnSignerV004,
    data: encodeAbiParameters(
      [
        {
          components: [
            { name: "pubKeyX", type: "uint256" },
            { name: "pubKeyY", type: "uint256" }
          ],
          name: "WebAuthnSignerData",
          type: "tuple"
        },
        { name: "authenticatorIdHash", type: "bytes32" }
      ],
      [{ pubKeyX: x, pubKeyY: y }, keccak256(session.publicKey)]
    )
  }
}

export const getSliceWalletPermissionEnableData = (
  session: SliceWalletFrameSession
) => {
  const signer = getPermissionSigner(session)
  return encodeAbiParameters(
    [{ name: "policyAndSignerData", type: "bytes[]" }],
    [
      [
        ...toWalletPermissionPolicies(session.policy).map((policy) =>
          concat([policy.getPolicyInfoInBytes(), policy.getPolicyData()])
        ),
        concat([PolicyFlags.NOT_FOR_VALIDATE_SIG, signer.address, signer.data])
      ]
    ]
  )
}

const toExecutionValidationId = (permissionId: Hex) =>
  pad(concat([permissionValidatorType, permissionId]), {
    dir: "right",
    size: 21
  })

export const buildSliceWalletPermissionEnableTypedData = async ({
  address,
  client,
  session
}: BuildSliceWalletPermissionEnableTypedDataParameters) => {
  let validatorNonce = 1
  try {
    const nonce = await getAction(
      client,
      readContract,
      "readContract"
    )({
      abi: kernelPermissionLifecycleAbi,
      address,
      functionName: "currentNonce"
    })
    validatorNonce = nonce === 0 ? 1 : nonce
  } catch {}
  const permissionId = getWalletPermissionId(session.policy, session.signerId)
  return {
    domain: {
      chainId: session.chainId,
      name: "Kernel",
      verifyingContract: address,
      version: sliceWalletKernelVersion
    },
    message: {
      hook: zeroAddress,
      hookData: "0x" as Hex,
      nonce: validatorNonce,
      selectorData: concat([
        kernelExecuteSelector,
        zeroAddress,
        zeroAddress,
        encodeAbiParameters(
          parseAbiParameters("bytes selectorInitData, bytes hookInitData"),
          ["0xFF", "0x0000"]
        )
      ]),
      validationId: concat([
        permissionValidatorType,
        pad(permissionId, { dir: "right", size: 20 })
      ]),
      validatorData: getSliceWalletPermissionEnableData(session)
    },
    primaryType: "Enable" as const,
    types: {
      Enable: [
        { name: "validationId", type: "bytes21" },
        { name: "nonce", type: "uint32" },
        { name: "hook", type: "address" },
        { name: "validatorData", type: "bytes" },
        { name: "hookData", type: "bytes" },
        { name: "selectorData", type: "bytes" }
      ]
    }
  }
}

const resolveValidationInstallConfig = ({
  currentNonce,
  validationNonce
}: {
  currentNonce: number
  validationNonce: number
}) => ({
  hook: zeroAddress,
  nonce:
    validationNonce > 0
      ? validationNonce
      : validationNonce === currentNonce
        ? currentNonce + 1
        : currentNonce
})

export const buildSliceWalletPermissionRevocationCalls = async ({
  account,
  client,
  session
}: {
  account: Address
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  session: SliceWalletFrameSession
}) => {
  const signer = getPermissionSigner(session)
  const permissionId = getWalletPermissionId(session.policy, session.signerId)
  const validationId = toExecutionValidationId(permissionId)
  let currentNonce: number
  let validationConfig: { hook: Address; nonce: number }
  let permissionConfig: { signer: Address }
  let selectorAllowed: boolean
  try {
    ;[currentNonce, validationConfig, permissionConfig, selectorAllowed] =
      await getAction(
        client,
        multicall,
        "multicall"
      )({
        allowFailure: false,
        contracts: [
          {
            abi: kernelPermissionLifecycleAbi,
            address: account,
            functionName: "currentNonce"
          },
          {
            abi: kernelPermissionLifecycleAbi,
            address: account,
            args: [validationId],
            functionName: "validationConfig"
          },
          {
            abi: kernelPermissionLifecycleAbi,
            address: account,
            args: [permissionId],
            functionName: "permissionConfig"
          },
          {
            abi: kernelPermissionLifecycleAbi,
            address: account,
            args: [validationId, kernelExecuteSelector],
            functionName: "isAllowedSelector"
          }
        ]
      })
  } catch (error) {
    const code = await getAction(
      client,
      getCode,
      "getCode"
    )({
      address: account
    })
    if (code !== undefined && code !== "0x") throw error
    currentNonce = 1
    validationConfig = { hook: zeroAddress, nonce: 0 }
    permissionConfig = { signer: zeroAddress }
    selectorAllowed = false
  }
  const installed =
    selectorAllowed && isAddressEqual(permissionConfig.signer, signer.address)
  const revoked = validationConfig.nonce > 0 && !installed && !selectorAllowed
  const checkpoint = {
    data: encodeFunctionData({
      abi: kernelPermissionLifecycleAbi,
      args: [validationId, kernelExecuteSelector, false],
      functionName: "grantAccess"
    }),
    to: account,
    value: 0n
  }
  const validationData = getSliceWalletPermissionEnableData(session)
  const uninstall = {
    data: encodeFunctionData({
      abi: kernelPermissionLifecycleAbi,
      args: [validationId, validationData, "0x"],
      functionName: "uninstallValidation"
    }),
    to: account,
    value: 0n
  }
  const install = {
    data: encodeFunctionData({
      abi: kernelPermissionLifecycleAbi,
      args: [
        [validationId],
        [
          resolveValidationInstallConfig({
            currentNonce,
            validationNonce: validationConfig.nonce
          })
        ],
        [validationData],
        ["0x"]
      ],
      functionName: "installValidations"
    }),
    to: account,
    value: 0n
  }
  const alternatives = {
    burn: [install, checkpoint, uninstall],
    checkpoint: [checkpoint],
    uninstall: [checkpoint, uninstall]
  } as const
  let calls: readonly { data: Hex; to: Address; value: bigint }[]
  if (revoked) {
    calls = []
  } else if (installed) {
    calls = alternatives.uninstall
  } else if (validationConfig.nonce === 0) {
    calls = alternatives.burn
  } else {
    calls = alternatives.checkpoint
  }
  return { alternatives, calls, permissionId, revoked }
}

export const areSliceWalletPermissionRevocationCalls = ({
  calls,
  revocations
}: {
  calls: readonly { data?: Hex; to: Address; value?: bigint }[]
  revocations: readonly Awaited<
    ReturnType<typeof buildSliceWalletPermissionRevocationCalls>
  >[]
}) => {
  let offset = 0
  for (const { alternatives } of revocations) {
    const matching = [
      alternatives.burn,
      alternatives.uninstall,
      alternatives.checkpoint
    ].find(
      (candidate) =>
        candidate.length <= calls.length - offset &&
        candidate.every((expected, index) => {
          const received = calls[offset + index]
          return (
            received !== undefined &&
            isAddressEqual(received.to, expected.to) &&
            received.data?.toLowerCase() === expected.data.toLowerCase() &&
            (received.value ?? 0n) === expected.value
          )
        })
    )
    if (matching === undefined) return false
    offset += matching.length
  }
  return offset === calls.length
}
