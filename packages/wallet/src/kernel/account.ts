import {
  type Address,
  createNonceManager,
  getAddress,
  type Hex,
  type TypedDataDefinition
} from "viem"
import {
  getUserOperationHash,
  toSmartAccount,
  type UserOperation
} from "viem/account-abstraction"
import { getChainId } from "viem/actions"
import { getAction } from "viem/utils"
import type {
  SliceKernelAccount,
  SliceKernelClient,
  SliceKernelInstall,
  SliceKernelPermission,
  SliceKernelValidator
} from "../protocol/index"
import {
  encodeKernelEnableSignature,
  encodeKernelPermissionSignature,
  getKernelEntryPointNonce,
  getKernelFactoryArgs,
  getKernelPermissionInstallState,
  getKernelPermissionInstalls,
  getKernelPermissionNonceKey,
  getKernelRootNonceKey,
  kernelEntryPoint,
  kernelModuleType,
  predictKernelAddress
} from "../protocol/kernel"
import { compactKernelErc6492Signature } from "./erc6492Bootstrap"
import { decodeKernelCalls, encodeKernelCalls } from "./execution"
import {
  signKernelMessage,
  signKernelPermissionMessage,
  signKernelPermissionTypedData,
  signKernelTypedData
} from "./signatures"

const getEffectiveChainId = async (client: SliceKernelClient) =>
  client.chain?.id ?? getAction(client, getChainId, "getChainId")({})

const wrapPermissionSignature = async ({
  account,
  client,
  enableSignature,
  permission,
  preinstalled,
  signature
}: {
  account: Address
  client: SliceKernelClient
  enableSignature?: Hex
  permission: SliceKernelPermission
  preinstalled: boolean
  signature: Hex
}) => {
  if (preinstalled) return signature
  const state = await getKernelPermissionInstallState({
    account,
    client,
    permission
  })
  if (state.installed) return signature
  if (enableSignature === undefined) {
    throw new Error(
      "Kernel permission enable mode requires an enable signature."
    )
  }
  return encodeKernelEnableSignature({
    enableSignature,
    installNonce: state.installNonce,
    packages: getKernelPermissionInstalls(permission),
    userOperationSignature: signature
  })
}

