import type { Address } from "viem"
import type { SliceWalletProtocolValue } from "../protocol/index"

export type SliceWalletCeremonyExtensionInput = {
  prepare?: () => Promise<SliceWalletProtocolValue>
  prepared?: SliceWalletProtocolValue
  signal?: AbortSignal
}

export type SliceWalletCeremonyExtensionRequestMessage =
  | {
      status: "none" | "preparing"
      type: "slice-wallet:ceremony-extension-request"
    }
  | {
      request: SliceWalletProtocolValue
      status: "prepared"
      type: "slice-wallet:ceremony-extension-request"
    }
  | {
      status: "preparation_failed"
      type: "slice-wallet:ceremony-extension-request"
    }

export type SliceWalletExtensionConnectResult = {
  account: Address
  extension?: SliceWalletProtocolValue
}
