import type { Address, Hex, SignableMessage } from "viem"
import { formatSliceWalletExistingCredentialAuthorization } from "../registry"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletProtocolValue,
  SliceWalletRecoveryHandoffAuthorizationResponse,
  SliceWalletRegistryCredential
} from "../types"
import {
  requireSliceWalletPopupGesture,
  SliceWalletUserGestureRequiredError
} from "./broker"
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
  ceremonyBroker,
  chainId,
  idOrigin,
  recoveryPermissionId,
  recoverySignerAddress,
  signMessage,
  timeoutMs = 5 * 60_000,
  window
}: {
  account: Address
  ceremonyBroker?: SliceWalletCeremonyBroker
  chainId: number
  idOrigin: string
  recoveryPermissionId: Hex
  recoverySignerAddress: Address
  signMessage: (message: SignableMessage) => Promise<Hex>
  timeoutMs?: number
  window: Window
}): Promise<{
  credentialId: string
  registry: SliceWalletRegistryCredential
}> => {
  const nonce = createSliceWalletCeremonyNonce(window)
  const run = async (requireActiveGesture: boolean) => {
    if (
      requireActiveGesture &&
      window.navigator.userActivation?.isActive === false
    ) {
      throw new SliceWalletUserGestureRequiredError("user_activation_expired")
    }
    const { port, surface } = await openSliceWalletCeremonyChannel({
      idOrigin,
      nonce,
      path: `/ceremony/recovery?account=${encodeURIComponent(account)}&chainId=${chainId}`,
      window
    })
    return new Promise<{
      credentialId: string
      registry: SliceWalletRegistryCredential
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        port.close()
        surface.close()
        reject(new Error("Recovery handoff timed out."))
      }, timeoutMs)
      let signed = false
      const finish = () => {
        clearTimeout(timeout)
        port.close()
        surface.close()
      }
      port.addEventListener(
        "message",
        async (event: MessageEvent<SliceWalletProtocolValue>) => {
          try {
            if (!signed) {
              const request =
                parseSliceWalletRecoveryHandoffAuthorizationRequest(event.data)
              if (
                request.nonce !== nonce ||
                request.chainId !== chainId ||
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
                  chainId: request.chainId,
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
  try {
    return await run(true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    return requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind: "recovery",
      reason: error.reason,
      resume: () => run(false)
    })
  }
}
