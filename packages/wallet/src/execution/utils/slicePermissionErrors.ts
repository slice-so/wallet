const permissionRevokedRejection =
  /delegation_not_found|invalid_delegation|EnableNotApproved|AA23 reverted:?\s+0xc48cf8ee\b/i

const permissionExpiredRejection = /AA22 expired or not due/i
const permissionInstallRejection = /AA23 reverted:?\s+0x23a6725b\b/i // Kernel v4 ModuleInstallFailed().
const permissionValidationRejectionWithoutData = /AA23 reverted:?\s+0x\b/i

const getPermissionErrorMessage = (
  error: string | (Error & { details?: string })
) =>
  typeof error === "string" ? error : `${error.message} ${error.details ?? ""}`

export const getSliceWalletPermissionUnavailableReason = (
  error: string | (Error & { details?: string })
) => {
  const message = getPermissionErrorMessage(error)
  if (permissionRevokedRejection.test(message)) return "revoked" as const
  if (permissionExpiredRejection.test(message)) return "expired" as const
  if (permissionInstallRejection.test(message)) return "invalid" as const
  if (permissionValidationRejectionWithoutData.test(message))
    return "invalid" as const
  return null
}
