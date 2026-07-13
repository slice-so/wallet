import {
  PolicyFlags,
  toInitConfig,
  toPermissionValidator
} from "@zerodev/permissions"
import { CallPolicyVersion, toCallPolicy } from "@zerodev/permissions/policies"
import { toECDSASigner, toEmptyECDSASigner } from "@zerodev/permissions/signers"
import {
  createKernelAccount,
  type KernelSmartAccountImplementation,
  KernelV3_3AccountAbi,
  type KernelValidator
} from "@zerodev/sdk"
import { toKernelPluginManager } from "@zerodev/sdk/accounts"
import { encode7579Calls } from "permissionless/utils"
import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddressEqual,
  isHex,
  numberToHex,
  pad,
  size,
  slice,
  toFunctionSelector,
  type WalletClient,
  zeroAddress
} from "viem"
import {
  type BundlerClient,
  entryPoint07Abi,
  entryPoint07Address,
  type SmartAccount,
  toPackedUserOperation,
  type UserOperation
} from "viem/account-abstraction"
import { privateKeyToAccount, toAccount } from "viem/accounts"
import { readContract } from "viem/actions"
import { getAction } from "viem/utils"
import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletKernelVersion
} from "./constants"
import {
  createSliceWalletRootValidator,
  encodeSliceWalletRootValidatorData
} from "./rootValidator"
import type { SliceWalletRegisteredRootCredential } from "./types/account"
import type {
  CreateDeployedRecoveryPermissionAccountParameters,
  CreateRecoveryPermissionAccountParameters,
  RecoveryUserOperationGas,
  SliceRecoveryProposalStatus,
  SliceTimelockPolicy,
  SliceTimelockPolicyParameters,
  SliceWalletRecoveryCall
} from "./types/recovery"
import type { SliceWalletRegistryCredential } from "./types/registry"

const recoveryEntryPoint = {
  address: sliceWalletEntryPoint.address,
  version: "0.7"
} as const

const recoveryKernelVersion = sliceWalletKernelVersion

const sliceKernelBaseV33Addresses = sliceWalletKernelAddresses
export const sliceWalletTimelockPolicyAddress =
  "0x7f66B69270f96EC6793c545742CCBbBe028Be3f6" satisfies Address
const sliceKernelTimelockPolicyAddress = sliceWalletTimelockPolicyAddress
const sliceKernelWebAuthnValidatorAddress =
  sliceWalletKernelAddresses.webAuthnRootValidator

export const sliceRecoveryTimelockDelaySec = 3 * 24 * 60 * 60
export const sliceRecoveryTimelockExpirationSec = 30 * 24 * 60 * 60

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

