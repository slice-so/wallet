import {
  getSliceWalletChainPolicy,
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletKernelVersion
} from "@slicekit/wallet-protocol/server"
import { PolicyFlags, toPermissionValidator } from "@zerodev/permissions"
import { toSudoPolicy } from "@zerodev/permissions/policies"
import { createKernelAccount, KernelV3_3AccountAbi } from "@zerodev/sdk"
import {
  concat,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  isAddressEqual,
  keccak256,
  pad,
  slice,
  stringToHex,
  toFunctionSelector,
  zeroAddress
} from "viem"
import { readContract } from "viem/actions"
import { getAction } from "viem/utils"
import { assertSliceWalletExecutionSafety } from "./executionSafety"
import {
  encodeSliceWalletWebAuthnSignerData,
  toSliceWalletWebAuthnSigner
} from "./permissionSigners"
import { buildRecoveryRotationCalls } from "./recovery"
import { createSliceWalletRootValidator } from "./rootValidator"
import type {
  BuildSliceWalletDeviceCallsParameters,
  CreateSliceWalletDeviceKernelAccountParameters,
  CreateSliceWalletDeviceSignerParameters,
  CreateSliceWalletDeviceValidatorParameters,
  SliceWalletDeviceCall,
  SliceWalletDeviceCredential
} from "./types/device"
import { getSliceWalletValidationInstallConfig } from "./validationLifecycle"

const permissionValidatorType = "0x02" satisfies Hex
const executeSelector = toFunctionSelector("execute(bytes32,bytes)")

const kernelDeviceLifecycleAbi = [
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
  }
] as const

const assertCredentialIdHash = (credentialIdHash: Hex) => {
  if (hexToBytes(credentialIdHash).length !== 32) {
    throw new Error("Device credential id hash must be 32 bytes.")
  }
}

export const getSliceWalletDevicePermissionId = (
  credentialIdHash: Hex
): Hex => {
  assertCredentialIdHash(credentialIdHash)
  return slice(
    keccak256(
      concat([stringToHex("slice-wallet-device-v1"), credentialIdHash])
    ),
    0,
    4
  )
}

const toDeviceValidationId = (permissionId: Hex) =>
  pad(concat([permissionValidatorType, permissionId]), {
    dir: "right",
    size: 21
  })

export const toSliceWalletDeviceSigner = ({
  account,
  credential
}: CreateSliceWalletDeviceSignerParameters) => {
  assertCredentialIdHash(credential.credentialIdHash)
  return toSliceWalletWebAuthnSigner({
    account,
    credentialIdHash: credential.credentialIdHash,
    publicKey: credential.publicKey
  })
}

export const createSliceWalletDeviceValidator = async ({
  chainId,
  client,
  credential,
  signer
}: CreateSliceWalletDeviceValidatorParameters) => {
  const manifest = getSliceWalletChainPolicy(chainId)
  if (
    !isAddressEqual(
      signer.signerContractAddress,
      manifest.contracts.webAuthnSigner.address
    )
  ) {
    throw new Error("Device signer does not use the pinned WebAuthnSigner.")
  }
  if (
    signer.getSignerData().toLowerCase() !==
    encodeSliceWalletWebAuthnSignerData(credential).toLowerCase()
  ) {
    throw new Error("Device signer data does not match the credential.")
  }
  return toPermissionValidator(client, {
    entryPoint: sliceWalletEntryPoint,
    flag: PolicyFlags.FOR_ALL_VALIDATION,
    kernelVersion: sliceWalletKernelVersion,
    permissionId: getSliceWalletDevicePermissionId(credential.credentialIdHash),
    policies: [
      toSudoPolicy({ policyAddress: manifest.contracts.sudoPolicy.address })
    ],
    signer
  })
}

export const isSliceWalletDevicePermissionIdAvailable = async ({
  account,
  client,
  credentialIdHash
}: {
  account: `0x${string}`
  client: CreateSliceWalletDeviceValidatorParameters["client"]
  credentialIdHash: Hex
}) => {
  const config = await getAction(
    client,
    readContract,
    "readContract"
  )({
    abi: KernelV3_3AccountAbi,
    address: account,
    args: [getSliceWalletDevicePermissionId(credentialIdHash)],
    functionName: "permissionConfig"
  })
  return isAddressEqual(config.signer, zeroAddress)
}

export const isSliceWalletDeviceActive = async (
  parameters: BuildSliceWalletDeviceCallsParameters
) => {
  const validator = await createSliceWalletDeviceValidator(parameters)
  return validator.isEnabled(parameters.account, executeSelector)
}

