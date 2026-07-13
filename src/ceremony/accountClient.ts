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
import { parseSliceWalletCeremonyAccountResponse } from "./protocol"

export const connectSliceWalletAccount = async ({
  ceremonyMode = "popup",
  chainId,
  document,
  fetch,
  idOrigin,
  timeoutMs,
  window
}: ConnectSliceWalletAccountParameters): Promise<SliceWalletConnectedAccount> => {
  const nonce = createSliceWalletCeremonyNonce(window)
  const { port, surface } = await openSliceWalletCeremonyChannel({
    document,
    idOrigin,
    mode: ceremonyMode,
    nonce,
    path: `/ceremony/connect?chainId=${chainId}`,
    window
  })
  const account = await waitForSliceWalletCeremonyMessage({
    parse: (value: SliceWalletProtocolValue) => {
      const message = parseSliceWalletCeremonyAccountResponse(value)
      if (message.nonce !== nonce) {
        throw new Error("Slice Wallet account response nonce does not match.")
      }
      if (message.type === "slice-wallet:ceremony-error") {
        throw new Error(message.message)
      }
      return message
    },
    port,
    surface,
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
