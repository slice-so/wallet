import { productsModuleAbi } from "@slicekit/abi"
import { getProductsModuleAddress } from "@slicekit/abi/deployments"
import {
  getWalletPermissionId,
  type SliceKernelClient,
  type SliceKernelPermission,
  sliceWalletKernelAddresses,
  toWalletPermissionPolicies
} from "@slicekit/wallet-primitives"
import {
  buildKernelInstallTypedData,
  encodeKernelEnableSignature,
  encodeKernelPermissionSignature,
  encodeKernelPermissionUninstallCalls,
  getKernelPermissionInstallState,
  getKernelPermissionInstalls,
  kernelDummyEcdsaSignature,
  resolveSliceWalletDeployment
} from "@slicekit/wallet-primitives/kernel"
import * as Base64 from "ox/Base64"
import {
  type Abi,
  type AbiFunction,
  type Address,
  concat,
  type Hex,
  keccak256,
  maxUint256,
  pad,
  toFunctionSelector,
  toHex,
  zeroAddress
} from "viem"
import type { UserOperation } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { createKernelV4Account } from "../../kernel/account"
import { createSliceWalletRootValidator } from "../../rootValidator"
import type { SliceAccountClientCall } from "../../types/accountClient"
import type {
  BuildSliceExecutionEnableTypedDataParameters,
  CreateSliceExecutionAccountParameters
} from "../../types/execution"
import {
  createSliceCheckoutPolicyDescriptor,
  createSliceStoreManagementPolicyDescriptor
} from "../commerce/policies"
import {
  buildWeightedEcdsaStubSignature,
  getWeightedEcdsaProposalTypedData,
  toWeightedEcdsaSigner
} from "./weightedSigner"

const getAbiFunctionSelector = ({
  abi,
  functionName
}: {
  abi: Abi
  functionName: string
}) => {
  const matches = abi.filter(
    (item): item is AbiFunction =>
      item.type === "function" && item.name === functionName
  )
  if (matches.length !== 1) {
    throw new Error(`Expected one ABI function named ${functionName}.`)
  }
  return toFunctionSelector(matches[0])
}

const buySelector = getAbiFunctionSelector({
  abi: productsModuleAbi,
  functionName: "buy"
})
const paySelector = getAbiFunctionSelector({
  abi: productsModuleAbi,
  functionName: "pay"
})

/** @deprecated Use createSliceCheckoutPolicyDescriptor for buyer-bound policies. */
export const createBuyerCheckoutCallPolicy = (chainId: number) => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  return {
    account: zeroAddress,
    calls: [
      {
        parameterRules: [],
        selector: buySelector,
        target: productsModuleAddress,
        valueLimit: maxUint256
      },
      {
        parameterRules: [],
        selector: paySelector,
        target: productsModuleAddress,
        valueLimit: maxUint256
      },
      {
        parameterRules: [
          {
            condition: "equal" as const,
            offset: 0,
            params: [pad(productsModuleAddress, { size: 32 })]
          }
        ],
        selector: toFunctionSelector("approve(address,uint256)"),
        target: zeroAddress,
        valueLimit: 0n
      }
    ],
    chainId,
    grantKind: "checkout" as const,
    validAfter: 0,
    validUntil: Number.MAX_SAFE_INTEGER,
    version: 1 as const
  }
}

const getClientChainId = (client: SliceKernelClient) => {
  const chainId = client.chain?.id
  if (chainId === undefined) {
    throw new Error("Kernel permission clients require an explicit chain.")
  }
  return chainId
}

const getRegisteredCredential = (
  credential: CreateSliceExecutionAccountParameters["credential"]
) => ({
  credentialIdHash: keccak256(toHex(Base64.toBytes(credential.id))),
  publicKey: credential.publicKey
})

const createExecutionPermission = (
  parameters: CreateSliceExecutionAccountParameters
): SliceKernelPermission => {
  const chainId = getClientChainId(parameters.client)
  const policy =
    parameters.mode === "checkout"
      ? createSliceCheckoutPolicyDescriptor({
          account: parameters.address,
          chainId,
          expiresAt: parameters.validUntil,
          startsAt: 0
        })
      : createSliceStoreManagementPolicyDescriptor({
          account: parameters.address,
          chainId,
          expiresAt: parameters.validUntil,
          startsAt: parameters.startsAt
        })
  const signer =
    parameters.mode === "checkout"
      ? toWeightedEcdsaSigner({
          coSignerAddress: parameters.coSignerAddress,
          ...(parameters.sessionPrivateKey === undefined
            ? {}
            : { sessionPrivateKey: parameters.sessionPrivateKey }),
          sessionSignerAddress: parameters.sessionSignerAddress
        })
      : {
          account:
            parameters.sessionPrivateKey === undefined
              ? toWeightedEcdsaSigner({
                  coSignerAddress: zeroAddress,
                  sessionSignerAddress: parameters.sessionSignerAddress,
                  signerContractAddress: sliceWalletKernelAddresses.ecdsaSigner
                }).account
              : privateKeyToAccount(parameters.sessionPrivateKey),
          address: sliceWalletKernelAddresses.ecdsaSigner,
          data: parameters.sessionSignerAddress,
          stubSignature: kernelDummyEcdsaSignature
        }
  return {
    id: getWalletPermissionId(policy, parameters.sessionSignerAddress),
    policies: toWalletPermissionPolicies(policy),
    signer
  }
}

