import type { Hex } from "viem"
import type {
  ManageSliceWalletDeviceParameters,
  SliceWalletProtocolValue
} from "../types"
import { parseSliceWalletCeremonyDeviceResponse } from "./deviceProtocol"
import {
  openSliceWalletCeremonyChannel,
  waitForSliceWalletCeremonyMessage
} from "./popup"

const manageSliceWalletDevice = async (
  action: "add" | "promote" | "remove",
  {
    account,
    ceremonyMode = "popup",
    chainId,
    credentialIdHash,
    document,
    idOrigin,
    timeoutMs = 5 * 60_000,
    window
  }: ManageSliceWalletDeviceParameters
) => {
  if (action !== "add" && credentialIdHash === undefined) {
    throw new Error("This device action requires its credential id hash.")
  }
  const nonceBytes = new Uint8Array(32)
  window.crypto.getRandomValues(nonceBytes)
  const nonce = `0x${Array.from(nonceBytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}` as Hex
  const idUrl = new URL(`/ceremony/device-${action}`, new URL(idOrigin).origin)
  idUrl.searchParams.set("account", account)
  idUrl.searchParams.set("chainId", String(chainId))
  idUrl.searchParams.set("nonce", nonce)
  if (credentialIdHash !== undefined) {
    idUrl.searchParams.set("credentialIdHash", credentialIdHash)
  }
  const channel = await openSliceWalletCeremonyChannel({
    document,
    idOrigin,
    mode: ceremonyMode,
    nonce,
    path: idUrl.href,
    popupName: `slice-wallet-device-${action}`,
    window
  })
  return waitForSliceWalletCeremonyMessage({
    parse: (value: SliceWalletProtocolValue) => {
      const response = parseSliceWalletCeremonyDeviceResponse(value)
      if (response.nonce !== nonce) {
        throw new Error("Device ceremony response nonce does not match.")
      }
      if (response.type === "slice-wallet:ceremony-error") {
        throw new Error(response.message)
      }
      if (
        response.action !== action ||
        response.account.toLowerCase() !== account.toLowerCase() ||
        response.chainId !== chainId ||
        (credentialIdHash !== undefined &&
          response.credentialIdHash.toLowerCase() !==
            credentialIdHash.toLowerCase())
      ) {
        throw new Error("Device ceremony returned a mismatched result.")
      }
      return response
    },
    port: channel.port,
    surface: channel.surface,
    timeoutMs
  })
}

export const addSliceWalletDevice = (
  parameters: ManageSliceWalletDeviceParameters
) => manageSliceWalletDevice("add", parameters)

export const removeSliceWalletDevice = (
  parameters: ManageSliceWalletDeviceParameters
) => manageSliceWalletDevice("remove", parameters)

export const promoteSliceWalletDevice = (
  parameters: ManageSliceWalletDeviceParameters
) => manageSliceWalletDevice("promote", parameters)
