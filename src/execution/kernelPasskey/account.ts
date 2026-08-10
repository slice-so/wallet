import { toKernelSmartAccount } from "permissionless/accounts"
import {
  entryPoint07Address,
  toWebAuthnAccount
} from "viem/account-abstraction"
import type { SliceWalletKernelAccount } from "../../types/account"
import type { CreateSliceKernelPasskeyAccountParameters } from "../../types/accountClient"
import {
  sliceKernelBaseV33Addresses,
  sliceKernelWebAuthnValidatorAddress
} from "../utils/sliceAccountClient"

export const createSliceKernelPasskeyAccount = async ({
  address,
  client,
  credential,
  getFn,
  rpId
}: CreateSliceKernelPasskeyAccountParameters): Promise<SliceWalletKernelAccount> => {
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
