import { getProductsModuleAddress } from "../generated/commerceFacts"
import { productsModuleAbi } from "@slicekit/abi"
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"
import { PolicyFlags, toPermissionValidator } from "@zerodev/permissions"
import {
  CallPolicyVersion,
  ParamCondition,
  toCallPolicy,
  toTimestampPolicy
} from "@zerodev/permissions/policies"
import { toECDSASigner, toEmptyECDSASigner } from "@zerodev/permissions/signers"
import {
  addressToEmptyAccount,
  createKernelAccount,
  type KernelSmartAccountImplementation
} from "@zerodev/sdk"
import { Base64, PublicKey } from "ox"
import {
  type Abi,
  type AbiFunction,
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  maxUint256,
  pad,
  parseAbiParameters,
  toFunctionSelector,
  toHex,
  zeroAddress
} from "viem"
import type { WebAuthnAccount } from "viem/account-abstraction"
import {
  entryPoint07Address,
  type UserOperation
} from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import type { SliceAccountClientCall } from "../../types/accountClient"
import {
  sliceKernelBaseV33Addresses,
  sliceKernelWebAuthnValidatorAddress
} from "../utils/sliceAccountClient"
import type { SliceKernelPasskeyCredential } from "./account"
import { createStoreManagementCallPolicy } from "./management"
import {
  buildWeightedEcdsaStubSignature,
  getWeightedEcdsaProposalTypedData,
  toWeightedEcdsaSigner
} from "./weightedSigner"

/**
 * Buyer execution session key: a browser-held secp256k1 key enabled on the
 * buyer's Kernel account through a ZeroDev permission validator whose call
 * policy is limited to checkout — ProductsModule buy/pay plus ERC-20 approve
 * with the ProductsModule as spender. A stolen key can only buy Slice
 * products; it can never transfer funds out.
 *
 * The account address stays pinned to the permissionless-derived one; the
 * ZeroDev client here is only the enable/signing engine.
 */

const buyerEntryPoint = {
  address: entryPoint07Address,
  version: "0.7"
} as const

const buyerKernelVersion = "0.3.3" as const

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
const kernelV3ExecuteSelector = toFunctionSelector({
  inputs: [
    { name: "mode", type: "bytes32" },
    { name: "executionCalldata", type: "bytes" }
  ],
  name: "execute",
  outputs: [],
  stateMutability: "payable",
  type: "function"
})
const permissionValidatorType = "0x02" satisfies Hex
const kernelPermissionLifecycleAbi = [
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

const toExecutionValidationId = (permissionId: Hex) =>
  pad(concat([permissionValidatorType, permissionId]), {
    dir: "right",
    size: 21
  })

const encodeBuyerExecutionEnableUserOperationSignature = ({
  enableData,
  enableSignature,
  userOperationSignature
}: {
  enableData: Hex
  enableSignature: Hex
  userOperationSignature: Hex
}) =>
  concat([
    zeroAddress,
    encodeAbiParameters(
      parseAbiParameters(
        "bytes validatorData, bytes hookData, bytes selectorData, bytes enableSig, bytes userOpSig"
      ),
      [
        enableData,
        "0x",
        concat([
          kernelV3ExecuteSelector,
          zeroAddress,
          zeroAddress,
          encodeAbiParameters(
            parseAbiParameters("bytes selectorInitData, bytes hookInitData"),
            ["0xFF", "0x0000"]
          )
        ]),
        enableSignature,
        userOperationSignature
      ]
    )
  ])

export const createBuyerCheckoutCallPolicy = (chainId: number) => {
  const productsModuleAddress = getProductsModuleAddress(chainId)
  return toCallPolicy({
    permissions: [
      {
        selector: buySelector,
        target: productsModuleAddress,
        valueLimit: maxUint256
      },
      {
        selector: paySelector,
        target: productsModuleAddress,
        valueLimit: maxUint256
      },
      {
        // Wildcard target: any ERC-20, but only approvals whose spender is
        // the ProductsModule — approvals to any other address are rejected.
        abi: erc20Abi,
        args: [
          { condition: ParamCondition.EQUAL, value: productsModuleAddress },
          null
        ],
        functionName: "approve",
        target: zeroAddress
      }
    ],
    policyVersion: CallPolicyVersion.V0_0_5
  })
}

const getClientChainId = (
  client: KernelSmartAccountImplementation["client"]
) => {
  const chainId = client.chain?.id
  if (chainId === undefined) {
    throw new Error("Kernel permission clients require an explicit chain.")
  }
  return chainId
}

/**
 * Enable data for the onchain WebAuthn root validator — must byte-match the
 * encoding permissionless used at account creation ({x, y} public key plus
 * keccak256 of the base64url credential id).
 */
export const encodeWebAuthnRootValidatorData = (
  credential: SliceKernelPasskeyCredential
) => {
  const publicKey = PublicKey.fromHex(credential.publicKey)
  const authenticatorIdHash = keccak256(toHex(Base64.toBytes(credential.id)))

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
    [{ x: publicKey.x, y: publicKey.y }, authenticatorIdHash]
  )
}

