import {
  type Address,
  concat,
  encodeAbiParameters,
  getAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  size,
  slice,
  toFunctionSelector,
  zeroAddress
} from "viem"
import { privateKeyToAccount, toAccount } from "viem/accounts"
import { sliceWalletKernelAddresses } from "./constants"
import { kernelWebAuthnValidatorLifecycleAbi } from "./kernel/abi"
import { kernelDummyEcdsaSignature } from "./kernel/constants"
import { resolveSliceWalletDeployment } from "./kernel/deploymentProfiles"
import { getKernelPermissionInstalls } from "./kernel/permission"
import type {
  SliceKernelClient,
  SliceKernelInstall,
  SliceKernelPermission,
  SliceKernelPolicy
} from "./types/kernel"
import type {
  SliceTimelockPolicy,
  SliceTimelockPolicyParameters
} from "./types/recovery"

export const sliceRecoveryTimelockDelaySec = 3 * 24 * 60 * 60
export const sliceRecoveryTimelockExpirationSec = 30 * 24 * 60 * 60
export const sliceWalletTimelockPolicyAddress =
  sliceWalletKernelAddresses.timelockPolicy

const emptyCallSelector = "0x00000000" as const

export const toSliceTimelockPolicy = ({
  delaySec = sliceRecoveryTimelockDelaySec,
  expirationSec = sliceRecoveryTimelockExpirationSec,
  guardian = zeroAddress,
  policyAddress = sliceWalletTimelockPolicyAddress
}: SliceTimelockPolicyParameters = {}): SliceTimelockPolicy => ({
  address: policyAddress,
  data: encodeAbiParameters(
    [
      { name: "delay", type: "uint48" },
      { name: "expirationPeriod", type: "uint48" },
      { name: "guardian", type: "address" }
    ],
    [delaySec, expirationSec, guardian]
  ),
  kind: "timelock",
  sliceTimelockPolicyParams: {
    delaySec,
    expirationSec,
    guardian,
    policyAddress,
    type: "slice-timelock"
  }
})

const recoveryCallPolicyParameter = {
  components: [
    { name: "callType", type: "bytes1" },
    { name: "target", type: "address" },
    { name: "selector", type: "bytes4" },
    { name: "valueLimit", type: "uint256" },
    {
      components: [
        { name: "condition", type: "uint8" },
        { name: "offset", type: "uint64" },
        { name: "params", type: "bytes32[]" }
      ],
      name: "rules",
      type: "tuple[]"
    }
  ],
  name: "permissions",
  type: "tuple[]"
} as const

export const createRecoveryCallPolicy = ({
  chainId = 8453,
  factoryVersion
}: {
  chainId?: number
  factoryVersion?: string
} = {}): SliceKernelPolicy => {
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  return {
    address: deployment.manifest.contracts.callPolicy.address,
    data: encodeAbiParameters(
      [recoveryCallPolicyParameter],
      [
        [
          {
            callType: "0x00",
            rules: [],
            selector: emptyCallSelector,
            target: zeroAddress,
            valueLimit: 0n
          },
          {
            callType: "0x00",
            rules: [],
            selector: toFunctionSelector(
              kernelWebAuthnValidatorLifecycleAbi[1]
            ),
            target: deployment.rootValidator,
            valueLimit: 0n
          },
          {
            callType: "0x00",
            rules: [],
            selector: toFunctionSelector(
              kernelWebAuthnValidatorLifecycleAbi[0]
            ),
            target: deployment.rootValidator,
            valueLimit: 0n
          }
        ]
      ]
    ),
    kind: "call"
  }
}

const getRecoveryPermissionId = ({
  policies,
  recoverySignerAddress,
  signerModule
}: {
  policies: readonly SliceKernelPolicy[]
  recoverySignerAddress: Address
  signerModule: Address
}) =>
  slice(
    keccak256(
      encodeAbiParameters(
        [
          { name: "policies", type: "bytes[]" },
          { name: "signerModule", type: "address" },
          { name: "signer", type: "address" }
        ],
        [
          policies.map((policy) => concat([policy.address, policy.data])),
          signerModule,
          recoverySignerAddress
        ]
      )
    ),
    0,
    4
  )