const kernelAccountRecoveryAbi = [
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
      {
        name: "vIds",
        type: "bytes21[]"
      },
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

const permissionValidatorType = "0x02" satisfies Hex
const timelockPolicySignatureIndex = 1

const toRecoveryValidationId = (permissionId: Hex) =>
  pad(concat([permissionValidatorType, permissionId]), {
    dir: "right",
    size: 21
  })

const executeSelector = toFunctionSelector(kernelAccountRecoveryAbi[3])
const emptyCallSelector = "0x00000000" satisfies Hex

export const toSliceTimelockPolicy = ({
  delaySec = sliceRecoveryTimelockDelaySec,
  expirationSec = sliceRecoveryTimelockExpirationSec,
  guardian = zeroAddress,
  policyAddress = sliceKernelTimelockPolicyAddress,
  policyFlag = PolicyFlags.FOR_ALL_VALIDATION
}: SliceTimelockPolicyParameters = {}): SliceTimelockPolicy => {
  const policy: SliceTimelockPolicy = {
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
    // ZeroDev's serializable Policy union is closed over its built-in
    // policies. Runtime permission ids only consume getPolicyInfoInBytes()
    // and getPolicyData(); keep real Timelock metadata in
    // sliceTimelockPolicyParams.
    policyParams: {
      policyAddress,
      policyFlag,
      type: "timestamp",
      validAfter: delaySec,
      validUntil: expirationSec
    },
    sliceTimelockPolicyParams: {
      delaySec,
      expirationSec,
      guardian,
      policyAddress,
      policyFlag,
      type: "slice-timelock"
    }
  }

  return policy
}

export const createRecoveryCallPolicy = () =>
  toCallPolicy({
    permissions: [
      {
        selector: emptyCallSelector,
        target: zeroAddress
      },
      {
        selector: toFunctionSelector(webAuthnValidatorLifecycleAbi[1]),
        target: sliceKernelWebAuthnValidatorAddress
      },
      {
        selector: toFunctionSelector(webAuthnValidatorLifecycleAbi[0]),
        target: sliceKernelWebAuthnValidatorAddress
      }
    ],
    policyVersion: CallPolicyVersion.V0_0_5
  })

const createRecoveryPermissionValidator = async ({
  client,
  delaySec,
  expirationSec,
  guardian,
  recoveryPrivateKey,
  recoverySignerAddress
}: {
  client: KernelSmartAccountImplementation["client"]
  delaySec?: number
  expirationSec?: number
  guardian?: Address
  recoveryPrivateKey?: Hex
  recoverySignerAddress: Address
}) => {
  const signer =
    recoveryPrivateKey === undefined
      ? toEmptyECDSASigner(recoverySignerAddress)
      : await toECDSASigner({ signer: privateKeyToAccount(recoveryPrivateKey) })

  return toPermissionValidator(client, {
    entryPoint: recoveryEntryPoint,
    flag: PolicyFlags.NOT_FOR_VALIDATE_SIG,
    kernelVersion: recoveryKernelVersion,
    policies: [
      createRecoveryCallPolicy(),
      toSliceTimelockPolicy({ delaySec, expirationSec, guardian })
    ],
    signer
  })
}

const sliceWalletRecoveryEcdsaSignerAddress =
  "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF" satisfies Address

type BuildRecoveryPermissionInitConfigParameters = {
  client: KernelSmartAccountImplementation["client"]
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
}

export const buildRecoveryPermissionInitConfig = async ({
  client,
  recoverySignerAddress,
  recoveryTimelock
}: BuildRecoveryPermissionInitConfigParameters) => {
  const validator = await createRecoveryPermissionValidator({
    client,
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    recoverySignerAddress
  })

  return {
    initConfig: await toInitConfig(validator),
    permissionId: validator.getIdentifier()
  }
}

export const assertRecoveryPermissionInitConfig = async ({
  client,
  initConfig
}: {
  client: KernelSmartAccountImplementation["client"]
  initConfig: readonly Hex[]
}) => {
  if (initConfig.length !== 2 || initConfig[0] === undefined) {
    throw new Error("Wallet recovery init config must contain two calls.")
  }

  const install = decodeFunctionData({
    abi: KernelV3_3AccountAbi,
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
      sliceWalletRecoveryEcdsaSignerAddress
    )
  ) {
    throw new Error("Wallet recovery init config signer is invalid.")
  }

  const recoverySignerAddress = getAddress(slice(signerData, 22, 42))
  const expected = await buildRecoveryPermissionInitConfig({
    client,
    recoverySignerAddress
  })
  if (
    expected.initConfig.some(
      (call, index) => call.toLowerCase() !== initConfig[index]?.toLowerCase()
    )
  ) {
    throw new Error("Wallet recovery init config is not canonical.")
  }

  return {
    permissionId: expected.permissionId,
    recoverySignerAddress
  }
}

export const getSliceWalletRegistryRecoveryInitConfig = async ({
  client,
  credential
}: {
  client: KernelSmartAccountImplementation["client"]
  credential: SliceWalletRegistryCredential
}) => {
  if (
    credential.recoveryPermissionId === null ||
    credential.recoverySignerAddress === null
  ) {
    return undefined
  }
  const recovery = await buildRecoveryPermissionInitConfig({
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

const missingDeployedRoot = () => {
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

const createDeployedRecoveryRootValidator =
  (): KernelValidator<"SliceWalletDeployedRecoveryRoot"> => {
    const account = toAccount({
      address: sliceWalletKernelAddresses.webAuthnRootValidator,
      signMessage: missingDeployedRoot,
      signTransaction: missingDeployedRoot,
      signTypedData: missingDeployedRoot
    })
    return {
      ...account,
      address: sliceWalletKernelAddresses.webAuthnRootValidator,
      // ZeroDev eagerly encodes unused factory data while constructing an
      // account object. Empty public enable data lets that construction finish;
      // every root signing method remains unavailable and factory args are
      // overridden below.
      getEnableData: async () => "0x",
      getIdentifier: () => sliceWalletKernelAddresses.webAuthnRootValidator,
      getNonceKey: async () => 0n,
      getStubSignature: async () => missingDeployedRoot(),
      isEnabled: async () => true,
      signUserOperation: async () => missingDeployedRoot(),
      source: "SliceWalletDeployedRecoveryRoot",
      supportedKernelVersions: recoveryKernelVersion,
      validatorType: "SECONDARY"
    }
  }

const createRecoveryKernelAccount = async ({
  address,
  chainId,
  client,
  enableSignature,
  recoveryValidator,
  rootValidator
}: {
  address: Address
  chainId: number
  client: KernelSmartAccountImplementation["client"]
  enableSignature?: Hex
  recoveryValidator: Awaited<
    ReturnType<typeof createRecoveryPermissionValidator>
  >
  rootValidator: KernelValidator
}) => {
  const plugins = await toKernelPluginManager(client, {
    chainId,
    entryPoint: recoveryEntryPoint,
    ...(enableSignature === undefined
      ? {}
      : { pluginEnableSignature: enableSignature }),
    isPreInstalled: true,
    kernelVersion: recoveryKernelVersion,
    regular: recoveryValidator,
    sudo: rootValidator
  })
  return createKernelAccount(client, {
    address,
    accountImplementationAddress: sliceKernelBaseV33Addresses.implementation,
    entryPoint: recoveryEntryPoint,
    factoryAddress: sliceKernelBaseV33Addresses.factory,
    index: 0n,
    kernelVersion: recoveryKernelVersion,
    metaFactoryAddress: sliceKernelBaseV33Addresses.metaFactory,
    plugins,
    useMetaFactory: true
  })
}

export const createRecoveryPermissionAccount = async ({
  address,
  chainId,
  client,
  credential,
  enableSignature,
  getFactoryArgs,
  recoveryPrivateKey,
  recoverySignerAddress,
  recoveryTimelock
}: CreateRecoveryPermissionAccountParameters) => {
  const [rootValidator, recoveryValidator] = await Promise.all([
    createSliceWalletRootValidator({ chainId, credential }),
    createRecoveryPermissionValidator({
      client,
      delaySec: recoveryTimelock?.delaySec,
      expirationSec: recoveryTimelock?.expirationSec,
      guardian: recoveryTimelock?.guardian,
      recoveryPrivateKey,
      recoverySignerAddress
    })
  ])
  const account = await createRecoveryKernelAccount({
    address,
    chainId,
    client,
    enableSignature,
    recoveryValidator,
    rootValidator
  })

  return {
    ...account,
    ...(getFactoryArgs === undefined ? {} : { getFactoryArgs }),
    recoveryPermissionId: recoveryValidator.getIdentifier()
  }
}

export const createDeployedRecoveryPermissionAccount = async ({
  address,
  chainId,
  client,
  recoveryPrivateKey,
  recoverySignerAddress,
  recoveryTimelock
}: CreateDeployedRecoveryPermissionAccountParameters) => {
  const recoveryValidator = await createRecoveryPermissionValidator({
    client,
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    recoveryPrivateKey,
    recoverySignerAddress
  })
  const account = await createRecoveryKernelAccount({
    address,
    chainId,
    client,
    recoveryValidator,
    rootValidator: createDeployedRecoveryRootValidator()
  })
  return {
    ...account,
    [deployedRecoveryAccountMarker]: true,
    getFactoryArgs: async () => ({
      factory: undefined,
      factoryData: undefined
    }),
    recoveryPermissionId: recoveryValidator.getIdentifier()
  }
}

type BuildRecoveryPermissionCallsParameters = {
  account: Address
  client: KernelSmartAccountImplementation["client"]
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
}

export const buildRecoveryPermissionInstallCalls = async ({
  account,
  client,
  recoverySignerAddress,
  recoveryTimelock
}: BuildRecoveryPermissionCallsParameters): Promise<{
  calls: SliceWalletRecoveryCall[]
  permissionId: Hex
}> => {
  const validator = await createRecoveryPermissionValidator({
    client,
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    recoverySignerAddress
  })
  const permissionId = validator.getIdentifier()
  const validationId = toRecoveryValidationId(permissionId)
  const validationData = await validator.getEnableData(account)

  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: kernelAccountRecoveryAbi,
          args: [
            [validationId],
            [{ hook: zeroAddress, nonce: 1 }],
            [validationData],
            ["0x"]
          ],
          functionName: "installValidations"
        }),
        to: account,
        value: 0n
      },
      {
        data: encodeFunctionData({
          abi: kernelAccountRecoveryAbi,
          args: [validationId, executeSelector, true],
          functionName: "grantAccess"
        }),
        to: account,
        value: 0n
      }
    ],
    permissionId
  }
}