/**
 * WebAuthn validator signature envelope. The enable digest must be signed in
 * the root validator's raw format (no ERC-7739 nesting): a WebAuthn assertion
 * over the typed-data hash, encoded for the onchain verifier.
 */
export const encodeWebAuthnValidatorSignature = ({
  signature,
  webauthn
}: Pick<
  Awaited<ReturnType<WebAuthnAccount["sign"]>>,
  "signature" | "webauthn"
>) => {
  const { r, s } = parseWebAuthnSignature(signature)

  return encodeAbiParameters(
    [
      { name: "authenticatorData", type: "bytes" },
      { name: "clientDataJSON", type: "string" },
      { name: "responseTypeLocation", type: "uint256" },
      { name: "r", type: "uint256" },
      { name: "s", type: "uint256" },
      { name: "usePrecompiled", type: "bool" }
    ],
    [
      webauthn.authenticatorData,
      webauthn.clientDataJSON,
      BigInt(webauthn.typeIndex ?? 0),
      r,
      s,
      false
    ]
  )
}

const parseWebAuthnSignature = (signature: Hex) => {
  const bytes = signature.slice(2)
  if (bytes.length < 128) {
    throw new Error("Invalid WebAuthn signature length.")
  }

  return {
    r: BigInt(`0x${bytes.slice(0, 64)}`),
    s: BigInt(`0x${bytes.slice(64, 128)}`)
  }
}

const createBuyerRootValidator = async ({
  client,
  credential
}: {
  client: KernelSmartAccountImplementation["client"]
  credential: SliceKernelPasskeyCredential
}) => {
  // The sudo validator only supplies identity and enable data here; the
  // enable signature itself is produced externally by the passkey (mirrors
  // the store wallet, where the merchant wallet signs externally).
  const emptySignerValidator = await signerToEcdsaValidator(client, {
    entryPoint: buyerEntryPoint,
    kernelVersion: buyerKernelVersion,
    signer: addressToEmptyAccount(sliceKernelWebAuthnValidatorAddress)
  })

  return {
    ...emptySignerValidator,
    address: sliceKernelWebAuthnValidatorAddress,
    getEnableData: async () => encodeWebAuthnRootValidatorData(credential),
    getIdentifier: () => sliceKernelWebAuthnValidatorAddress,
    source: "WebAuthnValidator"
  }
}

const createBuyerExecutionValidator = async ({
  client,
  coSignerAddress,
  sessionPrivateKey,
  sessionSignerAddress,
  validUntil
}: {
  client: KernelSmartAccountImplementation["client"]
  coSignerAddress: Address
  sessionPrivateKey?: Hex
  sessionSignerAddress: Address
  validUntil: number
}) => {
  const signer = toWeightedEcdsaSigner({
    coSignerAddress,
    sessionPrivateKey,
    sessionSignerAddress
  })

  return toPermissionValidator(client, {
    entryPoint: buyerEntryPoint,
    flag: PolicyFlags.NOT_FOR_VALIDATE_SIG,
    kernelVersion: buyerKernelVersion,
    policies: [
      createBuyerCheckoutCallPolicy(getClientChainId(client)),
      toTimestampPolicy({ validUntil })
    ],
    signer
  })
}

