export const sliceWalletMaxAccountIndex = 31
export const sliceWalletAccountIndexCap = sliceWalletMaxAccountIndex + 1

export const assertSliceWalletAccountIndex = (value: number): number => {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > sliceWalletMaxAccountIndex
  ) {
    throw new Error(
      `Slice wallet account index must be an integer between 0 and ${sliceWalletMaxAccountIndex}.`
    )
  }
  return value
}
