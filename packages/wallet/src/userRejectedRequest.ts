export class SliceWalletUserRejectedRequestError extends Error {
  readonly code = 4001

  constructor(message = "User rejected the request") {
    super(message)
    this.name = "SliceWalletUserRejectedRequestError"
  }
}

export const toSliceWalletCeremonyError = ({
  code,
  message
}: {
  code: string
  message: string
}) =>
  code === "user_rejected"
    ? new SliceWalletUserRejectedRequestError(message)
    : new Error(message)
