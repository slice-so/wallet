import type {
  SliceKernelSignatureContext,
  SliceKernelValidator,
  SliceWalletRegisteredRootCredential
} from "@slicekit/wallet-primitives"
import { resolveSliceWalletDeployment } from "@slicekit/wallet-primitives/kernel"
import {
  type Address,
  bytesToBigInt,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  type PublicClient,
  toHex
} from "viem"
import type { UserOperation } from "viem/account-abstraction"
import { assertSliceWalletExecutionSafety } from "./executionSafety"
import { createKernelV4Account } from "./kernel/account"
import type {
  CreateSliceWalletRegisteredKernelAccountParameters,
  SliceWalletRootSigner
} from "./types/account"

const missingRootSigner: SliceWalletRootSigner = async () => {
  throw new Error("A visible Slice ID root ceremony is required.")
}

export const sliceWalletRootValidatorStorageAbi = [
  {
    inputs: [{ name: "kernel", type: "address" }],
    name: "webAuthnValidatorStorage",
    outputs: [
      { name: "pubKeyX", type: "uint256" },
      { name: "pubKeyY", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

export const parseSliceWalletUncompressedPublicKey = (publicKey: Hex) => {
  const bytes = hexToBytes(publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Expected an uncompressed P-256 root public key.")
  }
  return {
    x: bytesToBigInt(bytes.slice(1, 33)),
    y: bytesToBigInt(bytes.slice(33, 65))
  }
}

export const getSliceWalletRootValidatorPublicKey = async ({
  account,
  chainId,
  factoryVersion,
  client
}: {
  account: Address
  chainId: number
  factoryVersion?: string
  client: Pick<PublicClient, "readContract">
}) => {
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  const [x, y] = await client.readContract({
    abi: sliceWalletRootValidatorStorageAbi,
    address: deployment.rootValidator,
    args: [account],
    functionName: "webAuthnValidatorStorage"
  })
  return x === 0n && y === 0n ? null : { x, y }
}

export const encodeSliceWalletRootValidatorData = (
  credential: SliceWalletRegisteredRootCredential
) => {
  const coordinates = parseSliceWalletUncompressedPublicKey(
    credential.publicKey
  )
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
    [{ x: coordinates.x, y: coordinates.y }, credential.credentialIdHash]
  )
}

export const sliceWalletWebAuthnDummySignature = encodeAbiParameters(
  [
    { name: "authenticatorData", type: "bytes" },
    { name: "clientDataJSON", type: "string" },
    { name: "responseTypeLocation", type: "uint256" },
    { name: "r", type: "uint256" },
    { name: "s", type: "uint256" },
    { name: "usePrecompiled", type: "bool" }
  ],
  [
    "0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000",
    '{"type":"webauthn.get","challenge":"tbxXNFS9X_4Byr1cMwqKrIGB-_30a0QhZ6y7ucM0BOE","origin":"https://id.slice.so","crossOrigin":false}',
    1n,
    44941127272049826721201904734628716258498742255959991581049806490182030242267n,
    9910254599581058084911561569808925251374718953855182016200087235935345969636n,
    false
  ]
)

const toUnsignedUserOperation = (userOperation: UserOperation<"0.9">) => ({
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
  sender: userOperation.sender,
  verificationGasLimit: userOperation.verificationGasLimit
})

const normalizeMessageRequest = (
  context: Extract<SliceKernelSignatureContext, { purpose: "message" }>
) =>
  typeof context.message === "string"
    ? { message: context.message, messageFormat: "text" as const }
    : {
        message:
          typeof context.message.raw === "string"
            ? context.message.raw
            : toHex(context.message.raw),
        messageFormat: "hex" as const
      }

const stringifyTypedData = (
  value: Extract<
    SliceKernelSignatureContext,
    { purpose: "typed_data" }
  >["source"]
) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item
  )

export const createSliceWalletRootValidator = ({
  chainId,
  credential,
  factoryVersion,
  rootSigner = missingRootSigner
}: {
  chainId: number
  credential: SliceWalletRegisteredRootCredential
  factoryVersion?: string
  rootSigner?: SliceWalletRootSigner
}): SliceKernelValidator => {
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  return {
    address: deployment.rootValidator,
    getEnableData: async () => encodeSliceWalletRootValidatorData(credential),
    getStubSignature: async () => sliceWalletWebAuthnDummySignature,
    signHash: async (hash, context) => {
      if (context.purpose === "user_operation") {
        const userOperation = toUnsignedUserOperation(context.userOperation)
        assertSliceWalletExecutionSafety({ chainId, userOperation })
        return rootSigner(hash, "user_operation", {
          purpose: "user_operation",
          userOperation
        })
      }
      if (context.purpose === "message") {
        return rootSigner(hash, "typed_data", {
          purpose: "typed_data",
          source: { purpose: "message", ...normalizeMessageRequest(context) },
          typedData: context.typedData
        })
      }
      return rootSigner(hash, "typed_data", {
        purpose: "typed_data",
        source: {
          purpose: "application_typed_data",
          typedDataJson: stringifyTypedData(context.source)
        },
        typedData: context.typedData
      })
    }
  }
}

export const createSliceWalletRegisteredKernelAccount = async ({
  address,
  chainId,
  client,
  credential,
  factoryVersion,
  index = 0n,
  initConfig,
  rootSigner
}: CreateSliceWalletRegisteredKernelAccountParameters) => {
  const deployment = resolveSliceWalletDeployment({ chainId, factoryVersion })
  return createKernelV4Account({
    ...(address === undefined ? {} : { address }),
    client,
    entryPoint: deployment.entryPoint,
    ...(deployment.erc6492BootstrapFactory === undefined
      ? {}
      : {
          erc6492BootstrapFactory: deployment.erc6492BootstrapFactory
        }),
    factory: deployment.factory,
    implementation: deployment.implementation,
    ...(initConfig === undefined ? {} : { initialPackages: initConfig }),
    nonce: index,
    rootValidator: createSliceWalletRootValidator({
      chainId,
      credential,
      factoryVersion: deployment.profile.id,
      ...(rootSigner === undefined ? {} : { rootSigner })
    })
  })
}

export const getSliceWalletRegisteredKernelAccountAddress = async (
  parameters: CreateSliceWalletRegisteredKernelAccountParameters
): Promise<Address> =>
  (await createSliceWalletRegisteredKernelAccount(parameters)).address
