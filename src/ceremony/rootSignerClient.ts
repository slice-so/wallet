import type {
  CreateSliceWalletCeremonyRootSignerParameters,
  SliceWalletCeremonyRootSignRequest,
  SliceWalletRootSigner
} from "../types"
import {
  createSliceWalletCeremonyNonce,
  openSliceWalletCeremonyChannel,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import { parseSliceWalletCeremonyRootResponse } from "./protocol"

export const createSliceWalletCeremonyRootSigner =
  ({
    account,
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
    const nonce = createSliceWalletCeremonyNonce(window)
    const { port, surface } = await openSliceWalletCeremonyChannel({
      document,
      idOrigin,
      mode: ceremonyMode,
      nonce,
      path: `/ceremony/root?account=${encodeURIComponent(account)}&chainId=${chainId}`,
      window
    })
    const message = {
      account,
      chainId,
      nonce,
      request,
      type: "slice-wallet:root-sign-request",
      version: 1
    } as const satisfies SliceWalletCeremonyRootSignRequest
    port.postMessage(message)
    const response = await waitForSliceWalletCeremonyMessage({
      parse: parseSliceWalletCeremonyRootResponse,
      port,
      surface,
      timeoutMs
    })
    if (response.nonce !== nonce) {
      throw new Error("Slice Wallet root response nonce does not match.")
    }
    if (response.type === "slice-wallet:ceremony-error") {
      throw new Error(response.message)
    }
    if (response.hash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error("Slice Wallet root ceremony signed a different request.")
    }
    return response.signature
  }
