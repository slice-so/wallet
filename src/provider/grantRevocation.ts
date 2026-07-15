import type { Hex } from "viem"

const toRevocationError = <T>(error: T) =>
  error instanceof Error
    ? error
    : new Error("Wallet permission revocation failed unexpectedly.")

export const revokeSliceWalletGrantState = async ({
  clearSession,
  clearStored,
  permissionId,
  uninstall
}: {
  clearSession: () => Promise<void>
  clearStored: () => void
  permissionId: Hex
  uninstall: () => Promise<void>
}) => {
  let uninstallError: Error | null = null
  try {
    await uninstall()
  } catch (error) {
    uninstallError = toRevocationError(error)
  }

  let sessionError: Error | null = null
  try {
    await clearSession()
  } catch (error) {
    sessionError = toRevocationError(error)
  }

  if (uninstallError !== null) {
    // Keep the grant discoverable so a root-authorized uninstall can be retried.
    if (sessionError !== null) {
      throw new AggregateError(
        [uninstallError, sessionError],
        `Wallet permission ${permissionId} could not be revoked onchain or cleared from the signer frame.`
      )
    }
    throw uninstallError
  }

  // The onchain uninstall is authoritative even if the frame is unavailable.
  clearStored()
}
