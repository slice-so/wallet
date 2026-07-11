import type { SignableMessage } from "viem"
import { formatSliceWalletExistingCredentialAuthorization } from "../registry"
import type {
  SliceWalletProtocolValue,
  SliceWalletRecoveryHandoffAuthorizationResponse,
  SliceWalletRegistryCredential
} from "../types"
import {
  createSliceWalletCeremonyNonce,
  openSliceWalletCeremonyChannel
} from "./popup"
import {
  parseSliceWalletRecoveryHandoffAuthorizationRequest,
  parseSliceWalletRecoveryHandoffResult
} from "./recoveryProtocol"

export const registerRecoveredSliceWalletCredential = async ({
  account,
  idOrigin,
  recoveryPermissionId,
  recoverySignerAddress,
  signMessage,
  timeoutMs = 5 * 60_000,
  window
}: {
  account: `0x${string}`
  idOrigin: string
  recoveryPermissionId: `0x${string}`
  recoverySignerAddress: `0x${string}`
  signMessage: (message: SignableMessage) => Promise<`0x${string}`>
  timeoutMs?: number
  window: Window
}): Promise<{
  credentialId: string
  registry: SliceWalletRegistryCredential
}> => {
  const nonce = createSliceWalletCeremonyNonce(window)
  const { popup, port } = await openSliceWalletCeremonyChannel({
    idOrigin,
    nonce,
    path: `/ceremony/recovery?account=${encodeURIComponent(account)}`,
    window
  })

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      port.close()
      popup.close()
      reject(new Error("Recovery handoff timed out."))
    }, timeoutMs)
    let signed = false
    const finish = () => {
      clearTimeout(timeout)
      port.close()
      popup.close()
    }
    port.addEventListener(
      "message",
      async (event: MessageEvent<SliceWalletProtocolValue>) => {
        try {
          if (!signed) {
            const request = parseSliceWalletRecoveryHandoffAuthorizationRequest(
              event.data
            )
            if (
              request.nonce !== nonce ||
              request.account.toLowerCase() !== account.toLowerCase()
            ) {
              throw new Error(
                "Recovery authorization does not match this wallet."
              )
            }
            const expectedMessage =
              formatSliceWalletExistingCredentialAuthorization({
                accountAddress: request.account,
                accountIndex: request.accountIndex,
                challenge: request.challenge,
                credentialIdHash: request.credentialIdHash,
                factoryVersion: request.factoryVersion,
                publicKey: request.publicKey
              })
            if (request.message !== expectedMessage) {
              throw new Error(
                "Recovery authorization message is not canonical."
              )
            }
            const response = {
              nonce,
              recoveryPermissionId,
              recoverySignerAddress,
              rootSignature: await signMessage(request.message),
              type: "slice-wallet:recovery-root-signature",
              version: 1
            } satisfies SliceWalletRecoveryHandoffAuthorizationResponse
            signed = true
            port.postMessage(response)
            return
          }

          const result = parseSliceWalletRecoveryHandoffResult(event.data)
          if (result.nonce !== nonce) {
            throw new Error("Recovery result nonce does not match.")
          }
          if (result.type === "slice-wallet:recovery-error") {
            throw new Error(result.message)
          }
          if (
            result.registry.accountAddress.toLowerCase() !==
            account.toLowerCase()
          ) {
            throw new Error("Recovered credential belongs to another wallet.")
          }
          finish()
          resolve({
            credentialId: result.credentialId,
            registry: result.registry
          })
        } catch (error) {
          finish()
          reject(
            error instanceof Error
              ? error
              : new Error("Recovery handoff returned invalid data.")
          )
        }
      }
    )
  })
}
