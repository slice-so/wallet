import {
  type Address,
  concat,
  hashTypedData,
  type SignableMessage,
  type TypedDataDefinition,
  toPrefixedMessage,
  zeroHash
} from "viem"
import { wrapTypedDataSignature } from "viem/experimental/erc7739"
import type {
  SliceKernelPermission,
  SliceKernelValidator,
  SliceWalletKernelTypedData,
  SliceWalletKernelTypedDataValue
} from "../protocol/index"
import {
  encodeKernelPermissionSignature,
  getKernelDomain,
  kernelVersion
} from "../protocol/kernel"

const kernelPersonalSignTypes = {
  PersonalSign: [{ name: "prefixed", type: "bytes" }]
} as const

const kernelTypedDataSignFields = [
  { name: "contents", type: "contents" },
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
  { name: "salt", type: "bytes32" }
] as const

const toKernelProtocolTypedData = (
  typedData: Parameters<typeof hashTypedData>[0]
) => typedData as SliceWalletKernelTypedData

export const signKernelMessage = async ({
  account,
  chainId,
  message,
  validator
}: {
  account: Address
  chainId: number
  message: SignableMessage
  validator: SliceKernelValidator
}) => {
  const typedData = {
    domain: getKernelDomain({ account, chainId }),
    message: { prefixed: toPrefixedMessage(message) },
    primaryType: "PersonalSign",
    types: kernelPersonalSignTypes
  } as const
  const signature = await validator.signHash(hashTypedData(typedData), {
    message,
    purpose: "message",
    typedData: toKernelProtocolTypedData(typedData)
  })
  return concat(["0x00", "0x00", signature])
}

export const signKernelPermissionMessage = async ({
  account,
  chainId,
  message,
  permission
}: {
  account: Address
  chainId: number
  message: SignableMessage
  permission: SliceKernelPermission
}) => {
  const typedData = {
    domain: getKernelDomain({ account, chainId }),
    message: { prefixed: toPrefixedMessage(message) },
    primaryType: "PersonalSign",
    types: kernelPersonalSignTypes
  } as const
  const signature = encodeKernelPermissionSignature({
    policySignatures: permission.policies.map(() => "0x"),
    signerSignature: await permission.signer.account.signMessage({
      message: { raw: hashTypedData(typedData) }
    })
  })
  return concat(["0x00", "0x02", permission.id, signature])
}

const toWrappedTypedData = (
  source: TypedDataDefinition,
  account: Address,
  chainId: number
) => {
  return {
    domain: source.domain,
    message: {
      chainId,
      contents: source.message as SliceWalletKernelTypedDataValue,
      name: "Kernel",
      salt: zeroHash,
      verifyingContract: account,
      version: kernelVersion
    },
    primaryType: "TypedDataSign",
    types: {
      ...source.types,
      TypedDataSign: kernelTypedDataSignFields.map((field) =>
        field.name === "contents"
          ? { ...field, type: source.primaryType }
          : field
      )
    }
  } as const
}

export const signKernelTypedData = async ({
  account,
  chainId,
  source,
  validator
}: {
  account: Address
  chainId: number
  source: TypedDataDefinition
  validator: SliceKernelValidator
}) => {
  const wrapped = toWrappedTypedData(source, account, chainId)
  const signature = await validator.signHash(
    hashTypedData(wrapped as Parameters<typeof hashTypedData>[0]),
    {
      purpose: "typed_data",
      source,
      typedData: toKernelProtocolTypedData(
        wrapped as Parameters<typeof hashTypedData>[0]
      )
    }
  )
  const erc7739Signature = wrapTypedDataSignature({
    ...source,
    signature
  } as Parameters<typeof wrapTypedDataSignature>[0])
  return concat(["0x00", "0x00", erc7739Signature])
}

export const signKernelPermissionTypedData = async ({
  account,
  chainId,
  permission,
  source
}: {
  account: Address
  chainId: number
  permission: SliceKernelPermission
  source: TypedDataDefinition
}) => {
  const wrapped = toWrappedTypedData(source, account, chainId)
  const signature = encodeKernelPermissionSignature({
    policySignatures: permission.policies.map(() => "0x"),
    signerSignature: await permission.signer.account.signMessage({
      message: {
        raw: hashTypedData(wrapped as Parameters<typeof hashTypedData>[0])
      }
    })
  })
  const erc7739Signature = wrapTypedDataSignature({
    ...source,
    signature
  } as Parameters<typeof wrapTypedDataSignature>[0])
  return concat(["0x00", "0x02", permission.id, erc7739Signature])
}