export const buildDeviceInstallCalls = async (
  parameters: BuildSliceWalletDeviceCallsParameters
): Promise<{
  calls: readonly SliceWalletDeviceCall[]
  permissionId: Hex
}> => {
  if (
    !(await isSliceWalletDevicePermissionIdAvailable({
      account: parameters.account,
      client: parameters.client,
      credentialIdHash: parameters.credential.credentialIdHash
    }))
  ) {
    throw new Error(
      "Device permission id is already occupied; create a new credential."
    )
  }
  const validator = await createSliceWalletDeviceValidator(parameters)
  const permissionId = validator.getIdentifier()
  const validationId = toDeviceValidationId(permissionId)
  const validationData = await validator.getEnableData(parameters.account)
  const installConfig = await getSliceWalletValidationInstallConfig({
    account: parameters.account,
    client: parameters.client,
    validationId
  })
  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: kernelDeviceLifecycleAbi,
          args: [[validationId], [installConfig], [validationData], ["0x"]],
          functionName: "installValidations"
        }),
        to: parameters.account,
        value: 0n
      },
      {
        data: encodeFunctionData({
          abi: kernelDeviceLifecycleAbi,
          args: [validationId, executeSelector, true],
          functionName: "grantAccess"
        }),
        to: parameters.account,
        value: 0n
      }
    ],
    permissionId
  }
}

export const buildDeviceUninstallCalls = async (
  parameters: BuildSliceWalletDeviceCallsParameters
): Promise<{
  calls: readonly SliceWalletDeviceCall[]
  permissionId: Hex
}> => {
  const validator = await createSliceWalletDeviceValidator(parameters)
  const permissionId = validator.getIdentifier()
  if (!(await validator.isEnabled(parameters.account, executeSelector))) {
    return { calls: [], permissionId }
  }
  const validationId = toDeviceValidationId(permissionId)
  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: kernelDeviceLifecycleAbi,
          args: [validationId, executeSelector, false],
          functionName: "grantAccess"
        }),
        to: parameters.account,
        value: 0n
      },
      {
        data: encodeFunctionData({
          abi: kernelDeviceLifecycleAbi,
          args: [
            validationId,
            await validator.getEnableData(parameters.account),
            "0x"
          ],
          functionName: "uninstallValidation"
        }),
        to: parameters.account,
        value: 0n
      }
    ],
    permissionId
  }
}

export const buildDevicePromotionCalls = async ({
  newRootCredential,
  ...parameters
}: BuildSliceWalletDeviceCallsParameters & {
  newRootCredential: SliceWalletDeviceCredential
}) => {
  const uninstall = await buildDeviceUninstallCalls(parameters)
  if (uninstall.calls.length === 0) {
    throw new Error("The promoted device permission is not installed.")
  }
  return {
    calls: [
      ...buildRecoveryRotationCalls(newRootCredential),
      ...uninstall.calls
    ],
    permissionId: uninstall.permissionId
  }
}

export const createSliceWalletDeviceKernelAccount = async ({
  account,
  accountIndex,
  chainId,
  client,
  rootCredential,
  ...parameters
}: CreateSliceWalletDeviceKernelAccountParameters) => {
  const [deviceValidator, rootValidator] = await Promise.all([
    createSliceWalletDeviceValidator({ chainId, client, ...parameters }),
    createSliceWalletRootValidator({ chainId, credential: rootCredential })
  ])
  const deviceAccount = await createKernelAccount(client, {
    address: account,
    accountImplementationAddress: sliceWalletKernelAddresses.implementation,
    entryPoint: sliceWalletEntryPoint,
    factoryAddress: sliceWalletKernelAddresses.factory,
    index: accountIndex,
    kernelVersion: sliceWalletKernelVersion,
    metaFactoryAddress: sliceWalletKernelAddresses.metaFactory,
    plugins: { regular: deviceValidator, sudo: rootValidator },
    useMetaFactory: true
  })
  const signUserOperation: typeof deviceAccount.signUserOperation = async (
    userOperation
  ) => {
    const effectiveChainId = userOperation.chainId ?? chainId
    if (effectiveChainId !== chainId) {
      throw new Error("Device operation chain does not match the wallet chain.")
    }
    assertSliceWalletExecutionSafety({
      chainId,
      userOperation: {
        ...userOperation,
        sender: userOperation.sender ?? account
      }
    })
    return deviceAccount.signUserOperation(userOperation)
  }
  return {
    ...deviceAccount,
    signUserOperation
  }
}