const createStoreManagementExecutionValidator = async ({
  client,
  sessionPrivateKey,
  sessionSignerAddress,
  validUntil
}: {
  client: KernelSmartAccountImplementation["client"]
  sessionPrivateKey?: Hex
  sessionSignerAddress: Address
  validUntil: number
}) => {
  const signer =
    sessionPrivateKey === undefined
      ? toEmptyECDSASigner(sessionSignerAddress)
      : await toECDSASigner({ signer: privateKeyToAccount(sessionPrivateKey) })

  return toPermissionValidator(client, {
    entryPoint: buyerEntryPoint,
    flag: PolicyFlags.NOT_FOR_VALIDATE_SIG,
    kernelVersion: buyerKernelVersion,
    policies: [
      createStoreManagementCallPolicy(getClientChainId(client)),
      toTimestampPolicy({ validUntil })
    ],
    signer
  })
}

export type SliceExecutionUserOperation = UserOperation<"0.7">

type SliceExecutionAccountCommonParameters = {
  /** The pinned permissionless-derived account address. */
  address: Address
  accountIndex: bigint
  client: KernelSmartAccountImplementation["client"]
  credential: SliceKernelPasskeyCredential
  enableSignature?: Hex
  /**
   * Factory args from the permissionless account — required so an
   * undeployed account deploys with the exact initcode that derived its
   * address, never the ZeroDev-derived one.
   */
  getFactoryArgs?: () => Promise<{
    factory?: Address | undefined
    factoryData?: Hex | undefined
  }>
  sessionPrivateKey?: Hex
  sessionSignerAddress: Address
  /** Unix seconds; mirrors the delegation row expiry. */
  validUntil: number
}

export type CreateSliceExecutionAccountParameters =
  SliceExecutionAccountCommonParameters &
    (
      | {
          coSignerAddress: Address
          getCoSignature?: (args: {
            userOperation: SliceExecutionUserOperation
          }) => Promise<Hex>
          mode: "checkout"
        }
      | {
          mode: "store_management"
        }
    )