export const buildRecoveryPermissionUninstallCalls = async ({
  account,
  client,
  recoverySignerAddress,
  recoveryTimelock
}: BuildRecoveryPermissionCallsParameters): Promise<{
  calls: SliceWalletRecoveryCall[]
  permissionId: Hex
}> => {
  const validator = await createRecoveryPermissionValidator({
    client,
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    recoverySignerAddress
  })
  const permissionId = validator.getIdentifier()
  const validationId = toRecoveryValidationId(permissionId)
  const validationData = await validator.getEnableData(account)

  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: kernelAccountRecoveryAbi,
          args: [validationId, executeSelector, false],
          functionName: "grantAccess"
        }),
        to: account,
        value: 0n
      },
      {
        data: encodeFunctionData({
          abi: kernelAccountRecoveryAbi,
          args: [validationId, validationData, "0x"],
          functionName: "uninstallValidation"
        }),
        to: account,
        value: 0n
      }
    ],
    permissionId
  }
}

export const buildRecoveryEnableTypedData = async (
  parameters: Omit<
    CreateRecoveryPermissionAccountParameters,
    "enableSignature" | "getFactoryArgs" | "recoveryPrivateKey"
  >
) => {
  const account = await createRecoveryPermissionAccount(parameters)
  return account.kernelPluginManager.getPluginsEnableTypedData(
    parameters.address
  )
}

