import { toKernelSmartAccount } from "permissionless/accounts"
import { toWebAuthnAccount } from "viem/account-abstraction"
import { sliceWalletEntryPoint, sliceWalletKernelAddresses } from "./constants"
import type {
  CreateSliceWalletKernelAccountParameters,
  SliceWalletKernelAccount
} from "./types/account"

export const createSliceWalletKernelAccount = async ({
  address,
  client,
  credential,
  getFn,
  rpId
}: CreateSliceWalletKernelAccountParameters): Promise<SliceWalletKernelAccount> => {
  const owner = toWebAuthnAccount({
    credential,
    ...(getFn === undefined ? {} : { getFn }),
    ...(rpId === undefined ? {} : { rpId })
  })

  return toKernelSmartAccount({
    accountLogicAddress: sliceWalletKernelAddresses.implementation,
    ...(address === undefined ? {} : { address }),
    client,
    entryPoint: sliceWalletEntryPoint,
    factoryAddress: sliceWalletKernelAddresses.factory,
    metaFactoryAddress: sliceWalletKernelAddresses.metaFactory,
    owners: [owner],
    validatorAddress: sliceWalletKernelAddresses.webAuthnRootValidator,
    version: "0.3.3"
  })
}

export const getSliceWalletKernelAccountAddress = async (
  parameters: CreateSliceWalletKernelAccountParameters
) => (await createSliceWalletKernelAccount(parameters)).address