export const createSliceExecutionAccount = async (
  parameters: CreateSliceExecutionAccountParameters
) => {
  const permission = createExecutionPermission(parameters)
  const chainId = getClientChainId(parameters.client)
  const deployment = resolveSliceWalletDeployment({
    chainId,
    factoryVersion: parameters.factoryVersion
  })
  const rootValidator = createSliceWalletRootValidator({
    chainId,
    credential: getRegisteredCredential(parameters.credential),
    factoryVersion: deployment.profile.id
  })
  const account = await createKernelV4Account({
    address: parameters.address,
    client: parameters.client,
    ...(parameters.enableSignature === undefined
      ? {}
      : { enableSignature: parameters.enableSignature }),
    entryPoint: deployment.entryPoint,
    ...(deployment.erc6492BootstrapFactory === undefined
      ? {}
      : {
          erc6492BootstrapFactory: deployment.erc6492BootstrapFactory
        }),
    factory: deployment.factory,
    ...(parameters.getFactoryArgs === undefined
      ? {}
      : { getFactoryArgs: parameters.getFactoryArgs }),
    implementation: deployment.implementation,
    nonce: parameters.accountIndex,
    permission,
    rootValidator
  })
  if (parameters.mode === "store_management") return account

  const wrapSignature = async (signerSignature: Hex) => {
    const signature = encodeKernelPermissionSignature({
      policySignatures: permission.policies.map(() => "0x"),
      signerSignature
    })
    const state = await getKernelPermissionInstallState({
      account: parameters.address,
      client: parameters.client,
      permission
    })
    if (state.installed) return signature
    if (parameters.enableSignature === undefined) {
      throw new Error(
        "Kernel permission enable mode requires an enable signature."
      )
    }
    return encodeKernelEnableSignature({
      enableSignature: parameters.enableSignature,
      installNonce: state.installNonce,
      packages: getKernelPermissionInstalls(permission),
      userOperationSignature: signature
    })
  }
  const signProposal = (
    operation: Pick<UserOperation<"0.9">, "callData" | "nonce" | "sender">
  ) => {
    if (parameters.sessionPrivateKey === undefined) {
      throw new Error("Buyer execution account is missing its session key.")
    }
    return privateKeyToAccount(parameters.sessionPrivateKey).signTypedData(
      getWeightedEcdsaProposalTypedData({
        account: operation.sender,
        callData: operation.callData,
        chainId: getClientChainId(parameters.client),
        nonce: operation.nonce,
        permissionId: permission.id
      })
    )
  }
  const signUserOperation: typeof account.signUserOperation = async (
    userOperation
  ) => {
    if (parameters.getCoSignature === undefined) {
      throw new Error(
        "Buyer execution account is missing its policy co-signer."
      )
    }
    const { chainId: _chainId, ...fields } = userOperation
    const operation = {
      ...fields,
      sender: fields.sender ?? parameters.address,
      signature: "0x"
    } as UserOperation<"0.9">
    const [proposalSignature, coSignature] = await Promise.all([
      signProposal(operation),
      parameters.getCoSignature({ userOperation: operation })
    ])
    return wrapSignature(concat([proposalSignature, coSignature]))
  }
  const getStubSignature: typeof account.getStubSignature = async (
    operation
  ) => {
    if (
      parameters.sessionPrivateKey === undefined ||
      operation?.callData === undefined ||
      operation.nonce === undefined
    ) {
      return wrapSignature(permission.signer.stubSignature)
    }
    return wrapSignature(
      buildWeightedEcdsaStubSignature(
        await signProposal({
          callData: operation.callData,
          nonce: operation.nonce,
          sender: operation.sender ?? parameters.address
        })
      )
    )
  }
  return { ...account, getStubSignature, signUserOperation }
}

export const buildSliceExecutionEnableTypedData = async (
  parameters: BuildSliceExecutionEnableTypedDataParameters
) => {
  const permission = createExecutionPermission(parameters)
  const { installNonce } = await getKernelPermissionInstallState({
    account: parameters.address,
    client: parameters.client,
    permission
  })
  return buildKernelInstallTypedData({
    account: parameters.address,
    chainId: getClientChainId(parameters.client),
    nonce: installNonce,
    packages: getKernelPermissionInstalls(permission)
  })
}

export const buildStoreManagementPermissionUninstallCalls = async ({
  account,
  client,
  sessionSignerAddress,
  startsAt,
  validUntil
}: {
  account: Address
  client: SliceKernelClient
  sessionSignerAddress: Address
  startsAt: number
  validUntil: number
}): Promise<{ calls: SliceAccountClientCall[]; permissionId: Hex }> => {
  const permission = createExecutionPermission({
    accountIndex: 0n,
    address: account,
    client,
    credential: { id: "", publicKey: `0x04${"00".repeat(64)}` },
    mode: "store_management",
    sessionSignerAddress,
    startsAt,
    validUntil
  })
  const { installed } = await getKernelPermissionInstallState({
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