export const buildRecoveryRotationCalls = (
  newCredential: SliceWalletRegisteredRootCredential
): SliceWalletRecoveryCall[] => [
  {
    data: encodeFunctionData({
      abi: webAuthnValidatorLifecycleAbi,
      args: ["0x"],
      functionName: "onUninstall"
    }),
    to: sliceKernelWebAuthnValidatorAddress,
    value: 0n
  },
  {
    data: encodeFunctionData({
      abi: webAuthnValidatorLifecycleAbi,
      args: [encodeSliceWalletRootValidatorData(newCredential)],
      functionName: "onInstall"
    }),
    to: sliceKernelWebAuthnValidatorAddress,
    value: 0n
  }
]

export const buildRecoveryNoOpCall = (): SliceWalletRecoveryCall => ({
  data: "0x",
  to: zeroAddress,
  value: 0n
})

export const buildRecoveryNoOpCallData = () =>
  encode7579Calls({
    callData: [buildRecoveryNoOpCall()],
    mode: { type: "call" }
  })

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
  if (!isHex(signature) || slice(signature, 0, 1) !== "0xff") {
    throw new Error("Recovery proposal signatures require permission mode.")
  }

  const proposalSignature = encodeRecoveryProposalSignature({
    callData,
    nonce
  })

  return concat([
    numberToHex(timelockPolicySignatureIndex, { size: 1 }),
    numberToHex(size(proposalSignature), { size: 8 }),
    proposalSignature,
    signature
  ])
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
  to: sliceKernelTimelockPolicyAddress,
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
  } satisfies UserOperation<"0.7">

  return {
    ...userOperationBase,
    signature: await account.signUserOperation({
      ...userOperationBase,
      chainId
    })
  } satisfies UserOperation<"0.7">
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
    address: entryPoint07Address,
    abi: entryPoint07Abi,
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
  userOperation: UserOperation<"0.7">
  walletClient: WalletClient
}) =>
  walletClient.writeContract({
    account: walletClient.account ?? null,
    address: entryPoint07Address,
    abi: entryPoint07Abi,
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
  client: KernelSmartAccountImplementation["client"]
  nonce: bigint
  permissionId: Hex
}) => {
  const [status, validAfter, validUntil] = await getAction(
    client,
    readContract,
    "readContract"
  )({
    abi: timelockPolicyAbi,
    address: sliceKernelTimelockPolicyAddress,
    args: [account, callData, nonce, toTimelockPolicyId(permissionId), account],
    functionName: "getProposal"
  })

  return {
    status: getRecoveryProposalStatus(status),
    validAfter,
    validUntil
  }
}

export const getRecoveryConfig = async ({
  account,
  client,
  permissionId
}: {
  account: Address
  client: KernelSmartAccountImplementation["client"]
  permissionId: Hex
}) => {
  const [delaySec, expirationSec, guardian, initialized] = await getAction(
    client,
    readContract,
    "readContract"
  )({
    abi: timelockPolicyConfigAbi,
    address: sliceKernelTimelockPolicyAddress,
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

  return {
    status: getRecoveryProposalStatus(status),
    validAfter,
    validUntil
  }
}
