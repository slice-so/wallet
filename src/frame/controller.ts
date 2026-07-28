import {
  bytesToHex,
  type Hex,
  hexToBytes,
  isAddress,
  isAddressEqual,
  isHex,
  stringToBytes
} from "viem"
import { getUserOperationHash } from "viem/account-abstraction"
import { parseSliceWalletFrameSession } from "../ceremony/protocol"
import {
  maximumBrowserGenericGrantTtlSec,
  sliceWalletDefaultRpId,
  sliceWalletEntryPoint
} from "../constants"
import {
  assertSliceStoreManagementPolicyDescriptor,
  bindSliceStoreManagementPolicySigner
} from "../execution/commerce/policies"
import { assertSliceWalletExecutionSafety } from "../executionSafety"
import {
  encodeSliceWalletSyntheticWebAuthnSignature,
  generateSliceWalletP256KeyPair,
  hashSliceWalletWeightedP256Proposal,
  signSliceWalletP256
} from "../p256"
import {
  assertWalletCallsMatchPolicy,
  getWalletPermissionId,
  getWalletPolicyHash
} from "../policy"
import type {
  SliceWalletBridgeChallenge,
  SliceWalletBridgeGrantProofRequest,
  SliceWalletBridgeGrantProofResponse,
  SliceWalletBridgeRecord,
  SliceWalletBridgeRegistrationProofRequest,
  SliceWalletBridgeRegistrationProofResponse,
  SliceWalletBridgeUnlockChallenge,
  SliceWalletBridgeUnlockRequest,
  SliceWalletFrameConnectRequest,
  SliceWalletFrameRequest,
  SliceWalletFrameResponse,
  SliceWalletFrameSession,
  SliceWalletFrameSessionKey,
  SliceWalletProtocolValue,
  SliceWalletSignerFrameControllerOptions,
  SliceWalletStoredSession,
  SliceWalletWindowMessage
} from "../types"
import {
  formatSliceWalletExecutionGrantMessage,
  hashSliceWalletAppPermissionRegistrationFields,
  hashSliceWalletCoSignRequest,
  hashSliceWalletSessionRequest
} from "./messages"
import { parseSliceWalletFrameRequest } from "./protocol"

const isConnectRequest = (
  value: SliceWalletProtocolValue
): value is SliceWalletFrameConnectRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false
  const input = value as { readonly [key: string]: SliceWalletProtocolValue }
  return (
    Object.keys(input).length === 3 &&
    typeof input.id === "string" &&
    input.method === "connect" &&
    input.version === 1
  )
}

const isBridgeChallenge = (
  value: SliceWalletProtocolValue
): value is SliceWalletBridgeChallenge => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false
  const input = value as { readonly [key: string]: SliceWalletProtocolValue }
  const grantKind = input.grantKind
  return (
    Object.keys(input).length === 6 &&
    input.type === "slice-wallet:bridge-challenge" &&
    input.version === 1 &&
    typeof input.account === "string" &&
    isAddress(input.account) &&
    typeof input.chainId === "number" &&
    Number.isSafeInteger(input.chainId) &&
    input.chainId > 0 &&
    (grantKind === "checkout" ||
      grantKind === "generic" ||
      grantKind === "management") &&
    typeof input.nonce === "string" &&
    isHex(input.nonce, { strict: true }) &&
    hexToBytes(input.nonce).length === 32
  )
}

const isBridgeUnlockChallenge = (
  value: SliceWalletProtocolValue
): value is SliceWalletBridgeUnlockChallenge => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const input = value as { readonly [key: string]: SliceWalletProtocolValue }
  return (
    Object.keys(input).length === 4 &&
    input.type === "slice-wallet:bridge-unlock-challenge" &&
    input.version === 1 &&
    typeof input.account === "string" &&
    isAddress(input.account) &&
    typeof input.nonce === "string" &&
    isHex(input.nonce, { strict: true }) &&
    hexToBytes(input.nonce).length === 32
  )
}

