import { createKernelAccount, type KernelValidator } from "@zerodev/sdk"
import {
  type Address,
  bytesToBigInt,
  encodeAbiParameters,
  hashMessage,
  hashTypedData,
  hexToBytes,
  isAddress,
  isHex,
  toHex
} from "viem"
import { getUserOperationHash } from "viem/account-abstraction"
import { toAccount } from "viem/accounts"
import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletKernelVersion
} from "./constants"
import type {
  CreateSliceWalletRegisteredKernelAccountParameters,
  SliceWalletKernelTypedData,
  SliceWalletRegisteredRootCredential,
  SliceWalletRootSigner
} from "./types/account"

type RootProtocolValue =
  | boolean
  | null
  | number
  | string
  | readonly RootProtocolValue[]
  | { readonly [key: string]: RootProtocolValue }

const parseKernelTypedData = (
  value: RootProtocolValue
): SliceWalletKernelTypedData => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Kernel typed data must be an object.")
  }
  const input = value as { readonly [key: string]: RootProtocolValue }
  const domain = input.domain
  const message = input.message
  const types = input.types
  if (
    input.primaryType !== "Kernel" ||
    typeof domain !== "object" ||
    domain === null ||
    Array.isArray(domain) ||
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    typeof types !== "object" ||
    types === null ||
    Array.isArray(types)
  ) {
    throw new Error("Kernel typed data is invalid.")
  }
  const domainRecord = domain as {
    readonly [key: string]: RootProtocolValue
  }
  const messageRecord = message as {
    readonly [key: string]: RootProtocolValue
  }
  const typesRecord = types as {
    readonly [key: string]: RootProtocolValue
  }
  const kernelTypes = typesRecord.Kernel
  if (
    typeof domainRecord.chainId !== "number" ||
    !Number.isSafeInteger(domainRecord.chainId) ||
    typeof domainRecord.name !== "string" ||
    typeof domainRecord.version !== "string" ||
    typeof domainRecord.verifyingContract !== "string" ||
    !isAddress(domainRecord.verifyingContract) ||
    typeof messageRecord.hash !== "string" ||
    !isHex(messageRecord.hash, { strict: true }) ||
    hexToBytes(messageRecord.hash).length !== 32 ||
    !Array.isArray(kernelTypes) ||
    kernelTypes.length !== 1
  ) {
    throw new Error("Kernel typed data is invalid.")
  }
  const hashField = kernelTypes[0]
  if (
    typeof hashField !== "object" ||
    hashField === null ||
    Array.isArray(hashField) ||
    hashField.name !== "hash" ||
    hashField.type !== "bytes32"
  ) {
    throw new Error("Kernel typed-data hash field is invalid.")
  }
  return {
    domain: {
      chainId: domainRecord.chainId,
      name: domainRecord.name,
      verifyingContract: domainRecord.verifyingContract,
      version: domainRecord.version
    },
    message: { hash: messageRecord.hash },
    primaryType: "Kernel",
    types: { Kernel: [{ name: "hash", type: "bytes32" }] }
  }
}

const missingRootSigner: SliceWalletRootSigner = async () => {
  throw new Error("A visible Slice ID root ceremony is required.")
}

const toUnsignedUserOperation = (
  userOperation: Parameters<KernelValidator["signUserOperation"]>[0]
) => ({
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

export const createSliceWalletRootValidator = ({
  chainId,
  credential,
  rootSigner = missingRootSigner
}: {
  chainId: number
  credential: SliceWalletRegisteredRootCredential
  rootSigner?: SliceWalletRootSigner
}): KernelValidator<"SliceWalletWebAuthnRootValidator"> => {
  const account = toAccount({
    address: sliceWalletKernelAddresses.webAuthnRootValidator,
    async signMessage({ message }) {
      const normalizedMessage =
        typeof message === "string"
          ? { message, messageFormat: "text" as const }
          : {
              message:
                typeof message.raw === "string"
                  ? message.raw
                  : toHex(message.raw),
              messageFormat: "hex" as const
            }
      return rootSigner(hashMessage(message), "message", {
        ...normalizedMessage,
        purpose: "message"
      })
    },
    async signTransaction() {
      throw new Error("A smart-account validator does not sign transactions.")
    },
    async signTypedData(typedData) {
      return rootSigner(hashTypedData(typedData), "typed_data", {
        purpose: "typed_data",
        typedData: parseKernelTypedData(typedData as RootProtocolValue)
      })
    }
  })

  return {
    ...account,
    address: sliceWalletKernelAddresses.webAuthnRootValidator,
    getEnableData: async () => encodeSliceWalletRootValidatorData(credential),
    getIdentifier: () => sliceWalletKernelAddresses.webAuthnRootValidator,
    getNonceKey: async (_accountAddress?: Address, customNonceKey?: bigint) =>
      customNonceKey ?? 0n,
    getStubSignature: async () => sliceWalletWebAuthnDummySignature,
    isEnabled: async () => true,
    signUserOperation: async (userOperation) => {
      const { chainId: operationChainId, ...operation } = userOperation
      const hash = getUserOperationHash({
        chainId: operationChainId ?? chainId,
        entryPointAddress: sliceWalletEntryPoint.address,
        entryPointVersion: sliceWalletEntryPoint.version,
        userOperation: { ...operation, signature: "0x" }
      })
      return rootSigner(hash, "user_operation", {
        purpose: "user_operation",
        userOperation: toUnsignedUserOperation({
          ...operation,
          chainId: operationChainId,
          signature: "0x"
        })
      })
    },
    source: "SliceWalletWebAuthnRootValidator",
    supportedKernelVersions: sliceWalletKernelVersion,
    validatorType: "SECONDARY"
  }
}

export const createSliceWalletRegisteredKernelAccount = async ({
  address,
  chainId,
  client,
  credential,
  index = 0n,
  rootSigner
}: CreateSliceWalletRegisteredKernelAccountParameters) => {
  const rootValidator = createSliceWalletRootValidator({
    chainId,
    credential,
    ...(rootSigner === undefined ? {} : { rootSigner })
  })
  return createKernelAccount(client, {
    ...(address === undefined ? {} : { address }),
    accountImplementationAddress: sliceWalletKernelAddresses.implementation,
    entryPoint: sliceWalletEntryPoint,
    factoryAddress: sliceWalletKernelAddresses.factory,
    index,
    kernelVersion: sliceWalletKernelVersion,
    metaFactoryAddress: sliceWalletKernelAddresses.metaFactory,
    plugins: { sudo: rootValidator },
    useMetaFactory: true
  })
}

export const getSliceWalletRegisteredKernelAccountAddress = async (
  parameters: CreateSliceWalletRegisteredKernelAccountParameters
): Promise<Address> =>
  (await createSliceWalletRegisteredKernelAccount(parameters)).address
