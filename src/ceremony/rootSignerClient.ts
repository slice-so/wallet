import type {
  CreateSliceWalletCeremonyRootSignerParameters,
  SliceWalletCeremonyRootSignRequest,
  SliceWalletRootSigner
} from "../types"
import {
  requireSliceWalletPopupGesture,
  SliceWalletUserGestureRequiredError
} from "./broker"
import {
  createSliceWalletCeremonyNonce,
  openSliceWalletCeremonyChannel,
  resolveSliceWalletCeremonyMode,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import { parseSliceWalletCeremonyRootResponse } from "./protocol"

export const createSliceWalletCeremonyRootSigner =
  ({
    account,
    ceremonyBroker,
    ceremonyMode = "popup",
    chainId,
    document,
    idOrigin,
    timeoutMs = 5 * 60_000,
    window
  }: CreateSliceWalletCeremonyRootSignerParameters): SliceWalletRootSigner =>
  async (expectedHash, purpose, request) => {
    if (request === undefined || request.purpose !== purpose) {
      throw new Error(
        "This root signature request requires structured ceremony data."
      )
    }
    const message = {
      account,
      chainId,
      nonce: createSliceWalletCeremonyNonce(window),
      request,
      type: "slice-wallet:root-sign-request",
      version: 1
    } as const satisfies SliceWalletCeremonyRootSignRequest
    const resolvedMode = resolveSliceWalletCeremonyMode({
      brokerAvailable: ceremonyBroker !== undefined,
      document,
      mode: ceremonyMode,
      path: "/ceremony/root",
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
        nonce: message.nonce,
        path: `/ceremony/root?account=${encodeURIComponent(account)}&chainId=${chainId}`,
        window
      })
      port.postMessage(message)
      const response = await waitForSliceWalletCeremonyMessage({
        parse: parseSliceWalletCeremonyRootResponse,
        port,
        surface,
        timeoutMs
      })
      if (response.nonce !== message.nonce) {
        throw new Error("Slice Wallet root response nonce does not match.")
      }
      if (response.type === "slice-wallet:ceremony-error") {
        throw new Error(response.message)
      }
      if (response.type === "slice-wallet:popup-required") {
        throw new SliceWalletUserGestureRequiredError(response.reason)
      }
      if (response.hash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(
          "Slice Wallet root ceremony signed a different request."
        )
      }
      return response.signature
    }
    try {
      return await run(resolvedMode, true)
    } catch (error) {
      if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
      return requireSliceWalletPopupGesture({
        broker: ceremonyBroker,
        kind: "root_sign",
        reason: error.reason,
        resume: () => run("popup", false)
      })
    }
  }