export const createSliceExecutionAccount = async (
  parameters: CreateSliceExecutionAccountParameters
) => {
  const {
    address,
    accountIndex,
    client,
    credential,
    enableSignature,
    getFactoryArgs,
    sessionPrivateKey,
    sessionSignerAddress,
    validUntil
  } = parameters
  const [rootValidator, executionValidator] = await Promise.all([
    createBuyerRootValidator({ client, credential }),
    parameters.mode === "checkout"
      ? createBuyerExecutionValidator({
          client,
          coSignerAddress: parameters.coSignerAddress,
          sessionPrivateKey,
          sessionSignerAddress,
          validUntil
        })
      : createStoreManagementExecutionValidator({
          client,
          sessionPrivateKey,
          sessionSignerAddress,
          validUntil
        })
  ])

  const account = await createKernelAccount(client, {
    address,
    accountImplementationAddress: sliceKernelBaseV33Addresses.implementation,
    entryPoint: buyerEntryPoint,
    factoryAddress: sliceKernelBaseV33Addresses.factory,
    index: accountIndex,
    kernelVersion: buyerKernelVersion,
    metaFactoryAddress: sliceKernelBaseV33Addresses.metaFactory,
    plugins: {
      ...(enableSignature === undefined
        ? {}
        : { pluginEnableSignature: enableSignature }),
      regular: executionValidator,
      sudo: rootValidator
    },
    useMetaFactory: true
  })

  if (parameters.mode === "store_management") {
    return {
      ...account,
      ...(getFactoryArgs === undefined ? {} : { getFactoryArgs })
    }
  }

  const signProposal = async ({
    sessionKey,
    userOperation
  }: {
    sessionKey: Hex
    userOperation: Pick<
      SliceExecutionUserOperation,
      "callData" | "nonce" | "sender"
    >
  }) =>
    privateKeyToAccount(sessionKey).signTypedData(
      getWeightedEcdsaProposalTypedData({
        account: userOperation.sender,
        callData: userOperation.callData,
        chainId: getClientChainId(client),
        nonce: userOperation.nonce,
        permissionId: executionValidator.getIdentifier()
      })
    )

  const wrapWithEnableEnvelope = async (signature: Hex) => {
    // This must be the exact permission id, not the broad Kernel action
    // check: rotating the browser execution key creates a new weighted-signer
    // config under a new permission.
    const isEnabled = await executionValidator.isEnabled(
      address,
      kernelV3ExecuteSelector
    )
    if (isEnabled) return signature
    if (enableSignature === undefined) return signature

    return encodeBuyerExecutionEnableUserOperationSignature({
      enableData: await executionValidator.getEnableData(address),
      enableSignature,
      userOperationSignature: signature
    })
  }

  const signUserOperation: typeof account.signUserOperation = async (
    userOperation
  ) => {
    if (parameters.getCoSignature === undefined) {
      throw new Error(
        "Buyer execution account is missing its policy co-signer."
      )
    }
    if (sessionPrivateKey === undefined) {
      throw new Error("Buyer execution account is missing its session key.")
    }

    const { chainId: _chainId, ...userOperationFields } = userOperation
    const unsignedUserOperation = {
      ...userOperationFields,
      sender: userOperation.sender ?? address,
      signature: "0x"
    } satisfies SliceExecutionUserOperation
    const proposalSignature = await signProposal({
      sessionKey: sessionPrivateKey,
      userOperation: unsignedUserOperation
    })
    const coSignature = await parameters.getCoSignature({
      userOperation: unsignedUserOperation
    })

    return wrapWithEnableEnvelope(
      concat(["0xff", proposalSignature, coSignature])
    )
  }

  const getStubSignature: typeof account.getStubSignature = async (
    userOperation
  ) => {
    // The default all-dummy stub recovers a zero-weight proposal signer and
    // the weighted signer reverts (ZeroWeightSigner → AA23), which aborts
    // eth_estimateUserOperationGas. The proposal digest excludes gas fields,
    // so the session key can sign the real digest before gas is known; the
    // dummy co-signature in the last slot then soft-fails, which bundlers
    // accept during estimation.
    if (
      sessionPrivateKey === undefined ||
      userOperation?.callData === undefined ||
      userOperation.nonce === undefined
    ) {
      return account.getStubSignature(userOperation)
    }

    const proposalSignature = await signProposal({
      sessionKey: sessionPrivateKey,
      userOperation: {
        callData: userOperation.callData,
        nonce: userOperation.nonce,
        sender: userOperation.sender ?? address
      }
    })

    return wrapWithEnableEnvelope(
      concat(["0xff", buildWeightedEcdsaStubSignature(proposalSignature)])
    )
  }

  return {
    ...account,
    getStubSignature,
    signUserOperation,
    ...(getFactoryArgs === undefined ? {} : { getFactoryArgs })
  }
}

export type BuildSliceExecutionEnableTypedDataParameters =
  CreateSliceExecutionAccountParameters extends infer Parameters
    ? Parameters extends CreateSliceExecutionAccountParameters
      ? Omit<
          Parameters,
          "enableSignature" | "getFactoryArgs" | "sessionPrivateKey"
        >
      : never
    : never

export const buildSliceExecutionEnableTypedData = async (
  parameters: BuildSliceExecutionEnableTypedDataParameters
) => {
  const account = await createSliceExecutionAccount(parameters)
  return account.kernelPluginManager.getPluginsEnableTypedData(
    parameters.address
  )
}

export const buildStoreManagementPermissionUninstallCalls = async ({
  account,
  client,
  sessionSignerAddress,
  validUntil
}: {
  account: Address
  client: KernelSmartAccountImplementation["client"]
  sessionSignerAddress: Address
  validUntil: number
}): Promise<{ calls: SliceAccountClientCall[]; permissionId: Hex }> => {
  const validator = await createStoreManagementExecutionValidator({
    client,
    sessionSignerAddress,
    validUntil
  })
  const permissionId = validator.getIdentifier()
  const isEnabled = await validator.isEnabled(account, kernelV3ExecuteSelector)
  if (!isEnabled) return { calls: [], permissionId }

  const validationId = toExecutionValidationId(permissionId)
  const validationData = await validator.getEnableData(account)
  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: kernelPermissionLifecycleAbi,
          args: [validationId, kernelV3ExecuteSelector, false],
          functionName: "grantAccess"
        }),
        to: account,
        value: 0n
      },
      {
        data: encodeFunctionData({
          abi: kernelPermissionLifecycleAbi,
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
