import { bytesToBigInt, encodeAbiParameters, hexToBytes } from "viem"
import { assertSliceWalletAccountIndex } from "./accountIndex"
import { kernelModuleType } from "./kernel/constants"
import { resolveSliceWalletDeployment } from "./kernel/deploymentProfiles"
import {
  getKernelProxyInitCodeHash,
  predictKernelAddress
} from "./kernel/factory"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import type { SliceWalletRegisteredRootCredential } from "./types/account"
import type { SliceKernelInstall } from "./types/kernel"
import type { PredictSliceWalletKernelAccountAddressParameters } from "./types/recovery"

export const encodeSliceWalletRootValidatorData = (
  credential: SliceWalletRegisteredRootCredential
) => {
  const bytes = hexToBytes(credential.publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Expected an uncompressed P-256 root public key.")
  }
  if (hexToBytes(credential.credentialIdHash).length !== 32) {
    throw new Error("Root credential id hash must be 32 bytes.")
  }
  return encodeAbiParameters(
    [
      {
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" }
        ],
        name: "webAuthnData",
        type: "tuple"
      },
      { name: "authenticatorIdHash", type: "bytes32" }
    ],
    [
      {
        x: bytesToBigInt(bytes.slice(1, 33)),
        y: bytesToBigInt(bytes.slice(33, 65))
      },
      credential.credentialIdHash
    ]
  )
}

export const sliceWalletKernelProxyInitCodeHash = getKernelProxyInitCodeHash(
  resolveSliceWalletDeployment({ chainId: 8453 }).implementation
)

const getRootInstall = (
  credential: SliceWalletRegisteredRootCredential,
  rootValidator: `0x${string}`
): SliceKernelInstall => ({
  internalData: "0x",
  module: rootValidator,
  moduleData: encodeSliceWalletRootValidatorData(credential),
  moduleType: kernelModuleType.validator
})

export const predictSliceWalletKernelAccountAddressFromInitConfig = ({
  chainId,
  credential,
  factoryVersion,
  index = 0n,
  initConfig = []
}: {
  chainId: number
  credential: SliceWalletRegisteredRootCredential
  factoryVersion?: string
  index?: bigint
  initConfig?: readonly SliceKernelInstall[]
}) => {
  assertSliceWalletAccountIndex(Number(index))
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  return predictKernelAddress({
    factory: deployment.factory,
    implementation: deployment.implementation,
    nonce: index,
    packages: [
      getRootInstall(credential, deployment.rootValidator),
      ...initConfig
    ]
  })
}

export const deriveSliceWalletRecoveryBootstrap = async ({
  chainId,
  credential,
  factoryVersion,
  index = 0n,
  recoverySignerAddress
}: PredictSliceWalletKernelAccountAddressParameters) => {
  assertSliceWalletAccountIndex(Number(index))
  const recovery = await buildRecoveryPermissionInitConfig({
    chainId,
    factoryVersion,
    recoverySignerAddress
  })
  return {
    account: predictSliceWalletKernelAccountAddressFromInitConfig({
      chainId,
      credential,
      factoryVersion,
      index,
      initConfig: recovery.initConfig
    }),
    permissionId: recovery.permissionId
  }
}

export const predictSliceWalletKernelAccountAddress = async (
  parameters: PredictSliceWalletKernelAccountAddressParameters
) => (await deriveSliceWalletRecoveryBootstrap(parameters)).account
