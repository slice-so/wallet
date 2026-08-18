export const assertSliceWalletGrantScope = (scope: string) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,127}$/.test(scope)) {
    throw new Error("Wallet grant scope is invalid.")
  }
  return scope
}
