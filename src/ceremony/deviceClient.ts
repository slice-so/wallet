import type { Hex } from "viem"
import type {
  ManageSliceWalletDeviceParameters,
  SliceWalletProtocolValue
} from "../types"
import {
  requireSliceWalletPopupGesture,
  SliceWalletUserGestureRequiredError
} from "./broker"
import { parseSliceWalletCeremonyDeviceResponse } from "./deviceProtocol"
import {
  openSliceWalletCeremonyChannel,
  resolveSliceWalletCeremonyMode,
  waitForSliceWalletCeremonyMessage
} from "./popup"

const manageSliceWalletDevice = async (
  action: "add" | "promote" | "remove",
  {
    account,
    ceremonyBroker,
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
  const resolvedMode = resolveSliceWalletCeremonyMode({
    brokerAvailable: ceremonyBroker !== undefined,
    document,
    mode: ceremonyMode,
    path: `/ceremony/device-${action}`,
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
    const channel = await openSliceWalletCeremonyChannel({
      brokerAvailable: ceremonyBroker !== undefined,
      document,
      idOrigin,
      mode,
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
        if (response.type === "slice-wallet:popup-required") {
          throw new SliceWalletUserGestureRequiredError(response.reason)
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
  try {
    return await run(resolvedMode, true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    return requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind:
        action === "promote"
          ? "device_promote"
          : action === "add" && credentialIdHash === undefined
            ? "device_handoff"
            : "device_enroll",
      reason: error.reason,
      resume: () => run("popup", false)
    })
  }
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
