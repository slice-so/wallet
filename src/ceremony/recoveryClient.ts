import { formatSliceWalletExistingCredentialAuthorization } from "../registry"
import type {
  RegisterRecoveredSliceWalletCredentialParameters,
  SliceWalletProtocolValue,
  SliceWalletRecoveryHandoffAuthorizationRequest,
  SliceWalletRecoveryHandoffAuthorizationResponse,
  SliceWalletRegistryCredential
} from "../types"
import {
  requireSliceWalletPopupGesture,
  SliceWalletUserGestureRequiredError
} from "./broker"
import {
  createSliceWalletCeremonyNonce,
  openSliceWalletCeremonyChannel,
  resolveSliceWalletCeremonyMode
} from "./popup"
import { parseSliceWalletCeremonyResponse } from "./protocol"
import {
  parseSliceWalletRecoveryHandoffAuthorizationRequest,
  parseSliceWalletRecoveryHandoffResult
} from "./recoveryProtocol"

export const registerRecoveredSliceWalletCredential = async ({
  account,
  accountIndex,
  ceremonyBroker,
  ceremonyMode = "popup",
  chainId,
  document,
  idOrigin,
  recoveryPermissionId,
  recoverySignerAddress,
  signMessage,
  timeoutMs = 5 * 60_000,
  window
}: RegisterRecoveredSliceWalletCredentialParameters): Promise<{
  credentialId: string
  registry: SliceWalletRegistryCredential
}> => {
  const nonce = createSliceWalletCeremonyNonce(window)
  const resolvedMode = resolveSliceWalletCeremonyMode({
    brokerAvailable: ceremonyBroker !== undefined,
    document,
    mode: ceremonyMode,
    path: "/ceremony/recovery",
    window
  })
  const run = async (
    mode: "iframe" | "popup",
    requireActiveGesture: boolean
  ) => {
    if (
      mode === "popup" &&
      requireActiveGesture &&
      window.navigator.userActivation?.isActive === false
    ) {
      throw new SliceWalletUserGestureRequiredError("user_activation_expired")
    }
    const { port, surface } = await openSliceWalletCeremonyChannel({
      brokerAvailable: ceremonyBroker !== undefined,
      document,
      idOrigin,
      mode,
      nonce,
      path: `/ceremony/recovery?account=${encodeURIComponent(account)}&accountIndex=${accountIndex}&chainId=${chainId}`,
      popupName: "slice-wallet-recovery",
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
      let authorization: SliceWalletRecoveryHandoffAuthorizationRequest | null =
        null
      let phase: "authorization" | "signing" | "result" = "authorization"
      const finish = () => {
        clearTimeout(timeout)
        port.close()
        surface.close()
      }
      port.addEventListener(
        "message",
        async (event: MessageEvent<SliceWalletProtocolValue>) => {
          try {
            if (
              typeof event.data === "object" &&
              event.data !== null &&
              !Array.isArray(event.data) &&
              "type" in event.data &&
              event.data.type === "slice-wallet:popup-required"
            ) {
              const response = parseSliceWalletCeremonyResponse(event.data)
              if (
                response.type !== "slice-wallet:popup-required" ||
                response.nonce !== nonce
              ) {
                throw new Error("Recovery popup response nonce does not match.")
              }
              throw new SliceWalletUserGestureRequiredError(response.reason)
            }
            if (phase === "signing") return
            if (phase === "authorization") {
              const request =
                parseSliceWalletRecoveryHandoffAuthorizationRequest(event.data)
              if (
                request.nonce !== nonce ||
                request.chainId !== chainId ||
                request.accountIndex !== accountIndex ||
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
              authorization = request
              phase = "signing"
              const rootSignature = await signMessage(request.message)
              phase = "result"
              const response = {
                nonce,
                recoveryPermissionId,
                recoverySignerAddress,
                rootSignature,
                type: "slice-wallet:recovery-root-signature",
                version: 1
              } satisfies SliceWalletRecoveryHandoffAuthorizationResponse
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
            if (authorization === null) {
              throw new Error("Recovery result arrived before authorization.")
            }
            if (
              result.registry.accountAddress.toLowerCase() !==
                authorization.account.toLowerCase() ||
              result.registry.accountIndex !== authorization.accountIndex ||
              result.registry.credentialIdHash.toLowerCase() !==
                authorization.credentialIdHash.toLowerCase() ||
              result.registry.publicKey.toLowerCase() !==
                authorization.publicKey.toLowerCase() ||
              result.registry.factoryVersion !== authorization.factoryVersion ||
              result.registry.recoveryPermissionId?.toLowerCase() !==
                recoveryPermissionId.toLowerCase() ||
              result.registry.recoverySignerAddress?.toLowerCase() !==
                recoverySignerAddress.toLowerCase()
            ) {
              throw new Error(
                "Recovered credential does not match the authorized credential."
              )
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
    return await run(resolvedMode, true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    return requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind: "recovery",
      reason: error.reason,
      resume: () => run("popup", false)
    })
  }
}
