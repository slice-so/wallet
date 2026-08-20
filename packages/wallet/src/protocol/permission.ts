import {
  type Address,
  bytesToBigInt,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  isAddressEqual,
  keccak256
} from "viem"
import { kernelAccountAbi } from "./kernel/abi"
import { resolveSliceWalletDeployment } from "./kernel/deploymentProfiles"
import {
  encodeKernelInstallPackagesCall,
  encodeKernelPermissionUninstallCalls,
  getKernelPermissionInstalls
} from "./kernel/permission"
import { getKernelPermissionInstallState } from "./kernel/permissionState"
import { buildKernelInstallTypedData } from "./kernel/typedData"
import { getWalletPermissionId, toWalletPermissionPolicies } from "./policy"
import type { SliceWalletFrameSession } from "./types/frame"
import type { SliceKernelPermissionData } from "./types/kernel"
import type { BuildSliceWalletPermissionEnableTypedDataParameters } from "./types/permission"

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

const createPermissionData = (
  session: SliceWalletFrameSession
): SliceKernelPermissionData => {
  const deployment = resolveSliceWalletDeployment({ chainId: session.chainId })
  const { x, y } = getP256Coordinates(session.publicKey)
  const checkout =
    session.grantKind === "checkout" ? session.checkout : undefined
  if (session.grantKind === "checkout" && checkout === undefined) {
    throw new Error("Checkout wallet session is missing co-signer metadata.")
  }
  const signer =
    checkout !== undefined
      ? {
          address: deployment.manifest.contracts.weightedP256Signer.address,
          data: encodeAbiParameters(
            [
              { name: "x", type: "uint256" },
              { name: "y", type: "uint256" },
              { name: "coSigner", type: "address" }
            ],
            [x, y, checkout.coSignerAddress]
          )
        }
      : {
          address: deployment.manifest.contracts.webAuthnSigner.address,
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
  return {
    id: getWalletPermissionId(session.policy, session.signerId),
    policies: toWalletPermissionPolicies(session.policy),
    signer
  }
}

export const buildSliceWalletPermissionEnableTypedData = async ({
  address,
  client,
  enableNonce,
  session
}: BuildSliceWalletPermissionEnableTypedDataParameters) => {
  const permission = createPermissionData(session)
  const installNonce =
    enableNonce ??
    (
      await getKernelPermissionInstallState({
        account: address,
        client,
        permission
      })
    ).installNonce
  return buildKernelInstallTypedData({
    account: address,
    chainId: session.chainId,
    nonce: installNonce,
    packages: getKernelPermissionInstalls(permission)
  })
}

export const buildSliceWalletPermissionUninstallCalls = async ({
  account,
  client,
  session
}: {
  account: Address
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  session: SliceWalletFrameSession
}) => {
  const permission = createPermissionData(session)
  const state = await getKernelPermissionInstallState({
    account,
    client,
    permission
  })
  return {
    calls: state.installed
      ? encodeKernelPermissionUninstallCalls(account, permission)
      : [],
    permissionId: permission.id
  }
}

const buildInstallNonceCheckpoint = ({
  account,
  installNonce
}: {
  account: Address
  installNonce: bigint
}) => ({
  data: encodeFunctionData({
    abi: kernelAccountAbi,
    args: [0n, installNonce + 1n],
    functionName: "setNonce"
  }),
  to: account,
  value: 0n
})

export const buildSliceWalletPermissionRevocationCalls = async ({
  account,
  blockNumber,
  client,
  enableNonce,
  session
}: {
  account: Address
  blockNumber?: bigint
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  enableNonce: bigint
  session: SliceWalletFrameSession
}) => {
  const permission = createPermissionData(session)
  const state = await getKernelPermissionInstallState({
    account,
    ...(blockNumber === undefined ? {} : { blockNumber }),
    client,
    permission
  })
  const checkpoint = buildInstallNonceCheckpoint({
    account,
    installNonce: state.installNonce
  })
  const uninstall = encodeKernelPermissionUninstallCalls(account, permission)
  const alternatives = {
    burn: [checkpoint],
    checkpoint: [checkpoint],
    uninstall
  } as const
  if (!state.installed && state.installNonce < enableNonce) {
    throw new Error(
      "Kernel permission enable nonce is ahead of the account install nonce."
    )
  }
  const revoked = !state.installed && state.installNonce > enableNonce
  return {
    alternatives,
    calls: revoked ? [] : state.installed ? uninstall : [checkpoint],
    permissionId: permission.id,
    revoked
  }
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
      alternatives.uninstall,
      alternatives.checkpoint,
      alternatives.burn
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

export const buildSliceWalletPermissionInstallCalls = async ({
  account,
  client,
  session
}: {
  account: Address
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  session: SliceWalletFrameSession
}) => {
  const permission = createPermissionData(session)
  const state = await getKernelPermissionInstallState({
    account,
    client,
    permission
  })
  return {
    calls: state.installed
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
