import { PolicyFlags, toPermissionValidator } from "@zerodev/permissions"
import {
  constants,
  createKernelAccount,
  type KernelSmartAccountImplementation
} from "@zerodev/sdk"
import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  isAddress,
  isHex,
  pad,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress
} from "viem"
import type { UserOperation } from "viem/account-abstraction"
import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletKernelVersion
} from "./constants"
import {
  toSliceWalletWebAuthnSessionSigner,
  toWeightedP256Signer
} from "./permissionSigners"
import { getWalletPermissionId, toWalletPermissionPolicies } from "./policy"
import { createSliceWalletRootValidator } from "./rootValidator"
import type {
  SliceWalletFrameSession,
  SliceWalletFrameSessionKey,
  SliceWalletUnsignedUserOperation
} from "./types/frame"
import type {
  BuildSliceWalletPermissionEnableTypedDataParameters,
  CreateSliceWalletPermissionAccountParameters
} from "./types/permission"

const kernelExecuteSelector = toFunctionSelector({
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

const encodePermissionEnableSignature = ({
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
          kernelExecuteSelector,
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

const assertSessionMode = (
  session: SliceWalletFrameSession,
  mode: "checkout" | "generic" | "management"
) => {
  if (session.grantKind !== mode) {
    throw new Error("Wallet session kind does not match the permission mode.")
  }
  if (mode === "checkout" && session.checkout === undefined) {
    throw new Error("Checkout wallet session is missing co-signer metadata.")
  }
}

const createPermissionValidator = async ({
  client,
  mode,
  session
}: Pick<
  CreateSliceWalletPermissionAccountParameters,
  "client" | "mode" | "session"
>) => {
  assertSessionMode(session, mode)
  const signer =
    mode === "checkout"
      ? toWeightedP256Signer({
          coSignerAddress: session.checkout?.coSignerAddress ?? zeroAddress,
          publicKey: session.publicKey,
          signerId: session.signerId
        })
      : toSliceWalletWebAuthnSessionSigner({
          publicKey: session.publicKey,
          signerId: session.signerId
        })

  return toPermissionValidator(client, {
    entryPoint: sliceWalletEntryPoint,
    flag: PolicyFlags.NOT_FOR_VALIDATE_SIG,
    kernelVersion: sliceWalletKernelVersion,
    permissionId: getWalletPermissionId(session.policy, session.signerId),
    policies: [...toWalletPermissionPolicies(session.policy)],
    signer
  })
}

const createPermissionKernelAccount = async ({
  address,
  client,
  credential,
  enableSignature,
  mode,
  rootSigner,
  session
}: Pick<
  CreateSliceWalletPermissionAccountParameters,
  | "address"
  | "client"
  | "credential"
  | "enableSignature"
  | "mode"
  | "rootSigner"
  | "session"
>) => {
  const [rootValidator, permissionValidator] = await Promise.all([
    createSliceWalletRootValidator({
      chainId: session.chainId,
      credential,
      ...(rootSigner === undefined ? {} : { rootSigner })
    }),
    createPermissionValidator({ client, mode, session })
  ])
  const account = await createKernelAccount(client, {
    address,
    accountImplementationAddress: sliceWalletKernelAddresses.implementation,
    entryPoint: sliceWalletEntryPoint,
    factoryAddress: sliceWalletKernelAddresses.factory,
    index: 0n,
    kernelVersion: sliceWalletKernelVersion,
    metaFactoryAddress: sliceWalletKernelAddresses.metaFactory,
    plugins: {
      ...(enableSignature === undefined
        ? {}
        : { pluginEnableSignature: enableSignature }),
      regular: permissionValidator,
      sudo: rootValidator
    },
    useMetaFactory: true
  })
  return { account, permissionValidator }
}

const toUnsignedUserOperation = (
  userOperation: UserOperation<"0.7">,
  sender: Address
): SliceWalletUnsignedUserOperation => ({
  callData: userOperation.callData,
  callGasLimit: userOperation.callGasLimit,
  ...(typeof userOperation.factory === "string" &&
  isAddress(userOperation.factory)
    ? { factory: userOperation.factory }
    : {}),
  ...(userOperation.factoryData === undefined
    ? {}
    : { factoryData: userOperation.factoryData }),
  maxFeePerGas: userOperation.maxFeePerGas,
  maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
  nonce: userOperation.nonce,
  ...(typeof userOperation.paymaster === "string" &&
  isAddress(userOperation.paymaster)
    ? { paymaster: userOperation.paymaster }
    : {}),
  ...(userOperation.paymasterData === undefined
    ? {}
    : { paymasterData: userOperation.paymasterData }),
  ...(userOperation.paymasterPostOpGasLimit === undefined
    ? {}
    : { paymasterPostOpGasLimit: userOperation.paymasterPostOpGasLimit }),
  ...(userOperation.paymasterVerificationGasLimit === undefined
    ? {}
    : {
        paymasterVerificationGasLimit:
          userOperation.paymasterVerificationGasLimit
      }),
  preVerificationGas: userOperation.preVerificationGas,
  sender,
  verificationGasLimit: userOperation.verificationGasLimit
})

const getFrameSignatureResult = (
  result: Awaited<
    ReturnType<
      CreateSliceWalletPermissionAccountParameters["frameClient"]["request"]
    >
  >
) => {
  if (
    typeof result !== "object" ||
    result === null ||
    !("signature" in result) ||
    !("proposalHash" in result) ||
    !isHex(result.signature) ||
    !isHex(result.proposalHash)
  ) {
    throw new Error("Slice wallet signer returned an invalid signature result.")
  }
  return result
}

export const createSliceWalletPermissionAccount = async (
  parameters: CreateSliceWalletPermissionAccountParameters
) => {
  const {
    address,
    enableSignature,
    frameClient,
    getFactoryArgs,
    mode,
    session
  } = parameters
  // The frame protocol deliberately rejects the rest of the session metadata.
  const frameSessionKey = {
    account: session.account,
    chainId: session.chainId,
    grantKind: session.grantKind
  } satisfies SliceWalletFrameSessionKey
  const { account, permissionValidator } =
    await createPermissionKernelAccount(parameters)

  const wrapEnableSignature = async (signature: Hex) => {
    if (await permissionValidator.isEnabled(address, kernelExecuteSelector)) {
      return signature
    }
    if (enableSignature === undefined) return signature
    return encodePermissionEnableSignature({
      enableData: await permissionValidator.getEnableData(address),
      enableSignature,
      userOperationSignature: signature
    })
  }

  const getStubSignature: typeof account.getStubSignature = async (
    userOperation
  ) => {
    if (userOperation === undefined) {
      return account.getStubSignature(userOperation)
    }
    if (
      mode !== "checkout" ||
      userOperation.callData === undefined ||
      userOperation.nonce === undefined
    ) {
      return account.getStubSignature(userOperation)
    }
    const result = getFrameSignatureResult(
      await frameClient.request({
        method: "signCheckoutProposal",
        params: {
          callData: userOperation.callData,
          nonce: userOperation.nonce,
          sender: userOperation.sender ?? address,
          session: frameSessionKey
        }
      })
    )
    return wrapEnableSignature(
      concat(["0xff", result.signature, constants.DUMMY_ECDSA_SIG])
    )
  }

  const signUserOperation: typeof account.signUserOperation = async (
    userOperation
  ) => {
    const { chainId: _chainId, ...operation } = userOperation
    const unsigned = toUnsignedUserOperation(
      {
        ...operation,
        sender: operation.sender ?? address,
        signature: "0x"
      },
      operation.sender ?? address
    )
    if (mode !== "checkout") {
      const result = getFrameSignatureResult(
        await frameClient.request({
          method: "signScopedUserOperation",
          params: { session: frameSessionKey, userOperation: unsigned }
        })
      )
      return wrapEnableSignature(concat(["0xff", result.signature]))
    }

    const challenge = await parameters.checkoutCoSigner.createChallenge(
      parameters.delegationId
    )
    const result = getFrameSignatureResult(
      await frameClient.request({
        method: "signCoSignRequest",
        params: {
          ...challenge,
          delegationId: parameters.delegationId,
          session: frameSessionKey,
          userOperation: unsigned
        }
      })
    )
    if (!("proofSignature" in result) || !("userOperationHash" in result)) {
      throw new Error(
        "Slice wallet signer returned an incomplete co-sign proof."
      )
    }
    const coSigned = await parameters.checkoutCoSigner.coSign({
      ...challenge,
      delegationId: parameters.delegationId,
      proofSignature: result.proofSignature,
      userOperation: unsigned
    })
    if (
      coSigned.proposalHash.toLowerCase() !==
        result.proposalHash.toLowerCase() ||
      coSigned.userOperationHash.toLowerCase() !==
        result.userOperationHash.toLowerCase()
    ) {
      throw new Error(
        "Slice co-signer response does not match the signed operation."
      )
    }
    return wrapEnableSignature(
      concat(["0xff", result.signature, coSigned.coSignature])
    )
  }

  return {
    ...account,
    getStubSignature,
    signUserOperation,
    ...(getFactoryArgs === undefined ? {} : { getFactoryArgs })
  }
}

export const buildSliceWalletPermissionEnableTypedData = async (
  parameters: BuildSliceWalletPermissionEnableTypedDataParameters
) => {
  const mode = parameters.session.grantKind
  const { account } = await createPermissionKernelAccount({
    ...parameters,
    mode
  })
  return account.kernelPluginManager.getPluginsEnableTypedData(
    parameters.address
  )
}

export const buildSliceWalletPermissionUninstallCalls = async ({
  account,
  client,
  session
}: {
  account: Address
  client: KernelSmartAccountImplementation["client"]
  session: SliceWalletFrameSession
}) => {
  const validator = await createPermissionValidator({
    client,
    mode: session.grantKind,
    session
  })
  const permissionId = validator.getIdentifier()
  if (!(await validator.isEnabled(account, kernelExecuteSelector))) {
    return { calls: [], permissionId }
  }
  const validationId = toExecutionValidationId(permissionId)
  const validationData = await validator.getEnableData(account)
  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: kernelPermissionLifecycleAbi,
          args: [validationId, kernelExecuteSelector, false],
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