const parseBridgeUnlockRequest = (
  value: SliceWalletProtocolValue
): SliceWalletBridgeUnlockRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bridge unlock request must be an object.")
  }
  const input = value as { readonly [key: string]: SliceWalletProtocolValue }
  if (
    Object.keys(input).length !== 4 ||
    input.type !== "slice-wallet:bridge-unlock" ||
    input.version !== 1 ||
    typeof input.account !== "string" ||
    !isAddress(input.account) ||
    typeof input.nonce !== "string" ||
    !isHex(input.nonce, { strict: true }) ||
    hexToBytes(input.nonce).length !== 32
  ) {
    throw new Error("Bridge unlock request is invalid.")
  }
  return {
    account: input.account,
    nonce: input.nonce,
    type: "slice-wallet:bridge-unlock",
    version: 1
  }
}

const parseBridgeGrantProofRequest = (
  value: SliceWalletProtocolValue
): SliceWalletBridgeGrantProofRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bridge grant proof request must be an object.")
  }
  const input = value as {
    readonly [key: string]: SliceWalletProtocolValue
  }
  if (
    Object.keys(input).length !== 6 ||
    input.type !== "slice-wallet:bridge-sign-grant" ||
    input.version !== 1
  ) {
    throw new Error("Bridge grant proof request is invalid.")
  }
  const parsed = parseSliceWalletFrameRequest({
    id: "bridge",
    method: "signGrantProof",
    params: {
      expiresAt: input.expiresAt ?? null,
      nonce: input.nonce ?? null,
      scopes: input.scopes ?? null,
      session: input.session ?? null
    },
    version: 1
  })
  if (parsed.method !== "signGrantProof") {
    throw new Error("Bridge grant proof request is invalid.")
  }
  if (hexToBytes(parsed.params.nonce).length !== 32) {
    throw new Error("Bridge grant nonce must be 32 bytes.")
  }
  if (parsed.params.scopes.length === 0) {
    throw new Error("Bridge grant proof requires at least one scope.")
  }
  return {
    ...parsed.params,
    type: "slice-wallet:bridge-sign-grant",
    version: 1
  }
}

const isBridgeRegistrationProofRequest = (value: SliceWalletProtocolValue) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  return Reflect.get(value, "type") === "slice-wallet:bridge-sign-registration"
}

const parseBridgeRegistrationProofRequest = (
  value: SliceWalletProtocolValue
): SliceWalletBridgeRegistrationProofRequest => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bridge registration proof request must be an object.")
  }
  const input = value as {
    readonly [key: string]: SliceWalletProtocolValue
  }
  if (
    Object.keys(input).length !== 8 ||
    input.type !== "slice-wallet:bridge-sign-registration" ||
    input.version !== 1 ||
    input.action !== "register" ||
    typeof input.accountIndex !== "number" ||
    !Number.isSafeInteger(input.accountIndex) ||
    input.accountIndex < 0 ||
    input.accountIndex > 31 ||
    typeof input.challengeExpiresAt !== "number" ||
    !Number.isSafeInteger(input.challengeExpiresAt) ||
    input.challengeExpiresAt <= 0
  ) {
    throw new Error("Bridge registration proof request is invalid.")
  }
  const canonicalBytes32 = (field: "challenge" | "requestHash") => {
    const candidate = input[field]
    if (
      typeof candidate !== "string" ||
      !isHex(candidate, { strict: true }) ||
      candidate !== candidate.toLowerCase() ||
      hexToBytes(candidate).length !== 32
    ) {
      throw new Error("Bridge registration proof request is invalid.")
    }
    return candidate as Hex
  }
  const parsed = parseSliceWalletFrameRequest({
    id: "bridge",
    method: "getPendingSession",
    params: input.session ?? null,
    version: 1
  })
  if (parsed.method !== "getPendingSession") {
    throw new Error("Bridge registration proof request is invalid.")
  }
  return {
    accountIndex: input.accountIndex,
    action: input.action,
    challenge: canonicalBytes32("challenge"),
    challengeExpiresAt: input.challengeExpiresAt,
    requestHash: canonicalBytes32("requestHash"),
    session: parsed.params,
    type: "slice-wallet:bridge-sign-registration",
    version: 1
  }
}

