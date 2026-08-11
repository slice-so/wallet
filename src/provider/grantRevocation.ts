const toRevocationError = <T>(error: T) =>
  error instanceof Error
    ? error
    : new Error("Wallet permission revocation failed unexpectedly.")

export const revokeSliceWalletGrantState = async ({
  clearSession,
  clearStored,
  uninstall
}: {
  clearSession: () => Promise<void>
  clearStored: () => void
  uninstall: () => Promise<void>
}) => {
  try {
    await uninstall()
  } catch (error) {
    // Preserve both persisted and frame state so revocation remains retryable.
    throw toRevocationError(error)
  }

  try {
    await clearSession()
  } catch {
    // The confirmed onchain revocation is authoritative. Persisted state can
    // be removed even if an unavailable signer frame cannot be cleaned up.
  }

  clearStored()
}
