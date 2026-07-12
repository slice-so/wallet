import {
  bytesToHex,
  hexToBytes,
  isAddress,
  isAddressEqual,
  isHex,
  stringToBytes
} from "viem"
import { getUserOperationHash } from "viem/account-abstraction"
import { sliceWalletDefaultRpId, sliceWalletEntryPoint } from "../constants"
import {
  encodeSliceWalletSyntheticWebAuthnSignature,
  generateSliceWalletP256KeyPair,
  hashSliceWalletWeightedP256Proposal,
  signSliceWalletP256
} from "../p256"
import { assertWalletCallsMatchPolicy, getWalletPermissionId } from "../policy"
import type {
  SliceWalletBridgeChallenge,
  SliceWalletBridgeGrantProofRequest,
  SliceWalletBridgeGrantProofResponse,
  SliceWalletBridgeRecord,
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
  hashSliceWalletCoSignRequest
} from "./messages"
import { parseSliceWalletFrameRequest } from "./protocol"

const logSignerFrame = (
  stage: string,
  details: Record<string, boolean | number | string> = {}
) => console.info(`[slice-wallet-frame] ${stage}`, details)

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
  return (
    Object.keys(input).length === 6 &&
    input.type === "slice-wallet:bridge-challenge" &&
    input.version === 1 &&
    typeof input.account === "string" &&
    isAddress(input.account) &&
    typeof input.chainId === "number" &&
    Number.isSafeInteger(input.chainId) &&
    input.chainId > 0 &&
    (input.grantKind === "checkout" ||
      input.grantKind === "generic" ||
      input.grantKind === "management") &&
    typeof input.nonce === "string" &&
    isHex(input.nonce, { strict: true }) &&
    hexToBytes(input.nonce).length === 32
  )
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
  managementOrigins = [],
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
  const normalizedManagementOrigins = new Set(
    managementOrigins.map((origin) => new URL(origin).origin)
  )
  let parentOrigin: string | null = null
  let parentPort: MessagePort | null = null

  const getStoredSession = async (
    key: SliceWalletFrameSessionKey
  ): Promise<SliceWalletStoredSession> => {
    if (parentOrigin === null) throw new Error("Wallet frame is not connected.")
    const startedAt = Date.now()
    logSignerFrame("session.read.start", { grantKind: key.grantKind })
    const stored = await sessionStore.get(parentOrigin, key)
    logSignerFrame("session.read.done", {
      durationMs: Date.now() - startedAt,
      found: stored !== null,
      grantKind: key.grantKind
    })
    if (stored === null) throw new Error("Wallet session is unavailable.")
    if (stored.session.expiresAt <= now())
      throw new Error("Wallet session has expired.")
    return stored
  }

  const handleRequest = async (request: SliceWalletFrameRequest) => {
    if (parentOrigin === null) throw new Error("Wallet frame is not connected.")

    if (request.method === "createSession") {
      const policy = request.params.policy
      if (policy.validUntil <= now())
        throw new Error("Wallet policy is already expired.")
      if (
        policy.grantKind === "management" &&
        !normalizedManagementOrigins.has(parentOrigin)
      ) {
        throw new Error(
          "Store management permissions are unavailable for this origin."
        )
      }
      const keyPair = await generateSliceWalletP256KeyPair(cryptoImpl)
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
      onSessionCreated?.(session)
      return session
    }
    if (request.method === "getSession") {
      return (
        (await sessionStore.get(parentOrigin, request.params))?.session ?? null
      )
    }
    if (request.method === "consumeAuthorization") {
      return (await consumeAuthorization?.(request.params)) ?? null
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
    const stored = await getStoredSession(request.params.session)
    if (request.method === "signCheckoutProposal") {
      logSignerFrame("checkout.validate.start")
      if (stored.session.grantKind !== "checkout") {
        throw new Error("Only checkout sessions may sign checkout proposals.")
      }
      if (!isAddressEqual(request.params.sender, stored.session.account)) {
        throw new Error("Checkout sender does not match the wallet session.")
      }
      const calls = decodeScopedCalls(request.params.callData)
      logSignerFrame("checkout.decode.done", { calls: calls.length })
      validateCheckoutCalls(calls, stored.session)
      logSignerFrame("checkout.validate.done")
      const proposalHash = hashSliceWalletWeightedP256Proposal({
        account: stored.session.account,
        callData: request.params.callData,
        chainId: stored.session.chainId,
        nonce: request.params.nonce,
        permissionId: stored.session.permissionId
      })
      const signingStartedAt = Date.now()
      logSignerFrame("checkout.sign.start")
      const signature = await signSliceWalletP256({
        cryptoImpl,
        key: stored.privateKey,
        message: hexToBytes(proposalHash)
      })
      logSignerFrame("checkout.sign.done", {
        durationMs: Date.now() - signingStartedAt
      })
      return { proposalHash, signature }
    }
    if (request.method === "signCoSignRequest") {
      if (stored.session.grantKind !== "checkout") {
        throw new Error("Only checkout sessions may request co-signing.")
      }
      if (
        request.params.expiresAt <= now() ||
        request.params.expiresAt > now() + 300
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
        permissionId: stored.session.permissionId
      })
      const digest = hashSliceWalletCoSignRequest({
        accountNonce: request.params.userOperation.nonce,
        appOrigin: parentOrigin,
        challenge: request.params.challenge,
        delegationId: request.params.delegationId,
        expiresAt: request.params.expiresAt,
        proposalHash,
        session: stored.session,
        userOperationHash
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
      assertWalletCallsMatchPolicy(
        decodeScopedCalls(request.params.userOperation.callData),
        stored.session.policy
      )
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
      const startedAt = Date.now()
      logSignerFrame("request.received", { id, method: request.method })
      const result = await handleRequest(request)
      logSignerFrame("request.handled", {
        durationMs: Date.now() - startedAt,
        id,
        method: request.method
      })
      parentPort?.postMessage(successResponse(id, result))
      logSignerFrame("response.sent", { id, method: request.method })
    } catch (error) {
      const message =
        error instanceof Error ? error : new Error("Wallet request failed.")
      logSignerFrame("request.failed", { id, message: message.message })
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
      logSignerFrame("connection.received", { parentOrigin })
      parentPort = event.ports[0]
      parentPort.addEventListener("message", onPortMessage)
      parentPort.start()
      parentPort.postMessage(successResponse(event.data.id, null))
      logSignerFrame("connection.ready", { parentOrigin })
      return
    }

    if (
      event.origin !== normalizedSelfOrigin ||
      event.ports.length !== 1 ||
      parentOrigin === null ||
      !isBridgeChallenge(event.data)
    ) {
      return
    }
    const bridgedParentOrigin = parentOrigin
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
        let response: SliceWalletBridgeGrantProofResponse
        try {
          const request = parseBridgeGrantProofRequest(messageEvent.data)
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