const errorResponse = (id: string, error: Error): SliceWalletFrameResponse => ({
  error: { code: "invalid_request", message: error.message },
  id,
  version: 1
})

const successResponse = (
  id: string,
  result: Extract<
    SliceWalletFrameResponse,
    { result: object | string | null }
  >["result"]
): SliceWalletFrameResponse => ({ id, result, version: 1 })

export const attachSliceWalletSignerFrame = ({
  consumeAuthorization,
  cryptoImpl = crypto,
  decodeScopedCalls,
  now = () => Math.floor(Date.now() / 1000),
  onSessionCreated,
  rpId = sliceWalletDefaultRpId,
  selfOrigin,
  sessionStore,
  usePrecompiled,
  validateCheckoutCalls,
  window
}: SliceWalletSignerFrameControllerOptions) => {
  const normalizedSelfOrigin = new URL(selfOrigin).origin
  let parentOrigin: string | null = null
  let parentPort: MessagePort | null = null

  const getStoredSession = async (
    key: SliceWalletFrameSessionKey
  ): Promise<SliceWalletStoredSession> => {
    if (parentOrigin === null) throw new Error("Wallet frame is not connected.")
    const stored = await sessionStore.get(parentOrigin, key)
    if (stored === null) throw new Error("Wallet session is unavailable.")
    const session = parseSliceWalletFrameSession(stored.session)
    if (session.expiresAt <= now())
      throw new Error("Wallet session has expired.")
    if (
      session.grantKind === "generic" &&
      session.expiresAt - now() > maximumBrowserGenericGrantTtlSec
    ) {
      throw new Error("Generic wallet session exceeds the maximum lifetime.")
    }
    if (
      !(await sessionStore.isAccountUnlocked(parentOrigin, session.account))
    ) {
      throw new Error("Wallet session is locked. Connect with your passkey.")
    }
    return { ...stored, session }
  }

  const getPendingOrStoredSession = async (
    key: SliceWalletFrameSessionKey
  ): Promise<SliceWalletStoredSession> => {
    if (parentOrigin === null) throw new Error("Wallet frame is not connected.")
    const pending = await sessionStore.getPending(parentOrigin, key)
    if (pending === null) return getStoredSession(key)
    const session = parseSliceWalletFrameSession(pending.session)
    if (session.expiresAt <= now()) {
      throw new Error("Wallet session has expired.")
    }
    if (
      session.grantKind === "generic" &&
      session.expiresAt - now() > maximumBrowserGenericGrantTtlSec
    ) {
      throw new Error("Generic wallet session exceeds the maximum lifetime.")
    }
    return { ...pending, session }
  }

  const handleRequest = async (request: SliceWalletFrameRequest) => {
    if (parentOrigin === null) throw new Error("Wallet frame is not connected.")

    if (request.method === "createSession") {
      const requestedPolicy = request.params.policy
      if (requestedPolicy.validUntil <= now())
        throw new Error("Wallet policy is already expired.")
      if (
        requestedPolicy.grantKind === "generic" &&
        requestedPolicy.validUntil - now() > maximumBrowserGenericGrantTtlSec
      ) {
        throw new Error("Generic wallet policy exceeds the maximum lifetime.")
      }
      const keyPair = await generateSliceWalletP256KeyPair(cryptoImpl)
      const policy =
        requestedPolicy.grantKind === "management"
          ? bindSliceStoreManagementPolicySigner(
              requestedPolicy,
              keyPair.signerId
            )
          : requestedPolicy
      if (policy.grantKind === "management") {
        assertSliceStoreManagementPolicyDescriptor(policy)
      }
      const session: SliceWalletFrameSession = {
        account: policy.account,
        chainId: policy.chainId,
        ...(request.params.checkout === undefined
          ? {}
          : { checkout: request.params.checkout }),
        expiresAt: policy.validUntil,
        grantKind: policy.grantKind,
        permissionId: getWalletPermissionId(policy, keyPair.signerId),
        policy,
        publicKey: keyPair.publicKeyHex,
        signerId: keyPair.signerId
      }
      await sessionStore.putPending({
        appOrigin: parentOrigin,
        privateKey: keyPair.privateKey,
        session
      })
      onSessionCreated?.(session, parentOrigin)
      return session
    }
    if (request.method === "getSession") {
      return (
        (await sessionStore.get(parentOrigin, request.params))?.session ?? null
      )
    }
    if (request.method === "getPendingSession") {
      return (
        (await sessionStore.getPending(parentOrigin, request.params))
          ?.session ?? null
      )
    }
    if (request.method === "consumeAuthorization") {
      return (await consumeAuthorization?.(request.params)) ?? null
    }
    if (request.method === "lockAccount") {
      await sessionStore.setAccountUnlocked(
        parentOrigin,
        request.params.account,
        false
      )
      return null
    }
    if (request.method === "getAccountLockState") {
      return (await sessionStore.isAccountUnlocked(
        parentOrigin,
        request.params.account
      ))
        ? "unlocked"
        : "locked"
    }
    if (request.method === "clearSession") {
      await sessionStore.delete(parentOrigin, request.params)
      return null
    }
    if (request.method === "discardSession") {
      await sessionStore.deletePending(parentOrigin, request.params)
      return null
    }
    if (request.method === "commitSession") {
      await sessionStore.commitPending(parentOrigin, request.params)
      return null
    }

    if (request.method === "signGrantProof") {
      const stored = await sessionStore.getPending(
        parentOrigin,
        request.params.session
      )
      if (stored === null)
        throw new Error("Pending wallet session is unavailable.")
      const message = formatSliceWalletExecutionGrantMessage({
        appOrigin: parentOrigin,
        expiresAt: request.params.expiresAt,
        nonce: request.params.nonce,
        scopes: request.params.scopes,
        session: stored.session
      })
      return signSliceWalletP256({
        cryptoImpl,
        key: stored.privateKey,
        message: stringToBytes(message)
      })
    }
    const stored =
      request.method === "signSessionRequest" &&
      (request.params.action === "finalize_replacement" ||
        request.params.action === "predecessor_descriptors")
        ? await getPendingOrStoredSession(request.params.session)
        : await getStoredSession(request.params.session)
    if (request.method === "signCheckoutProposal") {
      if (stored.session.grantKind !== "checkout") {
        throw new Error("Only checkout sessions may sign checkout proposals.")
      }
      if (!isAddressEqual(request.params.sender, stored.session.account)) {
        throw new Error("Checkout sender does not match the wallet session.")
      }
      if (
        request.params.validUntil <= now() ||
        request.params.validUntil > stored.session.expiresAt
      ) {
        throw new Error("Checkout validity is outside the wallet session.")
      }
      validateCheckoutCalls(
        decodeScopedCalls(request.params.callData),
        stored.session
      )
      const proposalHash = hashSliceWalletWeightedP256Proposal({
        account: stored.session.account,
        callData: request.params.callData,
        chainId: stored.session.chainId,
        nonce: request.params.nonce,
        permissionId: stored.session.permissionId,
        validUntil: request.params.validUntil
      })
      const signature = await signSliceWalletP256({
        cryptoImpl,
        key: stored.privateKey,
        message: hexToBytes(proposalHash)
      })
      return { proposalHash, signature }
    }
    if (request.method === "signCoSignRequest") {
      if (stored.session.grantKind !== "checkout") {
        throw new Error("Only checkout sessions may request co-signing.")
      }
      if (
        request.params.challengeIssuedAt > now() ||
        request.params.challengeExpiresAt <= now() ||
        request.params.challengeExpiresAt >
          request.params.challengeIssuedAt + 120 ||
        request.params.validUntil <= now() ||
        request.params.validUntil > request.params.challengeExpiresAt ||
        request.params.validUntil > stored.session.expiresAt ||
        request.params.windowStart > request.params.challengeIssuedAt ||
        request.params.windowEndExclusive <= request.params.challengeIssuedAt ||
        (stored.session.checkout?.budgetPeriodSec === 86_400 &&
          request.params.validUntil >= request.params.windowEndExclusive)
      ) {
        throw new Error("Co-sign challenge expiration is invalid.")
      }
      if (
        !isAddressEqual(
          request.params.userOperation.sender,
          stored.session.account
        )
      ) {
        throw new Error(
          "User operation sender does not match the wallet session."
        )
      }
      validateCheckoutCalls(
        decodeScopedCalls(request.params.userOperation.callData),
        stored.session
      )
      assertSliceWalletExecutionSafety({
        chainId: stored.session.chainId,
        userOperation: request.params.userOperation
      })
      const userOperationHash = getUserOperationHash({
        chainId: stored.session.chainId,
        entryPointAddress: sliceWalletEntryPoint.address,
        entryPointVersion: sliceWalletEntryPoint.version,
        userOperation: {
          ...request.params.userOperation,
          signature: "0x"
        }
      })
      const proposalHash = hashSliceWalletWeightedP256Proposal({
        account: stored.session.account,
        callData: request.params.userOperation.callData,
        chainId: stored.session.chainId,
        nonce: request.params.userOperation.nonce,
        permissionId: stored.session.permissionId,
        validUntil: request.params.validUntil
      })
      const digest = hashSliceWalletCoSignRequest({
        accountNonce: request.params.userOperation.nonce,
        appOrigin: parentOrigin,
        challenge: request.params.challenge,
        challengeExpiresAt: request.params.challengeExpiresAt,
        challengeIssuedAt: request.params.challengeIssuedAt,
        delegationId: request.params.delegationId,
        proposalHash,
        session: stored.session,
        userOperationHash,
        validUntil: request.params.validUntil,
        windowEndExclusive: request.params.windowEndExclusive,
        windowId: request.params.windowId,
        windowStart: request.params.windowStart
      })
      const [proofSignature, signature] = await Promise.all([
        signSliceWalletP256({
          cryptoImpl,
          key: stored.privateKey,
          message: hexToBytes(digest)
        }),
        signSliceWalletP256({
          cryptoImpl,
          key: stored.privateKey,
          message: hexToBytes(proposalHash)
        })
      ])
      return {
        proofSignature,
        proposalHash,
        signature,
        userOperationHash
      }
    }
    if (request.method === "signSessionRequest") {
      if (
        request.params.action !== "finalize_replacement" &&
        request.params.action !== "predecessor_descriptors" &&
        request.params.action !== "revoke" &&
        stored.session.grantKind !== "checkout"
      ) {
        throw new Error("Only checkout sessions may sign session requests.")
      }
      if (
        request.params.expiresAt <= now() ||
        request.params.expiresAt > now() + 300
      ) {
        throw new Error("Session request expiration is invalid.")
      }
      return signSliceWalletP256({
        cryptoImpl,
        key: stored.privateKey,
        message: hexToBytes(
          hashSliceWalletSessionRequest({
            action: request.params.action,
            appOrigin: parentOrigin,
            challenge: request.params.challenge,
            delegationId: request.params.delegationId,
            expiresAt: request.params.expiresAt,
            session: stored.session
          })
        )
      })
    }
    if (request.method === "signScopedUserOperation") {
      if (stored.session.grantKind === "checkout") {
        throw new Error(
          "Checkout user operations require the checkout proposal flow."
        )
      }
      if (
        !isAddressEqual(
          request.params.userOperation.sender,
          stored.session.account
        )
      ) {
        throw new Error(
          "User operation sender does not match the wallet session."
        )
      }
      const scopedCalls = decodeScopedCalls(
        request.params.userOperation.callData
      )
      assertWalletCallsMatchPolicy(scopedCalls, stored.session.policy)
      assertSliceWalletExecutionSafety({
        chainId: stored.session.chainId,
        userOperation: request.params.userOperation
      })
      const userOperationHash = getUserOperationHash({
        chainId: stored.session.chainId,
        entryPointAddress: sliceWalletEntryPoint.address,
        entryPointVersion: sliceWalletEntryPoint.version,
        userOperation: {
          ...request.params.userOperation,
          signature: "0x"
        }
      })
      const signature = await encodeSliceWalletSyntheticWebAuthnSignature({
        chainId: stored.session.chainId,
        challenge: userOperationHash,
        cryptoImpl,
        key: stored.privateKey,
        origin: normalizedSelfOrigin,
        rpId,
        ...(usePrecompiled === undefined ? {} : { usePrecompiled })
      })
      return {
        proposalHash: bytesToHex(new Uint8Array(32)),
        signature,
        userOperationHash
      }
    }

    throw new Error("Unsupported wallet frame method.")
  }

  const onPortMessage = async (
    event: MessageEvent<SliceWalletProtocolValue>
  ) => {
    let id = "invalid"
    try {
      const request = parseSliceWalletFrameRequest(event.data)
      id = request.id
      parentPort?.postMessage(successResponse(id, await handleRequest(request)))
    } catch (error) {
      const message =
        error instanceof Error ? error : new Error("Wallet request failed.")
      parentPort?.postMessage(errorResponse(id, message))
    }
  }

  const onWindowMessage = async (event: SliceWalletWindowMessage) => {
    if (
      event.source === window.parent &&
      parentPort === null &&
      isConnectRequest(event.data) &&
      event.ports.length === 1
    ) {
      parentOrigin = new URL(event.origin).origin
      parentPort = event.ports[0]
      parentPort.addEventListener("message", onPortMessage)
      parentPort.start()
      parentPort.postMessage(successResponse(event.data.id, null))
      return
    }

    if (
      event.origin !== normalizedSelfOrigin ||
      event.ports.length !== 1 ||
      parentOrigin === null
    ) {
      return
    }

    const bridgedParentOrigin = parentOrigin

    if (isBridgeUnlockChallenge(event.data)) {
      const port = event.ports[0]
      const challenge = event.data
      let handled = false
      const timeout = setTimeout(() => port.close(), 15_000)
      port.addEventListener(
        "message",
        (messageEvent: MessageEvent<SliceWalletProtocolValue>) => {
          if (handled) return
          handled = true
          void (async () => {
            try {
              const request = parseBridgeUnlockRequest(messageEvent.data)
              if (
                request.nonce !== challenge.nonce ||
                request.account.toLowerCase() !==
                  challenge.account.toLowerCase()
              ) {
                throw new Error("Bridge unlock does not match its challenge.")
              }
              await sessionStore.setAccountUnlocked(
                bridgedParentOrigin,
                request.account,
                true
              )
              port.postMessage({
                account: request.account,
                nonce: request.nonce,
                type: "slice-wallet:bridge-unlocked",
                version: 1
              })
            } catch {
              // Invalid bridge payloads fail closed without unlocking the account.
            } finally {
              clearTimeout(timeout)
              port.close()
            }
          })()
        },
        { once: true }
      )
      port.start()
      port.postMessage({
        account: challenge.account,
        nonce: challenge.nonce,
        origin: bridgedParentOrigin,
        type: "slice-wallet:bridge-unlock-record",
        version: 1
      })
      return
    }

    if (!isBridgeChallenge(event.data)) return

    const session = await sessionStore.getPending(
      bridgedParentOrigin,
      event.data
    )
    if (session === null) return
    const port = event.ports[0]
    const record: SliceWalletBridgeRecord = {
      nonce: event.data.nonce,
      origin: bridgedParentOrigin,
      session: session.session,
      type: "slice-wallet:bridge-record",
      version: 1
    }
    let handled = false
    const timeout = setTimeout(() => port.close(), 5 * 60_000)
    port.addEventListener(
      "message",
      async (messageEvent: MessageEvent<SliceWalletProtocolValue>) => {
        if (handled) return
        handled = true
        let response:
          | SliceWalletBridgeGrantProofResponse
          | SliceWalletBridgeRegistrationProofResponse
        try {
          if (isBridgeRegistrationProofRequest(messageEvent.data)) {
            const request = parseBridgeRegistrationProofRequest(
              messageEvent.data
            )
            if (request.challengeExpiresAt <= now()) {
              throw new Error("Bridge registration challenge has expired.")
            }
            const parsedSession = parseSliceWalletFrameSession(session.session)
            if (
              parsedSession.grantKind !== "generic" ||
              request.session.account.toLowerCase() !==
                parsedSession.account.toLowerCase() ||
              request.session.chainId !== parsedSession.chainId ||
              request.session.grantKind !== parsedSession.grantKind
            ) {
              throw new Error(
                "Bridge registration proof does not match the pending generic session."
              )
            }
            response = {
              signature: await signSliceWalletP256({
                cryptoImpl,
                key: session.privateKey,
                message: hexToBytes(
                  hashSliceWalletAppPermissionRegistrationFields({
                    accountAddress: parsedSession.account,
                    accountIndex: request.accountIndex,
                    action: request.action,
                    appOrigin: bridgedParentOrigin,
                    challenge: request.challenge,
                    challengeExpiresAt: request.challengeExpiresAt,
                    chainId: parsedSession.chainId,
                    permissionId: parsedSession.permissionId,
                    policyHash: getWalletPolicyHash(parsedSession.policy),
                    requestHash: request.requestHash,
                    signerAddress: parsedSession.signerId,
                    signerPublicKey: parsedSession.publicKey
                  })
                )
              }),
              type: "slice-wallet:bridge-registration-proof",
              version: 1
            }
            port.postMessage(response)
            clearTimeout(timeout)
            port.close()
            return
          }
          const request = parseBridgeGrantProofRequest(messageEvent.data)
          if (session.session.grantKind === "generic") {
            throw new Error("Generic permissions require a registration proof.")
          }
          if (
            request.expiresAt !== session.session.expiresAt ||
            request.session.account.toLowerCase() !==
              session.session.account.toLowerCase() ||
            request.session.chainId !== session.session.chainId ||
            request.session.grantKind !== session.session.grantKind
          ) {
            throw new Error(
              "Bridge grant proof does not match the wallet session."
            )
          }
          const grantMessage = formatSliceWalletExecutionGrantMessage({
            appOrigin: bridgedParentOrigin,
            expiresAt: request.expiresAt,
            nonce: request.nonce,
            scopes: request.scopes,
            session: session.session
          })
          response = {
            signature: await signSliceWalletP256({
              cryptoImpl,
              key: session.privateKey,
              message: stringToBytes(grantMessage)
            }),
            type: "slice-wallet:bridge-grant-proof",
            version: 1
          }
        } catch (error) {
          response = {
            error:
              error instanceof Error
                ? error.message
                : "Bridge grant proof failed.",
            type: "slice-wallet:bridge-error",
            version: 1
          }
        }
        port.postMessage(response)
        clearTimeout(timeout)
        port.close()
      },
      { once: true }
    )
    port.start()
    port.postMessage(record)
  }

  window.addEventListener("message", onWindowMessage)
  return () => {
    parentPort?.close()
    window.removeEventListener("message", onWindowMessage)
  }
}
