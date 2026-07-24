import {
  type Address,
  getAddress,
  isAddress,
  maxUint256,
  numberToHex
} from "viem"
import { maximumBrowserGenericGrantTtlSec } from "../constants"
import type {
  SliceWalletGenericPermission,
  SliceWalletGenericPermissionRule,
  SliceWalletGrantPermissionsRequest,
  SliceWalletPermissionRequestInput
} from "../types"

const normalizeAddress = (value: Address, label: string) => {
  if (!isAddress(value)) throw new Error(`${label} must be an address.`)
  return getAddress(value).toLowerCase() as Address
}

const normalizeAmount = (value: bigint, label: string) => {
  if (value <= 0n || value > maxUint256) {
    throw new Error(`${label} must be between 1 and uint256 maximum.`)
  }
  return numberToHex(value)
}

const withRequired = (required: boolean | undefined): { required?: boolean } =>
  required === undefined ? {} : { required }

export const nativeTransferPermission = ({
  maximumValue,
  recipient,
  required
}: {
  maximumValue: bigint
  recipient: Address
  required?: boolean
}): SliceWalletGenericPermissionRule => ({
  data: {
    maximumValue: normalizeAmount(maximumValue, "Maximum native value"),
    recipient: normalizeAddress(recipient, "Native transfer recipient"),
    template: "native-transfer"
  },
  ...withRequired(required),
  type: "slice-call"
})

export const erc20TransferPermission = ({
  maximumAmount,
  recipient,
  required,
  token
}: {
  maximumAmount: bigint
  recipient: Address
  required?: boolean
  token: Address
}): SliceWalletGenericPermissionRule => ({
  data: {
    maximumAmount: normalizeAmount(maximumAmount, "Maximum token amount"),
    recipient: normalizeAddress(recipient, "Token recipient"),
    template: "erc20-transfer",
    token: normalizeAddress(token, "Token address")
  },
  ...withRequired(required),
  type: "slice-call"
})

export const erc20ApprovePermission = ({
  maximumAmount,
  required,
  spender,
  token
}: {
  maximumAmount: bigint
  required?: boolean
  spender: Address
  token: Address
}): SliceWalletGenericPermissionRule => ({
  data: {
    maximumAmount: normalizeAmount(maximumAmount, "Maximum token amount"),
    spender: normalizeAddress(spender, "Token spender"),
    template: "erc20-approve",
    token: normalizeAddress(token, "Token address")
  },
  ...withRequired(required),
  type: "slice-call"
})

export const erc20TransferFromPermission = ({
  account,
  maximumAmount,
  recipient,
  required,
  token
}: {
  account: Address
  maximumAmount: bigint
  recipient: Address
  required?: boolean
  token: Address
}): SliceWalletGenericPermissionRule => ({
  data: {
    account: normalizeAddress(account, "Token source account"),
    maximumAmount: normalizeAmount(maximumAmount, "Maximum token amount"),
    recipient: normalizeAddress(recipient, "Token recipient"),
    template: "erc20-transfer-from",
    token: normalizeAddress(token, "Token address")
  },
  ...withRequired(required),
  type: "slice-call"
})

export const createSliceWalletPermissionRequest = (
  { expiry, rateLimit, rules }: SliceWalletPermissionRequestInput,
  now = Math.floor(Date.now() / 1_000)
): SliceWalletGrantPermissionsRequest => {
  if (
    !Number.isSafeInteger(expiry) ||
    expiry <= now ||
    expiry - now > maximumBrowserGenericGrantTtlSec
  ) {
    throw new Error("Permission expiry must be within the next 30 days.")
  }
  if (rules.length < 1 || rules.length > 16) {
    throw new Error("A permission request requires between 1 and 16 rules.")
  }
  if (
    !Number.isSafeInteger(rateLimit.count) ||
    rateLimit.count < 1 ||
    rateLimit.count > 100 ||
    !Number.isSafeInteger(rateLimit.intervalSec) ||
    rateLimit.intervalSec < 60 ||
    rateLimit.intervalSec > expiry - now
  ) {
    throw new Error(
      "Rate limit must allow 1 to 100 operations over 60 seconds up to the grant lifetime."
    )
  }
  const policy = {
    data: { ...rateLimit },
    type: "rate-limit" as const
  }
  return {
    expiry,
    permissions: rules.map(
      (rule): SliceWalletGenericPermission => ({
        ...rule,
        policies: [policy]
      })
    )
  }
}
