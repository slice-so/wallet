import {
  buildRecoveryPermissionInitConfig,
  createRecoveryPermission,
  type SliceKernelClient,
  type SliceKernelPermission,
  type SliceKernelValidator,
  type SliceTimelockPolicyParameters,
  type SliceWalletRegisteredRootCredential,
  sliceWalletTimelockPolicyAddress
} from "@slicekit/wallet-primitives"
import {
  buildKernelInstallTypedData,
  encodeKernelInstallPackagesCall,
  encodeKernelPermissionSignature,
  encodeKernelPermissionUninstallCalls,
  getKernelPermissionInstalls,
  kernelAccountAbi,
  kernelWebAuthnValidatorLifecycleAbi,
  resolveSliceWalletDeployment
} from "@slicekit/wallet-primitives/kernel"
import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  isHex,
  numberToHex,
  pad,
  size,
  type WalletClient,
  zeroAddress
} from "viem"
import {
  type BundlerClient,
  entryPoint09Abi,
  entryPoint09Address,
  type SmartAccount,
  toPackedUserOperation,
  type UserOperation
} from "viem/account-abstraction"
import { getCode, multicall, readContract } from "viem/actions"
import { getAction } from "viem/utils"
import { createKernelV4Account } from "./kernel/account"
import { encodeKernelCalls } from "./kernel/execution"
import {
  createSliceWalletRootValidator,
  encodeSliceWalletRootValidatorData
} from "./rootValidator"
import type {
  CreateDeployedRecoveryPermissionAccountParameters,
  CreateRecoveryPermissionAccountParameters,
  RecoveryUserOperationGas,
  SliceRecoveryProposalStatus,
  SliceWalletRecoveryCall
} from "./types/recovery"
import type { SliceWalletRegistryCredential } from "./types/registry"

const timelockPolicySignatureIndex = 1

