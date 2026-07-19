import { createSliceWalletRegistryClient } from "../registry"
import type {
  ConnectSliceWalletAccountParameters,
  SliceWalletCeremonyAccountMessage,
  SliceWalletConnectedAccount,
  SliceWalletProtocolValue
} from "../types"
import {
  requireSliceWalletPopupGesture,
  SliceWalletUserGestureRequiredError
} from "./broker"
import {
  createSliceWalletCeremonyNonce,
  openSliceWalletCeremonyChannel,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import { parseSliceWalletCeremonyAccountResponse } from "./protocol"

export const connectSliceWalletAccount = async ({
  ceremonyBroker,
  chainId,
  fetch,
  idOrigin,
  timeoutMs,
  window
}: ConnectSliceWalletAccountParameters): Promise<SliceWalletConnectedAccount> => {
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
      mode: "popup",
      nonce,
      path: `/ceremony/connect?chainId=${chainId}`,
      window
    })
    return waitForSliceWalletCeremonyMessage({
      parse: (value: SliceWalletProtocolValue) => {
        const message = parseSliceWalletCeremonyAccountResponse(value)
        if (message.nonce !== nonce) {
          throw new Error("Slice Wallet account response nonce does not match.")
        }
        if (message.type === "slice-wallet:ceremony-error") {
          throw new Error(message.message)
        }
        if (message.type === "slice-wallet:popup-required") {
          throw new SliceWalletUserGestureRequiredError(message.reason)
        }
        return message
      },
      port,
      surface,
      timeoutMs
    })
  }
  let account: SliceWalletCeremonyAccountMessage
  try {
    account = await run(true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    account = await requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind: "connect",
      reason: error.reason,
      resume: () => run(false)
    })
  }
  const credential = await createSliceWalletRegistryClient({
    baseUrl: new URL(idOrigin).origin,
    ...(fetch === undefined ? {} : { fetch })
  }).getCredential(account.credentialIdHash)
  if (
    credential === null ||
    credential.accountAddress.toLowerCase() !== account.account.toLowerCase() ||
    credential.credentialIdHash.toLowerCase() !==
      account.credentialIdHash.toLowerCase()
  ) {
    throw new Error("Slice Wallet registry record does not match the account.")
  }
  return {
    ...credential,
    ...(account.recovery === undefined ? {} : { recovery: account.recovery })
  }
}
