import {
  concat,
  type Hex,
  hexToBytes,
  isAddressEqual,
  keccak256,
  slice,
  stringToHex
} from "viem"
import { getCode, multicall, readContract } from "viem/actions"
import { getAction } from "viem/utils"
import { assertSliceWalletExecutionSafety } from "./executionSafety"
import { createKernelV4Account } from "./kernel/account"
import {
  encodeSliceWalletWebAuthnSignerData,
  toSliceWalletWebAuthnSigner
} from "./permissionSigners"
import {
  getSliceWalletChainPolicy,
  type SliceKernelPermission,
  sliceWalletKernelAddresses
} from "./protocol/index"
import {
  buildKernelInstallTypedData,
  encodeKernelInstallPackagesCall,
  encodeKernelPermissionUninstallCalls,
  getKernelPermissionInstallState,
  getKernelPermissionInstalls,
  kernelAccountAbi,
  kernelModuleType,
  resolveSliceWalletDeployment
} from "./protocol/kernel"
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
  credential,
  signer
}: CreateSliceWalletDeviceValidatorParameters): Promise<SliceKernelPermission> => {
  const manifest = getSliceWalletChainPolicy(chainId)
  if (
    !isAddressEqual(signer.address, manifest.contracts.webAuthnSigner.address)
  ) {
    throw new Error("Device signer does not use the pinned WebAuthnSigner.")
  }
  if (
    signer.data.toLowerCase() !==
    encodeSliceWalletWebAuthnSignerData(credential).toLowerCase()
  ) {
    throw new Error("Device signer data does not match the credential.")
  }
  return {
    id: getSliceWalletDevicePermissionId(credential.credentialIdHash),
    policies: [
      {
        address: manifest.contracts.sudoPolicy.address,
        data: "0x",
        kind: "sudo"
      }
    ],
    signer
  }
}

const getDeviceInstallation = async (
  parameters: BuildSliceWalletDeviceCallsParameters
) => {
  const permission = await createSliceWalletDeviceValidator(parameters)
  const code = await getAction(
    parameters.client,
    getCode,
    "getCode"
  )({
    address: parameters.account
  })
  if (code === undefined || code === "0x") {
    return { installed: false, permission }
  }
  const installed = await getAction(
    parameters.client,
    multicall,
    "multicall"
  )({
    allowFailure: false,
    contracts: getKernelPermissionInstalls(permission).map((install) => ({
      abi: kernelAccountAbi,
      address: parameters.account,
      args: [install.moduleType, install.module, permission.id] as const,
      functionName: "isModuleInstalled" as const
    }))
  })
  return { installed: installed.every(Boolean), permission }
}

export const isSliceWalletDevicePermissionIdAvailable = async (parameters: {
  account: `0x${string}`
  client: CreateSliceWalletDeviceValidatorParameters["client"]
  credentialIdHash: Hex
}) => {
  const code = await getAction(
    parameters.client,
    getCode,
    "getCode"
  )({
    address: parameters.account
  })
  if (code === undefined || code === "0x") return true
  return !(await getAction(
    parameters.client,
    readContract,
    "readContract"
  )({
    abi: kernelAccountAbi,
    address: parameters.account,
    args: [
      kernelModuleType.signer,
      sliceWalletKernelAddresses.webAuthnSignerV004,
      getSliceWalletDevicePermissionId(parameters.credentialIdHash)
    ],
    functionName: "isModuleInstalled"
  }))
}

export const isSliceWalletDeviceActive = async (
  parameters: BuildSliceWalletDeviceCallsParameters
) => (await getDeviceInstallation(parameters)).installed

export const buildDeviceInstallCalls = async (
  parameters: BuildSliceWalletDeviceCallsParameters
): Promise<{
  calls: readonly SliceWalletDeviceCall[]
  permissionId: Hex
}> => {
  const { installed, permission } = await getDeviceInstallation(parameters)
  return {
    calls: installed
      ? []
      : [
          {
            data: encodeKernelInstallPackagesCall(
              getKernelPermissionInstalls(permission)
            ),
            to: parameters.account,
            value: 0n
          }
        ],
    permissionId: permission.id
  }
}

export const buildDeviceUninstallCalls = async (
  parameters: BuildSliceWalletDeviceCallsParameters
): Promise<{
  calls: readonly SliceWalletDeviceCall[]
  permissionId: Hex
}> => {
  const { installed, permission } = await getDeviceInstallation(parameters)
  return {
    calls: installed
      ? encodeKernelPermissionUninstallCalls(parameters.account, permission)
      : [],
    permissionId: permission.id
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
      ...buildRecoveryRotationCalls(newRootCredential, {
        chainId: parameters.chainId,
        factoryVersion: parameters.factoryVersion
      }),
      ...uninstall.calls
    ],
    permissionId: uninstall.permissionId
  }
}

export const buildSliceWalletDeviceEnableTypedData = async (
  parameters: BuildSliceWalletDeviceCallsParameters
) => {
  const permission = await createSliceWalletDeviceValidator(parameters)
  const { installNonce } = await getKernelPermissionInstallState({
    account: parameters.account,
    client: parameters.client,
    permission
  })
  return buildKernelInstallTypedData({
    account: parameters.account,
    chainId: parameters.chainId,
    nonce: installNonce,
    packages: getKernelPermissionInstalls(permission)
  })
}

export const createSliceWalletDeviceKernelAccount = async ({
  account,
  accountIndex,
  chainId,
  client,
  enableSignature,
  factoryVersion,
  rootCredential,
  ...parameters
}: CreateSliceWalletDeviceKernelAccountParameters) => {
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  const [permission, rootValidator] = await Promise.all([
    createSliceWalletDeviceValidator({
      chainId,
      client,
      factoryVersion: deployment.profile.id,
      ...parameters
    }),
    createSliceWalletRootValidator({
      chainId,
      credential: rootCredential,
      factoryVersion: deployment.profile.id
    })
  ])
  const deviceAccount = await createKernelV4Account({
    address: account,
    client,
    ...(enableSignature === undefined ? {} : { enableSignature }),
    entryPoint: deployment.entryPoint,
    ...(deployment.erc6492BootstrapFactory === undefined
      ? {}
      : {
          erc6492BootstrapFactory: deployment.erc6492BootstrapFactory
        }),
    factory: deployment.factory,
    implementation: deployment.implementation,
    nonce: accountIndex,
    permission,
    rootValidator
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
  return { ...deviceAccount, signUserOperation }
}
