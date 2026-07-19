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
  resolveSliceWalletCeremonyMode,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import { parseSliceWalletCeremonyAccountResponse } from "./protocol"

export const connectSliceWalletAccount = async ({
  ceremonyBroker,
  ceremonyMode = "popup",
  chainId,
  document,
  fetch,
  idOrigin,
  timeoutMs,
  window
}: ConnectSliceWalletAccountParameters): Promise<SliceWalletConnectedAccount> => {
  const nonce = createSliceWalletCeremonyNonce(window)
  const resolvedMode = resolveSliceWalletCeremonyMode({
    brokerAvailable: ceremonyBroker !== undefined,
    document,
    mode: ceremonyMode,
    path: "/ceremony/connect",
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
    account = await run(resolvedMode, true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    account = await requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind: "connect",
      reason: error.reason,
      resume: () => run("popup", false)
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
