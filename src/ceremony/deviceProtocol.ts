import { type Address, type Hex, hexToBytes, isAddress, isHex } from "viem"
import type {
  SliceWalletCeremonyDeviceResponse,
  SliceWalletProtocolValue
} from "../types"
import { parseSliceWalletCeremonyResponse } from "./protocol"

const isRecord = (
  value: SliceWalletProtocolValue
): value is { readonly [key: string]: SliceWalletProtocolValue } =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const parseSliceWalletCeremonyDeviceResponse = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyDeviceResponse => {
  if (!isRecord(value)) throw new Error("Device ceremony response is invalid.")
  if (value.type !== "slice-wallet:ceremony-device") {
    const response = parseSliceWalletCeremonyResponse(value)
    if (
      response.type !== "slice-wallet:ceremony-error" &&
      response.type !== "slice-wallet:popup-required"
    ) {
      throw new Error("Device ceremony response is invalid.")
    }
    return response
  }
  const hasRevocationNotified = Object.hasOwn(value, "revocationNotified")
  if (
    Object.keys(value).length !== (hasRevocationNotified ? 10 : 9) ||
    value.version !== 1 ||
    (value.action !== "add" &&
      value.action !== "promote" &&
      value.action !== "remove") ||
    typeof value.account !== "string" ||
    !isAddress(value.account) ||
    typeof value.chainId !== "number" ||
    !Number.isSafeInteger(value.chainId) ||
    value.chainId <= 0 ||
    typeof value.credentialIdHash !== "string" ||
    !isHex(value.credentialIdHash, { strict: true }) ||
    hexToBytes(value.credentialIdHash).length !== 32 ||
    typeof value.nonce !== "string" ||
    !isHex(value.nonce, { strict: true }) ||
    hexToBytes(value.nonce).length !== 32 ||
    typeof value.permissionId !== "string" ||
    !isHex(value.permissionId, { strict: true }) ||
    hexToBytes(value.permissionId).length !== 4 ||
    (hasRevocationNotified &&
      (value.action !== "promote" ||
        typeof value.revocationNotified !== "boolean")) ||
    (value.userOperationHash !== null &&
      (typeof value.userOperationHash !== "string" ||
        !isHex(value.userOperationHash, { strict: true }) ||
        hexToBytes(value.userOperationHash).length !== 32))
  ) {
    throw new Error("Device ceremony response is invalid.")
  }
  return {
    account: value.account as Address,
    action: value.action,
    chainId: value.chainId,
    credentialIdHash: value.credentialIdHash as Hex,
    nonce: value.nonce as Hex,
    permissionId: value.permissionId as Hex,
    ...(hasRevocationNotified
      ? { revocationNotified: value.revocationNotified as boolean }
      : {}),
    type: "slice-wallet:ceremony-device",
    userOperationHash: value.userOperationHash as Hex | null,
    version: 1
  }
}
