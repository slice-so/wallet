import { hexToBytes, isAddress, isHex } from "viem"
import { getSliceWalletP256SignerId } from "../p256Server"
import {
  getWalletPermissionId,
  parseSerializedWalletPolicyDescriptor,
  serializeWalletPolicyDescriptor
} from "../policy"
import type { SliceWalletExecutionSessionDescriptor } from "../types/commerce"
import type { SliceWalletFrameSession } from "../types/frame"

export const serializeSliceWalletExecutionSessionDescriptor = (
  session: SliceWalletFrameSession,
  enableNonce: string
): SliceWalletExecutionSessionDescriptor => {
  if (session.grantKind === "generic") {
    throw new Error("Generic sessions are not execution delegations.")
  }
  return {
    account: session.account,
    chainId: session.chainId,
    ...(session.checkout === undefined ? {} : { checkout: session.checkout }),
    enableNonce: BigInt(enableNonce).toString(),
    expiresAt: session.expiresAt,
    grantKind: session.grantKind,
    permissionId: session.permissionId,
    policy: serializeWalletPolicyDescriptor(session.policy),
    publicKey: session.publicKey,
    signerId: session.signerId
  }
}

export const parseSliceWalletExecutionSessionDescriptor = (
  descriptor: SliceWalletExecutionSessionDescriptor
): SliceWalletFrameSession => {
  const policy = parseSerializedWalletPolicyDescriptor(descriptor.policy)
  if (
    !isAddress(descriptor.account) ||
    !Number.isSafeInteger(descriptor.chainId) ||
    descriptor.chainId <= 0 ||
    !Number.isSafeInteger(descriptor.expiresAt) ||
    descriptor.expiresAt <= 0 ||
    !/^\d+$/.test(descriptor.enableNonce) ||
    BigInt(descriptor.enableNonce).toString() !== descriptor.enableNonce ||
    !isHex(descriptor.permissionId, { strict: true }) ||
    hexToBytes(descriptor.permissionId).length !== 4 ||
    !isHex(descriptor.publicKey, { strict: true }) ||
    hexToBytes(descriptor.publicKey).length !== 65 ||
    !isAddress(descriptor.signerId) ||
    policy.account.toLowerCase() !== descriptor.account.toLowerCase() ||
    policy.chainId !== descriptor.chainId ||
    policy.grantKind !== descriptor.grantKind ||
    policy.validUntil !== descriptor.expiresAt ||
    getSliceWalletP256SignerId(descriptor.publicKey).toLowerCase() !==
      descriptor.signerId.toLowerCase() ||
    getWalletPermissionId(policy, descriptor.signerId).toLowerCase() !==
      descriptor.permissionId.toLowerCase() ||
    (descriptor.grantKind === "checkout") !==
      (descriptor.checkout !== undefined) ||
    (descriptor.checkout !== undefined &&
      (!/^\d+$/.test(descriptor.checkout.allowanceUsdMicros) ||
        !isAddress(descriptor.checkout.coSignerAddress) ||
        (descriptor.checkout.budgetPeriodSec !== undefined &&
          (!Number.isSafeInteger(descriptor.checkout.budgetPeriodSec) ||
            descriptor.checkout.budgetPeriodSec <= 0))))
  ) {
    throw new Error("Slice wallet predecessor descriptor is invalid.")
  }
  return {
    account: descriptor.account,
    chainId: descriptor.chainId,
    ...(descriptor.checkout === undefined
      ? {}
      : { checkout: descriptor.checkout }),
    expiresAt: descriptor.expiresAt,
    grantKind: descriptor.grantKind,
    permissionId: descriptor.permissionId,
    policy,
    publicKey: descriptor.publicKey,
    signerId: descriptor.signerId
  }
}