const timelockPolicyAbi = [
  {
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "callData", type: "bytes" },
      { name: "nonce", type: "uint256" }
    ],
    name: "cancelProposal",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { name: "account", type: "address" },
      { name: "callData", type: "bytes" },
      { name: "nonce", type: "uint256" },
      { name: "id", type: "bytes32" },
      { name: "wallet", type: "address" }
    ],
    name: "getProposal",
    outputs: [
      { name: "status", type: "uint8" },
      { name: "validAfter", type: "uint256" },
      { name: "validUntil", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

const timelockPolicyConfigAbi = [
  {
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "address" }
    ],
    name: "timelockConfig",
    outputs: [
      { name: "delay", type: "uint48" },
      { name: "expirationPeriod", type: "uint48" },
      { name: "guardian", type: "address" },
      { name: "initialized", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

const recoveryProposalStatuses = [
  "none",
  "pending",
  "executed",
  "cancelled"
] as const satisfies readonly SliceRecoveryProposalStatus[]

const getRecoveryProposalStatus = (
  status: number
): SliceRecoveryProposalStatus => {
  const proposalStatus = recoveryProposalStatuses[status]
  if (proposalStatus === undefined) {
    throw new Error(`Unknown recovery proposal status: ${status}.`)
  }
  return proposalStatus
}

const toTimelockPolicyId = (permissionId: Hex) =>
  pad(permissionId, { dir: "right", size: 32 })

export const getSliceWalletRegistryRecoveryInitConfig = async ({
  chainId,
  client,
  credential
}: {
  chainId?: number
  client: SliceKernelClient
  credential: SliceWalletRegistryCredential
}) => {
  if (
    credential.recoveryPermissionId === null ||
    credential.recoverySignerAddress === null
  ) {
    return undefined
  }
  const recovery = await buildRecoveryPermissionInitConfig({
    chainId: chainId ?? client.chain?.id ?? 8453,
    factoryVersion: credential.factoryVersion,
    client,
    recoverySignerAddress: credential.recoverySignerAddress
  })
  if (
    recovery.permissionId.toLowerCase() !==
    credential.recoveryPermissionId.toLowerCase()
  ) {
    throw new Error("Registry recovery metadata is inconsistent.")
  }
  return recovery.initConfig
}

const missingDeployedRoot = async () => {
  throw new Error(
    "Recovery of a deployed account cannot use the root validator."
  )
}

const deployedRecoveryAccountMarker = Symbol("SliceWalletDeployedRecovery")
const isDeployedRecoveryAccount = (account: SmartAccount) =>
  (
    account as SmartAccount & {
      [deployedRecoveryAccountMarker]?: true
    }
  )[deployedRecoveryAccountMarker] === true

const createDeployedRecoveryRootValidator = (
  address: Address
): SliceKernelValidator => ({
  address,
  getEnableData: async () => "0x",
  getStubSignature: missingDeployedRoot,
  signHash: missingDeployedRoot
})

const createRecoveryKernelAccount = ({
  address,
  accountIndex,
  chainId,
  client,
  enableSignature,
  factoryVersion,
  getFactoryArgs,
  permission,
  rootValidator
}: {
  address: Address
  accountIndex: bigint
  chainId: number
  client: SliceKernelClient
  enableSignature?: Hex
  factoryVersion?: string
  getFactoryArgs?: () => Promise<{
    factory?: Address
    factoryData?: Hex
  }>
  permission: SliceKernelPermission
  rootValidator: SliceKernelValidator
}) => {
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  return createKernelV4Account({
    address,
    client,
    ...(enableSignature === undefined ? {} : { enableSignature }),
    entryPoint: deployment.entryPoint,
    ...(deployment.erc6492BootstrapFactory === undefined
      ? {}
      : {
          erc6492BootstrapFactory: deployment.erc6492BootstrapFactory
        }),
    factory: deployment.factory,
    ...(getFactoryArgs === undefined ? {} : { getFactoryArgs }),
    implementation: deployment.implementation,
    nonce: accountIndex,
    permission,
    permissionPreinstalled: true,
    rootValidator
  })
}

export const createRecoveryPermissionAccount = async ({
  address,
  accountIndex,
  chainId,
  client,
  credential,
  enableSignature,
  factoryVersion,
  getFactoryArgs,
  recoveryPrivateKey,
  recoverySignerAddress,
  recoveryTimelock
}: CreateRecoveryPermissionAccountParameters) => {
  const permission = createRecoveryPermission({
    chainId,
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    recoveryPrivateKey,
    recoverySignerAddress
  })
  const account = await createRecoveryKernelAccount({
    address,
    accountIndex,
    chainId,
    client,
    ...(enableSignature === undefined ? {} : { enableSignature }),
    ...(getFactoryArgs === undefined ? {} : { getFactoryArgs }),
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    permission,
    rootValidator: createSliceWalletRootValidator({
      chainId,
      credential,
      ...(factoryVersion === undefined ? {} : { factoryVersion })
    })
  })
  return { ...account, recoveryPermissionId: permission.id }
}

export const createDeployedRecoveryPermissionAccount = async ({
  address,
  accountIndex,
  chainId,
  client,
  factoryVersion,
  recoveryPrivateKey,
  recoverySignerAddress,
  recoveryTimelock
}: CreateDeployedRecoveryPermissionAccountParameters) => {
  const permission = createRecoveryPermission({
    chainId,
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    recoveryPrivateKey,
    recoverySignerAddress
  })
  const account = await createRecoveryKernelAccount({
    address,
    accountIndex,
    chainId,
    client,
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    getFactoryArgs: async () => ({
      factory: undefined,
      factoryData: undefined
    }),
    permission,
    rootValidator: createDeployedRecoveryRootValidator(
      resolveSliceWalletDeployment({ chainId, factoryVersion }).rootValidator
    )
  })
  return {
    ...account,
    [deployedRecoveryAccountMarker]: true,
    recoveryPermissionId: permission.id
  }
}

type BuildRecoveryPermissionCallsParameters = {
  account: Address
  chainId?: number
  client: SliceKernelClient
  factoryVersion?: string
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
}

const getRecoveryPermissionInstalled = async ({
  account,
  client,
  permission
}: {
  account: Address
  client: SliceKernelClient
  permission: SliceKernelPermission
}) => {
  const code = await getAction(client, getCode, "getCode")({ address: account })
  if (code === undefined || code === "0x") return false
  const installed = await getAction(
    client,
    multicall,
    "multicall"
  )({
    allowFailure: false,
    contracts: getKernelPermissionInstalls(permission).map((install) => ({
      abi: kernelAccountAbi,
      address: account,
      args: [install.moduleType, install.module, permission.id] as const,
      functionName: "isModuleInstalled" as const
    }))
  })
  return installed.every(Boolean)
}

export const buildRecoveryPermissionInstallCalls = async ({
  account,
  chainId,
  client,
  factoryVersion,
  recoverySignerAddress,
  recoveryTimelock
}: BuildRecoveryPermissionCallsParameters): Promise<{
  calls: SliceWalletRecoveryCall[]
  permissionId: Hex
}> => {
  const permission = createRecoveryPermission({
    ...(chainId === undefined ? {} : { chainId }),
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    recoverySignerAddress
  })
  const installed = await getRecoveryPermissionInstalled({
    account,
    client,
    permission
  })
  return {
    calls: installed
      ? []
      : [
          {
            data: encodeKernelInstallPackagesCall(
              getKernelPermissionInstalls(permission)
            ),
            to: account,
            value: 0n
          }
        ],
    permissionId: permission.id
  }
}

export const buildRecoveryPermissionUninstallCalls = async ({
  account,
  chainId,
  client,
  factoryVersion,
  recoverySignerAddress,
  recoveryTimelock
}: BuildRecoveryPermissionCallsParameters): Promise<{
  calls: SliceWalletRecoveryCall[]
  permissionId: Hex
}> => {
  const permission = createRecoveryPermission({
    ...(chainId === undefined ? {} : { chainId }),
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    recoverySignerAddress
  })
  const installed = await getRecoveryPermissionInstalled({
    account,
    client,
    permission
  })
  return {
    calls: installed
      ? encodeKernelPermissionUninstallCalls(account, permission)
      : [],
    permissionId: permission.id
  }
}

export const buildRecoveryEnableTypedData = async (
  parameters: Omit<
    CreateRecoveryPermissionAccountParameters,
    "enableSignature" | "getFactoryArgs" | "recoveryPrivateKey"
  >
) => {
  const permission = createRecoveryPermission({
    chainId: parameters.chainId,
    delaySec: parameters.recoveryTimelock?.delaySec,
    expirationSec: parameters.recoveryTimelock?.expirationSec,
    guardian: parameters.recoveryTimelock?.guardian,
    ...(parameters.factoryVersion === undefined
      ? {}
      : { factoryVersion: parameters.factoryVersion }),
    recoverySignerAddress: parameters.recoverySignerAddress
  })
  const code = await getAction(
    parameters.client,
    getCode,
    "getCode"
  )({
    address: parameters.address
  })
  const nonce =
    code === undefined || code === "0x"
      ? 0n
      : await getAction(
          parameters.client,
          readContract,
          "readContract"
        )({
          abi: kernelAccountAbi,
          address: parameters.address,
          args: [0n],
          functionName: "nonce"
        })
  return buildKernelInstallTypedData({
    account: parameters.address,
    chainId: parameters.chainId,
    nonce,
    packages: getKernelPermissionInstalls(permission)
  })
}

export const buildRecoveryRotationCalls = (
  newCredential: SliceWalletRegisteredRootCredential,
  deploymentSelector: { chainId?: number; factoryVersion?: string } = {}
): SliceWalletRecoveryCall[] => {
  const deployment = resolveSliceWalletDeployment({
    chainId: deploymentSelector.chainId ?? 8453,
    factoryVersion: deploymentSelector.factoryVersion
  })
  return [
    {
      data: encodeFunctionData({
        abi: kernelWebAuthnValidatorLifecycleAbi,
        args: ["0x"],
        functionName: "onUninstall"
      }),
      to: deployment.rootValidator,
      value: 0n
    },
    {
      data: encodeFunctionData({
        abi: kernelWebAuthnValidatorLifecycleAbi,
        args: [encodeSliceWalletRootValidatorData(newCredential)],
        functionName: "onInstall"
      }),
      to: deployment.rootValidator,
      value: 0n
    }
  ]
}

export const buildRecoveryNoOpCall = (): SliceWalletRecoveryCall => ({
  data: "0x",
  to: zeroAddress,
  value: 0n
})

export const buildRecoveryNoOpCallData = () =>
  encodeKernelCalls([buildRecoveryNoOpCall()])

export const encodeRecoveryProposalSignature = ({
  callData,
  nonce
}: {
  callData: Hex
  nonce: bigint
}) =>
  concat([
    numberToHex(size(callData), { size: 32 }),
    callData,
    numberToHex(nonce, { size: 32 })
  ])

export const encodeRecoveryProposalUserOperationSignature = ({
  callData,
  nonce,
  signature
}: {
  callData: Hex
  nonce: bigint
  signature: Hex
}) => {
  if (!isHex(signature)) {
    throw new Error("Recovery proposal signature is invalid.")
  }
  let decodedSignatures: readonly Hex[]
  try {
    ;[decodedSignatures] = decodeAbiParameters(
      [{ name: "signatures", type: "bytes[]" }],
      signature
    )
  } catch {
    throw new Error("Recovery proposal signatures require permission mode.")
  }
  if (decodedSignatures.length !== 3) {
    throw new Error("Recovery proposal signatures require permission mode.")
  }
  const signatures = [...decodedSignatures]
  signatures[timelockPolicySignatureIndex] = encodeRecoveryProposalSignature({
    callData,
    nonce
  })
  return encodeKernelPermissionSignature({
    policySignatures: signatures.slice(0, -1),
    signerSignature: signatures.at(-1) ?? "0x"
  })
}

export const withRecoveryProposalSignature = <
  const TAccount extends SmartAccount
>({
  account,
  callData,
  nonce
}: {
  account: TAccount
  callData: Hex
  nonce: bigint
}): TAccount => ({
  ...account,
  signUserOperation: async (userOperation) =>
    encodeRecoveryProposalUserOperationSignature({
      callData,
      nonce,
      signature: await account.signUserOperation(userOperation)
    })
})

export const buildRecoveryCancelCall = ({
  account,
  callData,
  nonce,
  permissionId
}: {
  account: Address
  callData: Hex
  nonce: bigint
  permissionId: Hex
}): SliceWalletRecoveryCall => ({
  data: encodeFunctionData({
    abi: timelockPolicyAbi,
    args: [toTimelockPolicyId(permissionId), account, callData, nonce],
    functionName: "cancelProposal"
  }),
  to: sliceWalletTimelockPolicyAddress,
  value: 0n
})

export const proposeRecovery = ({
  account,
  bundlerClient,
  callData,
  nonce,
  paymaster
}: {
  account: SmartAccount
  bundlerClient: BundlerClient
  callData: Hex
  nonce: bigint
  paymaster?: Parameters<BundlerClient["sendUserOperation"]>[0]["paymaster"]
}) =>
  bundlerClient.sendUserOperation({
    account: withRecoveryProposalSignature({ account, callData, nonce }),
    calls: [buildRecoveryNoOpCall()],
    ...(paymaster === undefined ? {} : { paymaster })
  })

export const executeRecovery = ({
  account,
  bundlerClient,
  calls,
  paymaster
}: {
  account: SmartAccount
  bundlerClient: BundlerClient
  calls: readonly SliceWalletRecoveryCall[]
  paymaster?: Parameters<BundlerClient["sendUserOperation"]>[0]["paymaster"]
}) =>
  bundlerClient.sendUserOperation({
    account,
    calls,
    ...(paymaster === undefined ? {} : { paymaster })
  })

export const buildRecoveryUserOperation = async ({
  account,
  calls,
  chainId,
  gas
}: {
  account: SmartAccount
  calls: readonly SliceWalletRecoveryCall[]
  chainId: number
  gas: RecoveryUserOperationGas
}) => {
  const { factory, factoryData } = await account.getFactoryArgs()
  if (
    isDeployedRecoveryAccount(account) &&
    (factory !== undefined || factoryData !== undefined)
  ) {
    throw new Error("A deployed recovery account cannot include factory data.")
  }
  const userOperationBase = {
    sender: account.address,
    nonce: await account.getNonce(),
    ...(factory === undefined ? {} : { factory }),
    ...(factoryData === undefined ? {} : { factoryData }),
    callData: await account.encodeCalls(calls),
    ...gas,
    signature: "0x"
  } satisfies UserOperation<"0.9">
  return {
    ...userOperationBase,
    signature: await account.signUserOperation({
      ...userOperationBase,
      chainId
    })
  } satisfies UserOperation<"0.9">
}

export const buildRecoveryProposalUserOperation = ({
  account,
  callData,
  chainId,
  gas,
  nonce
}: {
  account: SmartAccount
  callData: Hex
  chainId: number
  gas: RecoveryUserOperationGas
  nonce: bigint
}) =>
  buildRecoveryUserOperation({
    account: withRecoveryProposalSignature({ account, callData, nonce }),
    calls: [buildRecoveryNoOpCall()],
    chainId,
    gas
  })

export const depositRecoveryEntryPoint = ({
  account,
  value,
  walletClient
}: {
  account: Address
  value: bigint
  walletClient: WalletClient
}) =>
  walletClient.writeContract({
    account: walletClient.account ?? null,
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    chain: walletClient.chain ?? null,
    functionName: "depositTo",
    args: [account],
    value
  })

export const submitRecoveryHandleOps = ({
  beneficiary,
  gas,
  userOperation,
  walletClient
}: {
  beneficiary: Address
  gas?: bigint
  userOperation: UserOperation<"0.9">
  walletClient: WalletClient
}) =>
  walletClient.writeContract({
    account: walletClient.account ?? null,
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    chain: walletClient.chain ?? null,
    functionName: "handleOps",
    args: [[toPackedUserOperation(userOperation)], beneficiary],
    ...(gas === undefined ? {} : { gas })
  })

export const getRecoveryState = async ({
  account,
  callData,
  client,
  nonce,
  permissionId
}: {
  account: Address
  callData: Hex
  client: SliceKernelClient
  nonce: bigint
  permissionId: Hex
}) => {
  const [status, validAfter, validUntil] = await getAction(
    client,
    readContract,
    "readContract"
  )({
    abi: timelockPolicyAbi,
    address: sliceWalletTimelockPolicyAddress,
    args: [account, callData, nonce, toTimelockPolicyId(permissionId), account],
    functionName: "getProposal"
  })
  return { status: getRecoveryProposalStatus(status), validAfter, validUntil }
}

export const getRecoveryConfig = async ({
  account,
  client,
  permissionId
}: {
  account: Address
  client: SliceKernelClient
  permissionId: Hex
}) => {
  const [delaySec, expirationSec, guardian, initialized] = await getAction(
    client,
    readContract,
    "readContract"
  )({
    abi: timelockPolicyConfigAbi,
    address: sliceWalletTimelockPolicyAddress,
    args: [toTimelockPolicyId(permissionId), account],
    functionName: "timelockConfig"
  })
  return { delaySec, expirationSec, guardian, initialized }
}

export const decodeRecoveryStateResult = (data: Hex) => {
  const [status, validAfter, validUntil] = decodeFunctionResult({
    abi: timelockPolicyAbi,
    data,
    functionName: "getProposal"
  })
  return { status: getRecoveryProposalStatus(status), validAfter, validUntil }
}
