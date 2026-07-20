import {
  type ToKernelSmartAccountReturnType,
  toKernelSmartAccount
} from "permissionless/accounts"
import type {
  Chain,
  Client,
  JsonRpcAccount,
  LocalAccount,
  Transport
} from "viem"
import {
  entryPoint07Address,
  type P256Credential,
  type ToWebAuthnAccountParameters,
  toWebAuthnAccount
} from "viem/account-abstraction"
import {
  sliceKernelBaseV33Addresses,
  sliceKernelWebAuthnValidatorAddress
} from "../utils/sliceAccountClient"

export type SliceKernelPasskeyCredential = Pick<
  P256Credential,
  "id" | "publicKey"
>

export type SliceKernelPasskeyClient = Client<
  Transport,
  Chain | undefined,
  JsonRpcAccount | LocalAccount | undefined
>

export type SliceKernelPasskeyAccount = ToKernelSmartAccountReturnType<
  "0.7",
  false
>

export type CreateSliceKernelPasskeyAccountParameters = {
  address?: `0x${string}`
  client: SliceKernelPasskeyClient
  credential: SliceKernelPasskeyCredential
  getFn?: ToWebAuthnAccountParameters["getFn"]
  rpId?: ToWebAuthnAccountParameters["rpId"]
}

export const createSliceKernelPasskeyAccount = async ({
  address,
  client,
  credential,
  getFn,
  rpId
}: CreateSliceKernelPasskeyAccountParameters): Promise<SliceKernelPasskeyAccount> => {
  const owner = toWebAuthnAccount({
    credential,
    ...(getFn !== undefined ? { getFn } : {}),
    ...(rpId !== undefined ? { rpId } : {})
  })

  return toKernelSmartAccount({
    accountLogicAddress: sliceKernelBaseV33Addresses.implementation,
    ...(address !== undefined ? { address } : {}),
    client,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7"
    },
    factoryAddress: sliceKernelBaseV33Addresses.factory,
    metaFactoryAddress: sliceKernelBaseV33Addresses.metaFactory,
    owners: [owner],
    validatorAddress: sliceKernelWebAuthnValidatorAddress,
    version: "0.3.3"
  })
}

export const getSliceKernelPasskeyAccountAddress = async (
  parameters: CreateSliceKernelPasskeyAccountParameters
) => {
  const account = await createSliceKernelPasskeyAccount(parameters)
  return account.address
}
