import { bytesToHex, type Hex } from "viem"
import { getWalletPolicyHash } from "../policy"
import type {
  AuthorizeSliceWalletSessionParameters,
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue
} from "../types"
import {
  parseSliceWalletCeremonyReadyMessage,
  parseSliceWalletCeremonyResponse,
  parseSliceWalletPermissionAuthorization
} from "./protocol"

class SliceWalletBridgeUnavailableError extends Error {}

const randomNonce = (window: Window) => {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

const sessionKey = (session: SliceWalletFrameSession) => ({
  account: session.account,
  chainId: session.chainId,
  grantKind: session.grantKind
})

const getCeremonyUrl = ({
  idOrigin,
  nonce,
  session
}: {
  idOrigin: string
  nonce: Hex
  session: SliceWalletFrameSession
}) => {
  const url = new URL("/ceremony/grant", new URL(idOrigin).origin)
  url.searchParams.set("account", session.account)
  url.searchParams.set("chainId", String(session.chainId))
  url.searchParams.set("grantKind", session.grantKind)
  url.searchParams.set("nonce", nonce)
  return url
}

const isMatchingAuthorization = (
  authorization: SliceWalletPermissionAuthorization,
  expected: SliceWalletFrameSession,
  appOrigin: string
) => {
  const session = authorization.session
  const checkoutMatches =
    expected.checkout === undefined
      ? session.checkout === undefined
      : session.checkout !== undefined &&
        session.checkout.allowanceUsdMicros ===
          expected.checkout.allowanceUsdMicros &&
        session.checkout.budgetPeriodSec ===
          expected.checkout.budgetPeriodSec &&
        session.checkout.coSignerAddress.toLowerCase() ===
          expected.checkout.coSignerAddress.toLowerCase()
  const executionGrantValid =
    expected.grantKind === "generic"
      ? authorization.executionGrant === undefined
      : authorization.executionGrant !== undefined &&
        authorization.executionGrant.expiresAt === expected.expiresAt
  return (
    checkoutMatches &&
    executionGrantValid &&
    new URL(authorization.appOrigin).origin === appOrigin &&
    session.account.toLowerCase() === expected.account.toLowerCase() &&
    session.chainId === expected.chainId &&
    session.grantKind === expected.grantKind &&
    session.expiresAt === expected.expiresAt &&
    session.permissionId.toLowerCase() ===
      expected.permissionId.toLowerCase() &&
    session.publicKey.toLowerCase() === expected.publicKey.toLowerCase() &&
    session.signerId.toLowerCase() === expected.signerId.toLowerCase() &&
    getWalletPolicyHash(session.policy) === getWalletPolicyHash(expected.policy)
  )
}

const requestPopupAuthorization = ({
  expectedOrigin,
  nonce,
  popup,
  session,
  timeoutMs,
  window
}: {
  expectedOrigin: string
  nonce: Hex
  popup: WindowProxy
  session: SliceWalletFrameSession
  timeoutMs: number
  window: Window
}) =>
  new Promise<SliceWalletPermissionAuthorization>((resolve, reject) => {
    const readyTimeout = setTimeout(
      () => {
        window.removeEventListener("message", onReady)
        reject(
          new SliceWalletBridgeUnavailableError(
            "Wallet popup bridge timed out."
          )
        )
      },
      Math.min(timeoutMs, 10_000)
    )
    const onReady = (event: MessageEvent<SliceWalletProtocolValue>) => {
      if (event.source !== popup || event.origin !== expectedOrigin) {
        return
      }
      try {
        parseSliceWalletCeremonyReadyMessage(event.data)
      } catch {
        return
      }
      clearTimeout(readyTimeout)
      window.removeEventListener("message", onReady)
      const channel = new MessageChannel()
      const authorizationTimeout = setTimeout(() => {
        channel.port1.close()
        reject(new Error("Wallet authorization timed out."))
      }, timeoutMs)
      channel.port1.addEventListener(
        "message",
        (responseEvent: MessageEvent<SliceWalletProtocolValue>) => {
          clearTimeout(authorizationTimeout)
          channel.port1.close()
          let response: ReturnType<typeof parseSliceWalletCeremonyResponse>
          try {
            response = parseSliceWalletCeremonyResponse(responseEvent.data)
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new Error("Wallet ceremony returned an invalid response.")
            )
            return
          }
          if (response.nonce !== nonce) {
            reject(new Error("Wallet ceremony response nonce does not match."))
            return
          }
          if (response.type === "slice-wallet:ceremony-error") {
            reject(
              response.code === "bridge_unavailable"
                ? new SliceWalletBridgeUnavailableError(response.message)
                : new Error(response.message)
            )
            return
          }
          if (
            response.type !== "slice-wallet:ceremony-authorization" ||
            !isMatchingAuthorization(
              response.authorization,
              session,
              window.location.origin
            )
          ) {
            reject(
              new Error("Wallet ceremony returned an invalid authorization.")
            )
            return
          }
          resolve(response.authorization)
        },
        { once: true }
      )
      channel.port1.start()
      popup.postMessage(
        {
          nonce,
          type: "slice-wallet:ceremony-connect",
          version: 1
        },
        expectedOrigin,
        [channel.port2]
      )
    }
    window.addEventListener("message", onReady)
  })

const waitForFrameAuthorization = async ({
  appOrigin,
  frameClient,
  session,
  timeoutMs
}: Pick<
  AuthorizeSliceWalletSessionParameters,
  "frameClient" | "session" | "timeoutMs"
> & { appOrigin: string }) => {
  const deadline = Date.now() + (timeoutMs ?? 5 * 60_000)
  while (Date.now() < deadline) {
    const result = await frameClient.request({
      method: "consumeAuthorization",
      params: sessionKey(session)
    })
    if (result !== null && typeof result === "object") {
      try {
        const authorization = parseSliceWalletPermissionAuthorization(
          result as SliceWalletProtocolValue
        )
        if (isMatchingAuthorization(authorization, session, appOrigin)) {
          return authorization
        }
      } catch {
        // Keep polling: a stale or malformed one-shot result is not authority.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error("Wallet frame authorization timed out.")
}

export const authorizeSliceWalletSession = async ({
  frameClient,
  idOrigin,
  session,
  timeoutMs = 5 * 60_000,
  window
}: AuthorizeSliceWalletSessionParameters) => {
  const normalizedIdOrigin = new URL(idOrigin).origin
  const nonce = randomNonce(window)
  const popup = window.open(
    getCeremonyUrl({ idOrigin: normalizedIdOrigin, nonce, session }),
    "slice-wallet-ceremony",
    "popup,width=560,height=720"
  )
  if (popup === null) throw new Error("Slice Wallet popup was blocked.")

  try {
    const authorization = await requestPopupAuthorization({
      expectedOrigin: normalizedIdOrigin,
      nonce,
      popup,
      session,
      timeoutMs: Math.min(timeoutMs, 10_000),
      window
    })
    popup.close()
    return authorization
  } catch (error) {
    popup.close()
    if (!(error instanceof SliceWalletBridgeUnavailableError)) throw error
    frameClient.setContinuationVisible(true)
    try {
      return await waitForFrameAuthorization({
        appOrigin: window.location.origin,
        frameClient,
        session,
        timeoutMs
      })
    } finally {
      frameClient.setContinuationVisible(false)
    }
  }
}
