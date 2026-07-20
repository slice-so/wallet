import type { SliceKernelPasskeyAccount } from "../execution"

export const getSliceWalletAccountVerification = async (
  account: Pick<SliceKernelPasskeyAccount, "getFactoryArgs">
) => {
  const { factory, factoryData } = await account.getFactoryArgs()
  if (!factory || !factoryData) return undefined

  return { factory, factoryData }
}