export const createKernelV4Account = async ({
  address,
  client,
  enableSignature,
  entryPoint = kernelEntryPoint,
  erc6492BootstrapFactory,
  factory,
  getFactoryArgs: getFactoryArgsOverride,
  implementation,
  initialPackages = [],
  nonce = 0n,
  permission,
  permissionPreinstalled = false,
  rootValidator
}: {
  address?: Address
  client: SliceKernelClient
  enableSignature?: Hex
  entryPoint?: {
    abi: typeof kernelEntryPoint.abi
    address: Address
    version: typeof kernelEntryPoint.version
  }
  erc6492BootstrapFactory?: Address
  factory: Address
  getFactoryArgs?: () => Promise<{
    factory?: Address
    factoryData?: Hex
  }>
  implementation: Address
  initialPackages?: readonly SliceKernelInstall[]
  nonce?: bigint
  permission?: SliceKernelPermission
  permissionPreinstalled?: boolean
  rootValidator: SliceKernelValidator
}): Promise<SliceKernelAccount> => {
  const rootPackage = {
    internalData: "0x",
    module: rootValidator.address,
    moduleData: await rootValidator.getEnableData(),
    moduleType: kernelModuleType.validator
  } as const satisfies SliceKernelInstall
  const packages = [rootPackage, ...initialPackages]
  const accountAddress = getAddress(
    address ??
      predictKernelAddress({ factory, implementation, nonce, packages })
  )
  const chainId = await getEffectiveChainId(client)

  const account = await toSmartAccount({
    client,
    decodeCalls: async (data) => decodeKernelCalls(data),
    encodeCalls: async (calls) => encodeKernelCalls(calls),
    entryPoint,
    extend: {
      initialPackages: packages,
      ...(permission === undefined ? {} : { permission }),
      rootValidator
    },
    getAddress: async () => accountAddress,
    getFactoryArgs: async () =>
      getFactoryArgsOverride === undefined
        ? getKernelFactoryArgs({ factory, nonce, packages })
        : getFactoryArgsOverride(),
    getNonce: async ({ key } = {}) => {
      const nonceKey =
        key !== undefined && key !== 0n
          ? key
          : permission === undefined
            ? getKernelRootNonceKey()
            : getKernelPermissionNonceKey({
                enable:
                  !permissionPreinstalled &&
                  !(
                    await getKernelPermissionInstallState({
                      account: accountAddress,
                      client,
                      permission
                    })
                  ).installed,
                permissionId: permission.id
              })
      return getKernelEntryPointNonce({
        account: accountAddress,
        client,
        key: nonceKey
      })
    },
    getStubSignature: async () => {
      if (permission === undefined) return rootValidator.getStubSignature()
      const signature = encodeKernelPermissionSignature({
        policySignatures: permission.policies.map(() => "0x"),
        signerSignature: permission.signer.stubSignature
      })
      return wrapPermissionSignature({
        account: accountAddress,
        client,
        ...(enableSignature === undefined ? {} : { enableSignature }),
        permission,
        preinstalled: permissionPreinstalled,
        signature
      })
    },
    nonceKeyManager: createNonceManager({
      source: { get: () => 0, set: () => {} }
    }),
    sign: ({ hash }) =>
      permission === undefined
        ? signKernelMessage({
            account: accountAddress,
            chainId,
            message: { raw: hash },
            validator: rootValidator
          })
        : signKernelPermissionMessage({
            account: accountAddress,
            chainId,
            message: { raw: hash },
            permission
          }),
    signMessage: ({ message }) =>
      permission === undefined
        ? signKernelMessage({
            account: accountAddress,
            chainId,
            message,
            validator: rootValidator
          })
        : signKernelPermissionMessage({
            account: accountAddress,
            chainId,
            message,
            permission
          }),
    signTypedData: (source) =>
      permission === undefined
        ? signKernelTypedData({
            account: accountAddress,
            chainId,
            source: source as TypedDataDefinition,
            validator: rootValidator
          })
        : signKernelPermissionTypedData({
            account: accountAddress,
            chainId,
            permission,
            source: source as TypedDataDefinition
          }),
    signUserOperation: async (userOperation) => {
      const operationChainId = userOperation.chainId ?? chainId
      if (operationChainId !== chainId) {
        throw new Error(
          "Kernel operation chain does not match the wallet chain."
        )
      }
      const { chainId: _chainId, ...unsigned } = userOperation
      const operation = {
        ...unsigned,
        sender: unsigned.sender ?? accountAddress,
        signature: "0x"
      } as UserOperation<"0.9">
      const hash = getUserOperationHash({
        chainId,
        entryPointAddress: entryPoint.address,
        entryPointVersion: entryPoint.version,
        userOperation: operation
      })
      if (permission === undefined) {
        return rootValidator.signHash(hash, {
          purpose: "user_operation",
          userOperation: operation
        })
      }
      const signature = encodeKernelPermissionSignature({
        policySignatures: permission.policies.map(() => "0x"),
        signerSignature: await permission.signer.account.signMessage({
          message: { raw: hash }
        })
      })
      return wrapPermissionSignature({
        account: accountAddress,
        client,
        ...(enableSignature === undefined ? {} : { enableSignature }),
        permission,
        preinstalled: permissionPreinstalled,
        signature
      })
    }
  })

  if (erc6492BootstrapFactory === undefined) return account

  const compact = (signature: Hex) =>
    compactKernelErc6492Signature({
      bootstrapFactory: erc6492BootstrapFactory,
      factory,
      signature
    })
  const signMessage = account.signMessage.bind(account)
  const signTypedData = account.signTypedData.bind(
    account
  ) as typeof account.signTypedData
  account.signMessage = async (parameters) =>
    compact(await signMessage(parameters))
  account.signTypedData = async (parameters) =>
    compact(await signTypedData(parameters))
  if (account.sign !== undefined) {
    const sign = account.sign.bind(account)
    account.sign = async (parameters) => compact(await sign(parameters))
  }
  return account
}
