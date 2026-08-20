import {
  type Address,
  concat,
  type Hex,
  isAddressEqual,
  isHex,
  slice,
  zeroAddress
} from "viem"
import type { UserOperation } from "viem/account-abstraction"
import { createKernelV4Account } from "./kernel/account"
import {
  toSliceWalletWebAuthnSessionSigner,
  toWeightedP256Signer
} from "./permissionSigners"
import type {
  SliceKernelPermission,
  SliceWalletFrameSession,
  SliceWalletFrameSessionKey
} from "./protocol/index"
import {
  encodeKernelEnableSignature,
  encodeKernelPermissionSignature,
  getKernelPermissionInstallState,
  getKernelPermissionInstalls,
  resolveSliceWalletDeployment
} from "./protocol/kernel"
import {
  getWalletPermissionId,
  toWalletPermissionPolicies
} from "./protocol/policy"
import { createSliceWalletRootValidator } from "./rootValidator"
import type { SliceWalletUnsignedUserOperation } from "./types/frame"
import type { CreateSliceWalletPermissionAccountParameters } from "./types/permission"

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

export const isSliceWalletPermissionInstalled = ({
  configuredSigner,
  expectedSigner,
  selectorAllowed
}: {
  configuredSigner: Address
  expectedSigner: Address
  selectorAllowed: boolean
}) => selectorAllowed && isAddressEqual(configuredSigner, expectedSigner)

const createPermission = ({
  mode,
  session
}: Pick<
  CreateSliceWalletPermissionAccountParameters,
  "mode" | "session"
>): SliceKernelPermission => {
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
  return {
    id: getWalletPermissionId(session.policy, session.signerId),
    policies: toWalletPermissionPolicies(session.policy),
    signer
  }
}

const toUnsignedUserOperation = (
  userOperation: UserOperation<"0.9">,
  sender: Address
): SliceWalletUnsignedUserOperation => ({
  callData: userOperation.callData,
  callGasLimit: userOperation.callGasLimit,
  ...(userOperation.factory === undefined
    ? {}
    : { factory: userOperation.factory }),
  ...(userOperation.factoryData === undefined
    ? {}
    : { factoryData: userOperation.factoryData }),
  maxFeePerGas: userOperation.maxFeePerGas,
  maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
  nonce: userOperation.nonce,
  ...(userOperation.paymaster === undefined
    ? {}
    : { paymaster: userOperation.paymaster }),
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
  const permission = createPermission({ mode, session })
  const deployment = resolveSliceWalletDeployment({
    chainId: session.chainId,
    factoryVersion: parameters.factoryVersion
  })
  const rootValidator = createSliceWalletRootValidator({
    chainId: session.chainId,
    credential: parameters.credential,
    factoryVersion: deployment.profile.id,
    ...(parameters.rootSigner === undefined
      ? {}
      : { rootSigner: parameters.rootSigner })
  })
  const account = await createKernelV4Account({
    address,
    client: parameters.client,
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
    nonce: parameters.accountIndex,
    permission,
    rootValidator
  })
  const frameSessionKey = {
    account: session.account,
    chainId: session.chainId,
    grantKind: session.grantKind
  } satisfies SliceWalletFrameSessionKey

  const wrapSignature = async (signerSignature: Hex) => {
    const signature = encodeKernelPermissionSignature({
      policySignatures: permission.policies.map(() => "0x"),
      signerSignature
    })
    const state = await getKernelPermissionInstallState({
      account: address,
      client: parameters.client,
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

  const getStubSignature: typeof account.getStubSignature = async (
    userOperation
  ) => {
    if (
      mode !== "checkout" ||
      userOperation?.callData === undefined ||
      userOperation.nonce === undefined
    ) {
      return wrapSignature(permission.signer.stubSignature)
    }
    const result = getFrameSignatureResult(
      await frameClient.request({
        method: "signCheckoutProposal",
        params: {
          callData: userOperation.callData,
          nonce: userOperation.nonce,
          sender: userOperation.sender ?? address,
          session: frameSessionKey,
          validUntil: session.expiresAt
        }
      })
    )
    return wrapSignature(
      concat([result.signature, slice(permission.signer.stubSignature, 64)])
    )
  }

  const signUserOperation: typeof account.signUserOperation = async (
    userOperation
  ) => {
    const { chainId: _chainId, ...operation } = userOperation
    const sender = operation.sender ?? address
    const unsigned = toUnsignedUserOperation(
      { ...operation, sender, signature: "0x" } as UserOperation<"0.9">,
      sender
    )
    if (mode !== "checkout") {
      const result = getFrameSignatureResult(
        await frameClient.request({
          method: "signScopedUserOperation",
          params: { session: frameSessionKey, userOperation: unsigned }
        })
      )
      return wrapSignature(result.signature)
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
        result.userOperationHash.toLowerCase() ||
      coSigned.validUntil !== challenge.validUntil
    ) {
      throw new Error(
        "Slice co-signer response does not match the signed operation."
      )
    }
    return wrapSignature(
      concat([
        result.signature,
        coSigned.coSignature,
        `0x${coSigned.validUntil.toString(16).padStart(12, "0")}` as Hex
      ])
    )
  }

  return { ...account, getStubSignature, signUserOperation }
}
