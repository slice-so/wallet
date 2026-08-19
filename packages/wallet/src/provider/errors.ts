export class SliceWalletProviderRpcError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = "SliceWalletProviderRpcError"
  }
}

export const invalidProviderRequest = (message: string) =>
  new SliceWalletProviderRpcError(-32602, message)

export const unsupportedProviderMethod = (method: string) =>
  new SliceWalletProviderRpcError(4200, `Unsupported wallet method: ${method}.`)

export const unauthorizedProviderRequest = () =>
  new SliceWalletProviderRpcError(4100, "Connect Slice Wallet first.")
