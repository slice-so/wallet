import { bytesToHex, type Hex } from "viem"
import { getWalletPolicyHash } from "../policy"
import type {
  AuthorizeSliceWalletSessionParameters,
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue
} from "../types"
import {
  openSliceWalletCeremonyChannel,
  resolveSliceWalletCeremonyMode,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import {
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
  ceremonyMode = "popup",
  document,
  frameClient,
  idOrigin,
  popupReadyTimeoutMs = 10_000,
  session,
  timeoutMs = 5 * 60_000,
  window
}: AuthorizeSliceWalletSessionParameters) => {
  const normalizedIdOrigin = new URL(idOrigin).origin
  const nonce = randomNonce(window)
  const continueFromFrame = async () => {
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

  const resolvedMode = resolveSliceWalletCeremonyMode({
    document,
    mode: ceremonyMode,
    window
  })
  if (
    resolvedMode === "popup" &&
    window.navigator.userActivation?.isActive === false
  ) {
    return continueFromFrame()
  }

  let channel: Awaited<ReturnType<typeof openSliceWalletCeremonyChannel>>
  try {
    channel = await openSliceWalletCeremonyChannel({
      document,
      idOrigin: normalizedIdOrigin,
      mode: resolvedMode,
      nonce,
      path: getCeremonyUrl({
        idOrigin: normalizedIdOrigin,
        nonce,
        session
      }).href,
      readyTimeoutMs: popupReadyTimeoutMs,
      window
    })
  } catch {
    return continueFromFrame()
  }

  try {
    return await waitForSliceWalletCeremonyMessage({
      parse: (value: SliceWalletProtocolValue) => {
        const response = parseSliceWalletCeremonyResponse(value)
        if (response.nonce !== nonce) {
          throw new Error("Wallet ceremony response nonce does not match.")
        }
        if (response.type === "slice-wallet:ceremony-error") {
          throw response.code === "bridge_unavailable"
            ? new SliceWalletBridgeUnavailableError(response.message)
            : new Error(response.message)
        }
        if (
          !isMatchingAuthorization(
            response.authorization,
            session,
            window.location.origin
          )
        ) {
          throw new Error("Wallet ceremony returned an invalid authorization.")
        }
        return response.authorization
      },
      port: channel.port,
      surface: channel.surface,
      timeoutMs
    })
  } catch (error) {
    if (!(error instanceof SliceWalletBridgeUnavailableError)) throw error
    return continueFromFrame()
  }
}
