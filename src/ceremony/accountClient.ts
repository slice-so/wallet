import { createSliceWalletRegistryClient } from "../registry"
import type {
  ConnectSliceWalletAccountParameters,
  SliceWalletConnectedAccount,
  SliceWalletProtocolValue
} from "../types"
import {
  createSliceWalletCeremonyNonce,
  openSliceWalletCeremonyChannel,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import { parseSliceWalletCeremonyAccountMessage } from "./protocol"

export const connectSliceWalletAccount = async ({
  fetch,
  idOrigin,
  timeoutMs = 5 * 60_000,
  window
}: ConnectSliceWalletAccountParameters): Promise<SliceWalletConnectedAccount> => {
  const nonce = createSliceWalletCeremonyNonce(window)
  const { popup, port } = await openSliceWalletCeremonyChannel({
    idOrigin,
    nonce,
    path: "/ceremony/connect",
    window
  })
  const account = await waitForSliceWalletCeremonyMessage({
    parse: (value: SliceWalletProtocolValue) => {
      const message = parseSliceWalletCeremonyAccountMessage(value)
      if (message.nonce !== nonce) {
        throw new Error("Slice Wallet account response nonce does not match.")
      }
      return message
    },
    popup,
    port,
    timeoutMs
  })
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