const toEmptyRecoveryAccount = (address: Address) =>
  toAccount({
    address,
    async signMessage() {
      throw new Error("The recovery private key is required for signing.")
    },
    async signTransaction() {
      throw new Error("A recovery signer does not sign transactions.")
    },
    async signTypedData() {
      throw new Error("The recovery private key is required for signing.")
    }
  })

export const createRecoveryPermission = ({
  chainId = 8453,
  delaySec,
  expirationSec,
  factoryVersion,
  guardian,
  recoveryPrivateKey,
  recoverySignerAddress
}: {
  chainId?: number
  delaySec?: number
  expirationSec?: number
  factoryVersion?: string
  guardian?: Address
  recoveryPrivateKey?: Hex
  recoverySignerAddress: Address
}): SliceKernelPermission => {
  const account =
    recoveryPrivateKey === undefined
      ? toEmptyRecoveryAccount(recoverySignerAddress)
      : privateKeyToAccount(recoveryPrivateKey)
  if (!isAddressEqual(account.address, recoverySignerAddress)) {
    throw new Error("Recovery private key does not match its signer address.")
  }
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  const signerModule = deployment.manifest.contracts.ecdsaSigner.address
  const policies = [
    createRecoveryCallPolicy({
      chainId,
      factoryVersion: deployment.profile.id
    }),
    toSliceTimelockPolicy({
      delaySec,
      expirationSec,
      guardian,
      policyAddress: deployment.manifest.contracts.timelockPolicy.address
    })
  ]
  return {
    id: getRecoveryPermissionId({
      policies,
      recoverySignerAddress,
      signerModule
    }),
    policies,
    signer: {
      account,
      address: signerModule,
      data: recoverySignerAddress,
      stubSignature: kernelDummyEcdsaSignature
    }
  }
}

type BuildRecoveryPermissionInitConfigParameters = {
  chainId?: number
  client?: SliceKernelClient
  factoryVersion?: string
  recoverySignerAddress: Address
  recoveryTimelock?: SliceTimelockPolicyParameters
}

export const buildRecoveryPermissionInitConfig = async ({
  chainId,
  factoryVersion,
  recoverySignerAddress,
  recoveryTimelock
}: BuildRecoveryPermissionInitConfigParameters) => {
  const permission = createRecoveryPermission({
    ...(chainId === undefined ? {} : { chainId }),
    delaySec: recoveryTimelock?.delaySec,
    expirationSec: recoveryTimelock?.expirationSec,
    guardian: recoveryTimelock?.guardian,
    ...(factoryVersion === undefined ? {} : { factoryVersion }),
    recoverySignerAddress
  })
  return {
    initConfig: getKernelPermissionInstalls(permission),
    permissionId: permission.id
  }
}

export const assertRecoveryPermissionInitConfig = async ({
  chainId,
  client: _client,
  factoryVersion,
  initConfig
}: {
  chainId?: number
  client?: SliceKernelClient
  factoryVersion?: string
  initConfig: readonly SliceKernelInstall[]
}) => {
  const deployment = resolveSliceWalletDeployment({
    chainId: chainId ?? 8453,
    factoryVersion
  })
  const signer = initConfig.at(-1)
  if (
    initConfig.length !== 3 ||
    signer === undefined ||
    !isAddressEqual(
      signer.module,
      deployment.manifest.contracts.ecdsaSigner.address
    ) ||
    size(signer.moduleData) !== 52
  ) {
    throw new Error("Wallet recovery init config is not canonical.")
  }
  const recoverySignerAddress = getAddress(slice(signer.moduleData, 32, 52))
  const expected = await buildRecoveryPermissionInitConfig({
    chainId: chainId ?? 8453,
    factoryVersion: deployment.profile.id,
    recoverySignerAddress
  })
  const canonical = expected.initConfig.every((install, index) => {
    const received = initConfig[index]
    return (
      received !== undefined &&
      install.moduleType === received.moduleType &&
      isAddressEqual(install.module, received.module) &&
      install.moduleData.toLowerCase() === received.moduleData.toLowerCase() &&
      install.internalData.toLowerCase() === received.internalData.toLowerCase()
    )
  })
  if (!canonical) {
    throw new Error("Wallet recovery init config is not canonical.")
  }
  return { permissionId: expected.permissionId, recoverySignerAddress }
}
