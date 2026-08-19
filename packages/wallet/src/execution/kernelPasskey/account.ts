import { createSliceWalletKernelAccount } from "../../account"
import type { SliceWalletKernelAccount } from "../../types/account"
import type { CreateSliceKernelPasskeyAccountParameters } from "../../types/accountClient"

export const createSliceKernelPasskeyAccount = async ({
  address,
  client,
  credential,
  getFn,
  rpId
}: CreateSliceKernelPasskeyAccountParameters): Promise<SliceWalletKernelAccount> => {
  return createSliceWalletKernelAccount({
    ...(address !== undefined ? { address } : {}),
    client,
    credential,
    ...(getFn !== undefined ? { getFn } : {}),
    ...(rpId !== undefined ? { rpId } : {})
  })
}

export const getSliceKernelPasskeyAccountAddress = async (
  parameters: CreateSliceKernelPasskeyAccountParameters
) => {
  const account = await createSliceKernelPasskeyAccount(parameters)
  return account.address
}
