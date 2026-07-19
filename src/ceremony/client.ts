import { bytesToHex, type Hex } from "viem"
import { getWalletPolicyHash } from "../policy"
import type {
  AuthorizeSliceWalletSessionParameters,
  AuthorizeSliceWalletSessionsParameters,
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameClient
} from "../types"
import {
  requireSliceWalletPopupGesture,
  SliceWalletUserGestureRequiredError
} from "./broker"
import {
  openSliceWalletCeremonyChannel,
  resolveSliceWalletCeremonyMode,
  waitForSliceWalletCeremonyMessage
} from "./popup"
import {
  parseSliceWalletCeremonyResponse,
  parseSliceWalletPermissionAuthorization
} from "./protocol"

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

const batchPolicyFingerprint = (session: SliceWalletFrameSession) =>
  JSON.stringify({
    checkout:
      session.checkout === undefined
        ? null
        : {
            allowanceUsdMicros: session.checkout.allowanceUsdMicros,
            budgetPeriodSec: session.checkout.budgetPeriodSec ?? null,
            coSignerAddress: session.checkout.coSignerAddress.toLowerCase()
          },
    expiresAt: session.expiresAt,
    policy: {
      calls: session.policy.calls.map((call) => ({
        parameterRules: call.parameterRules.map((rule) => ({
          condition: rule.condition,
          offset: rule.offset,
          params: rule.params.map((param) => param.toLowerCase())
        })),
        selector: call.selector.toLowerCase(),
        target: call.target.toLowerCase(),
        valueLimit: call.valueLimit.toString()
      })),
      grantKind: session.policy.grantKind,
      rateLimit: session.policy.rateLimit ?? null,
      validAfter: session.policy.validAfter,
      validUntil: session.policy.validUntil,
      version: session.policy.version
    }
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

export const assertSliceWalletBatchSessions = (
  sessions: readonly SliceWalletFrameSession[]
) => {
  const first = sessions[0]
  if (first === undefined || sessions.length > 8) {
    throw new Error("Wallet batch authorization requires 1 to 8 sessions.")
  }
  const chainIds = new Set<number>()
  const expectedPolicy = batchPolicyFingerprint(first)
  for (const session of sessions) {
    if (
      session.account.toLowerCase() !== first.account.toLowerCase() ||
      session.grantKind !== first.grantKind ||
      session.policy.account.toLowerCase() !== session.account.toLowerCase() ||
      session.policy.chainId !== session.chainId ||
      session.policy.grantKind !== session.grantKind ||
      chainIds.has(session.chainId)
    ) {
      throw new Error(
        "Wallet batch sessions must use one account, one grant kind, and distinct chains."
      )
    }
    if (batchPolicyFingerprint(session) !== expectedPolicy) {
      throw new Error(
        "Wallet batch sessions must disclose the same policy on every chain."
      )
    }
    chainIds.add(session.chainId)
  }
  return first
}

const getBatchCeremonyUrl = ({
  idOrigin,
  nonce,
  sessions
}: {
  idOrigin: string
  nonce: Hex
  sessions: readonly SliceWalletFrameSession[]
}) => {
  const first = assertSliceWalletBatchSessions(sessions)
  const url = new URL("/ceremony/grants", new URL(idOrigin).origin)
  url.searchParams.set("account", first.account)
  url.searchParams.set(
    "chainIds",
    sessions.map(({ chainId }) => String(chainId)).join(",")
  )
  url.searchParams.set("grantKind", first.grantKind)
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

const _waitForFrameAuthorization = async ({
  appOrigin,
  frameClient,
  session,
  timeoutMs
}: {
  appOrigin: string
  frameClient: SliceWalletSignerFrameClient
  session: SliceWalletFrameSession
  timeoutMs?: number
}) => {
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
  ceremonyBroker,
  ceremonyMode = "popup",
  document,
  idOrigin,
  popupReadyTimeoutMs = 10_000,
  session,
  timeoutMs = 5 * 60_000,
  window
}: AuthorizeSliceWalletSessionParameters) => {
  const normalizedIdOrigin = new URL(idOrigin).origin
  const nonce = randomNonce(window)
  const resolvedMode = resolveSliceWalletCeremonyMode({
    document,
    mode: ceremonyMode,
    path: "/ceremony/grant",
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
    const channel = await openSliceWalletCeremonyChannel({
      document,
      idOrigin: normalizedIdOrigin,
      mode,
      nonce,
      path: getCeremonyUrl({
        idOrigin: normalizedIdOrigin,
        nonce,
        session
      }).href,
      readyTimeoutMs: popupReadyTimeoutMs,
      window
    })
    return await waitForSliceWalletCeremonyMessage({
      parse: (value: SliceWalletProtocolValue) => {
        const response = parseSliceWalletCeremonyResponse(value)
        if (response.nonce !== nonce) {
          throw new Error("Wallet ceremony response nonce does not match.")
        }
        if (response.type === "slice-wallet:ceremony-error") {
          throw new Error(response.message)
        }
        if (response.type === "slice-wallet:popup-required") {
          throw new SliceWalletUserGestureRequiredError(response.reason)
        }
        if (response.type !== "slice-wallet:ceremony-authorization") {
          throw new Error("Wallet ceremony returned a batch response.")
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
  }
  try {
    return await run(resolvedMode, true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    return requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind: "grant",
      reason: error.reason,
      resume: () => run("popup", false)
    })
  }
}

export const authorizeSliceWalletSessions = async ({
  ceremonyBroker,
  ceremonyMode = "popup",
  document,
  idOrigin,
  popupReadyTimeoutMs = 10_000,
  sessions,
  timeoutMs = 5 * 60_000,
  window
}: AuthorizeSliceWalletSessionsParameters) => {
  assertSliceWalletBatchSessions(sessions)
  const normalizedIdOrigin = new URL(idOrigin).origin
  const nonce = randomNonce(window)
  const resolvedMode = resolveSliceWalletCeremonyMode({
    document,
    mode: ceremonyMode,
    path: "/ceremony/grants",
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
    const channel = await openSliceWalletCeremonyChannel({
      document,
      idOrigin: normalizedIdOrigin,
      mode,
      nonce,
      path: getBatchCeremonyUrl({
        idOrigin: normalizedIdOrigin,
        nonce,
        sessions
      }).href,
      readyTimeoutMs: popupReadyTimeoutMs,
      window
    })
    return await waitForSliceWalletCeremonyMessage({
      parse: (value: SliceWalletProtocolValue) => {
        const response = parseSliceWalletCeremonyResponse(value)
        if (response.nonce !== nonce) {
          throw new Error("Wallet ceremony response nonce does not match.")
        }
        if (response.type === "slice-wallet:ceremony-error") {
          throw new Error(response.message)
        }
        if (response.type === "slice-wallet:popup-required") {
          throw new SliceWalletUserGestureRequiredError(response.reason)
        }
        if (
          response.type !== "slice-wallet:ceremony-authorizations" ||
          response.authorizations.length !== sessions.length ||
          response.authorizations.some(
            (authorization, index) =>
              !isMatchingAuthorization(
                authorization,
                sessions[index] as SliceWalletFrameSession,
                window.location.origin
              )
          )
        ) {
          throw new Error(
            "Wallet ceremony returned invalid batch authorizations."
          )
        }
        return response.authorizations
      },
      port: channel.port,
      surface: channel.surface,
      timeoutMs
    })
  }
  try {
    return await run(resolvedMode, true)
  } catch (error) {
    if (!(error instanceof SliceWalletUserGestureRequiredError)) throw error
    return requireSliceWalletPopupGesture({
      broker: ceremonyBroker,
      kind: "grant",
      reason: error.reason,
      resume: () => run("popup", false)
    })
  }
}
