import type { SliceWalletProtocolValue } from "../protocol/index"
import { createSliceWalletRegistryClient } from "../registry"
import type {
  ConnectSliceWalletAccountParameters,
  RequestSliceWalletCeremonyExtensionParameters,
  SliceWalletCeremonyAccountMessage,
  SliceWalletCeremonyExtensionRequestMessage,
  SliceWalletConnectedAccount
} from "../types"
import { toSliceWalletCeremonyError } from "../userRejectedRequest"
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

const runSliceWalletAccountCeremony = async ({
  ceremonyBroker,
  ceremonyMode = "popup",
  chainId,
  document,
  fetch,
  idOrigin,
  extension,
  timeoutMs,
  window,
  requestedAccount
}: ConnectSliceWalletAccountParameters & {
  requestedAccount?: `0x${string}`
}): Promise<SliceWalletConnectedAccount> => {
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
      path: `/ceremony/connect?chainId=${chainId}${
        requestedAccount === undefined
          ? ""
          : `&account=${requestedAccount}&consentOnly=1`
      }`,
      popupName: "slice-wallet-connect",
      window
    })
    const resultPromise = waitForSliceWalletCeremonyMessage({
      parse: (value: SliceWalletProtocolValue) => {
        const message = parseSliceWalletCeremonyAccountResponse(value)
        if (message.nonce !== nonce) {
          throw new Error("Slice Wallet account response nonce does not match.")
        }
        if (message.type === "slice-wallet:ceremony-error") {
          throw toSliceWalletCeremonyError(message)
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
    void resultPromise.catch(() => undefined)
    if (extension === undefined) {
      port.postMessage({
        status: "none",
        type: "slice-wallet:ceremony-extension-request"
      } satisfies SliceWalletCeremonyExtensionRequestMessage)
    } else {
      if (
        (extension.prepare === undefined) ===
        (extension.prepared === undefined)
      ) {
        throw new Error(
          "Ceremony extensions require exactly one preparation mode."
        )
      }
      port.postMessage({
        status: "preparing",
        type: "slice-wallet:ceremony-extension-request"
      } satisfies SliceWalletCeremonyExtensionRequestMessage)
      const preparationPromise = (async () => {
        try {
          return extension.prepared ?? (await extension.prepare?.())
        } catch {
          return undefined
        }
      })()
      const terminalResultPromise = resultPromise.then((result) =>
        result.extension !== undefined
          ? { result, type: "result" as const }
          : new Promise<never>(() => undefined)
      )
      const first = await Promise.race([
        preparationPromise.then((preparation) => ({
          preparation,
          type: "preparation" as const
        })),
        terminalResultPromise
      ])
      if (first.type === "result") return first.result
      const preparation = first.preparation
      if (preparation === undefined || extension.signal?.aborted === true) {
        port.postMessage({
          status: "preparation_failed",
          type: "slice-wallet:ceremony-extension-request"
        } satisfies SliceWalletCeremonyExtensionRequestMessage)
      } else {
        port.postMessage({
          request: preparation,
          status: "prepared",
          type: "slice-wallet:ceremony-extension-request"
        } satisfies SliceWalletCeremonyExtensionRequestMessage)
      }
    }
    const result = await resultPromise
    if (result.extension !== undefined && extension === undefined) {
      throw new Error(
        "Slice Wallet returned an unrequested ceremony extension."
      )
    }
    return result
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
  }).lookupCredential({
    accountAddress: account.account,
    credentialIdHash: account.credentialIdHash
  })
  if (
    credential === null ||
    credential.accountIndex !== account.accountIndex ||
    credential.accountAddress.toLowerCase() !== account.account.toLowerCase() ||
    credential.credentialIdHash.toLowerCase() !==
      account.credentialIdHash.toLowerCase()
  ) {
    throw new Error("Slice Wallet registry record does not match the account.")
  }
  if (
    requestedAccount !== undefined &&
    credential.accountAddress.toLowerCase() !== requestedAccount.toLowerCase()
  ) {
    throw new Error("Slice Wallet ceremony used a different account.")
  }
  return {
    ...credential,
    ...(account.recovery === undefined ? {} : { recovery: account.recovery }),
    ...(account.extension === undefined ? {} : { extension: account.extension })
  }
}

export const connectSliceWalletAccount = (
  parameters: ConnectSliceWalletAccountParameters
) => runSliceWalletAccountCeremony(parameters)

export const requestSliceWalletCeremonyExtension = async ({
  account,
  ...parameters
}: RequestSliceWalletCeremonyExtensionParameters) => {
  const connected = await runSliceWalletAccountCeremony({
    ...parameters,
    requestedAccount: account
  })
  if (connected.extension === undefined) {
    throw new Error("Slice Wallet ceremony extension returned no result.")
  }
  return connected.extension
}
