import { type Address, type Hex, hexToBytes, isAddress, isHex } from "viem"
import { assertSliceWalletAccountIndex } from "../accountIndex"
import {
  parseSliceWalletPolicyDescriptor,
  parseSliceWalletUnsignedUserOperation
} from "../frame/protocol"
import { getSliceWalletP256SignerId } from "../p256Server"
import { getWalletPermissionId } from "../policy"
import type {
  SliceWalletBridgeChallenge,
  SliceWalletBridgeGrantProofResponse,
  SliceWalletBridgeRecord,
  SliceWalletBridgeRegistrationProofResponse,
  SliceWalletCeremonyAccountMessage,
  SliceWalletCeremonyAccountResponse,
  SliceWalletCeremonyConnectMessage,
  SliceWalletCeremonyReadyMessage,
  SliceWalletCeremonyResponse,
  SliceWalletCeremonyRootResponse,
  SliceWalletCeremonyRootSignRequest,
  SliceWalletCeremonySessionRequestMessage,
  SliceWalletCheckoutGrant,
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization,
  SliceWalletProtocolValue,
  SliceWalletRootSignatureRequest,
  WalletGrantKind
} from "../types"

type ProtocolRecord = { readonly [key: string]: SliceWalletProtocolValue }

export const parseSliceWalletCeremonySessionRequestMessage = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonySessionRequestMessage => {
  const input = record(value, "Ceremony session request")
  const status = stringValue(input.status, "Ceremony session request status")
  if (
    input.type !== "slice-wallet:ceremony-session-request" ||
    input.version !== 1
  ) {
    throw new Error("Ceremony session request is invalid.")
  }
  if (
    status === "none" ||
    status === "preparing" ||
    status === "preparation_failed"
  ) {
    assertKeys(input, ["status", "type", "version"])
    return { status, type: input.type, version: 1 }
  }
  if (status !== "prepared") {
    throw new Error("Ceremony session request status is invalid.")
  }
  assertKeys(input, ["request", "status", "type", "version"])
  const request = record(input.request, "Prepared session request")
  assertKeys(request, ["claims", "sessionSigner"], ["nonce", "pendingId"])
  const sessionSigner = addressValue(request.sessionSigner, "Session signer")
  const nonce =
    request.nonce === undefined
      ? undefined
      : stringValue(request.nonce, "Session nonce")
  const pendingId =
    request.pendingId === undefined
      ? undefined
      : stringValue(request.pendingId, "Pending session id")
  if (
    (nonce !== undefined && !/^[A-Za-z0-9_-]{16,256}$/.test(nonce)) ||
    (pendingId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(pendingId))
  ) {
    throw new Error("Prepared session request is invalid.")
  }
  return {
    request: {
      claims: request.claims,
      ...(nonce === undefined ? {} : { nonce }),
      ...(pendingId === undefined ? {} : { pendingId }),
      sessionSigner
    },
    status,
    type: input.type,
    version: 1
  }
}

const record = (
  value: SliceWalletProtocolValue,
  label: string
): ProtocolRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as ProtocolRecord
}

const assertKeys = (
  value: ProtocolRecord,
  required: readonly string[],
  optional: readonly string[] = []
) => {
  const allowed = new Set([...required, ...optional])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Slice wallet ceremony protocol contains an unknown field.")
  }
  if (required.some((key) => !(key in value))) {
    throw new Error(
      "Slice wallet ceremony protocol is missing a required field."
    )
  }
}

const stringValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`)
  return value
}

const integerValue = (value: SliceWalletProtocolValue, label: string) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer.`)
  }
  return value
}

const hexValue = (
  value: SliceWalletProtocolValue,
  label: string,
  byteLength?: number
) => {
  const parsed = stringValue(value, label)
  if (!isHex(parsed, { strict: true })) throw new Error(`${label} must be hex.`)
  if (byteLength !== undefined && hexToBytes(parsed).length !== byteLength) {
    throw new Error(`${label} has an invalid length.`)
  }
  return parsed as Hex
}

const addressValue = (value: SliceWalletProtocolValue, label: string) => {
  const parsed = stringValue(value, label)
  if (!isAddress(parsed)) throw new Error(`${label} must be an address.`)
  return parsed as Address
}

const originValue = (value: SliceWalletProtocolValue, label: string) => {
  const parsed = stringValue(value, label)
  const normalized = new URL(parsed).origin
  if (parsed !== normalized)
    throw new Error(`${label} must be a normalized origin.`)
  return normalized
}

const grantKindValue = (value: SliceWalletProtocolValue): WalletGrantKind => {
  if (value !== "checkout" && value !== "generic" && value !== "management") {
    throw new Error("Unsupported wallet grant kind.")
  }
  return value
}

const popupRequiredReasons = new Set([
  "capability_unsupported",
  "io_v2_unsupported",
  "popup_blocked",
  "user_activation_expired",
  "viewport_too_small",
  "visibility_unstable",
  "webauthn_unavailable"
])

const stringArray = (
  value: SliceWalletProtocolValue,
  label: string
): readonly string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`)
  }
  const parsed = value.map((item) => stringValue(item, label))
  if (
    parsed.some((item) => item.length === 0) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error(`${label} contains an invalid value.`)
  }
  return parsed
}

const parseCheckoutGrant = (
  value: SliceWalletProtocolValue
): SliceWalletCheckoutGrant => {
  const input = record(value, "Checkout grant")
  assertKeys(
    input,
    ["allowanceUsdMicros", "coSignerAddress"],
    ["budgetPeriodSec"]
  )
  const allowanceUsdMicros = stringValue(
    input.allowanceUsdMicros,
    "Checkout allowance"
  )
  if (!/^\d+$/.test(allowanceUsdMicros) || BigInt(allowanceUsdMicros) <= 0n) {
    throw new Error("Checkout allowance must be a positive integer.")
  }
  const budgetPeriodSec =
    input.budgetPeriodSec === undefined
      ? undefined
      : integerValue(input.budgetPeriodSec, "Checkout budget period")
  if (budgetPeriodSec !== undefined && budgetPeriodSec <= 0) {
    throw new Error("Checkout budget period must be positive.")
  }
  return {
    allowanceUsdMicros,
    ...(budgetPeriodSec === undefined ? {} : { budgetPeriodSec }),
    coSignerAddress: addressValue(input.coSignerAddress, "Checkout co-signer")
  }
}

export const parseSliceWalletFrameSession = (
  value: SliceWalletProtocolValue
): SliceWalletFrameSession => {
  const input = record(value, "Wallet session")
  assertKeys(
    input,
    [
      "account",
      "chainId",
      "expiresAt",
      "grantKind",
      "permissionId",
      "policy",
      "publicKey",
      "signerId"
    ],
    ["checkout"]
  )
  const account = addressValue(input.account, "Session account")
  const chainId = integerValue(input.chainId, "Session chain id")
  const expiresAt = integerValue(input.expiresAt, "Session expiration")
  const grantKind = grantKindValue(input.grantKind)
  const permissionId = hexValue(input.permissionId, "Permission id", 4)
  const publicKey = hexValue(input.publicKey, "Session public key", 65)
  if (!publicKey.toLowerCase().startsWith("0x04")) {
    throw new Error("Session public key must be uncompressed P-256.")
  }
  const policy = parseSliceWalletPolicyDescriptor(input.policy)
  const signerId = addressValue(input.signerId, "Session signer id")
  const checkout =
    input.checkout === undefined
      ? undefined
      : parseCheckoutGrant(input.checkout)
  if ((grantKind === "checkout") !== (checkout !== undefined)) {
    throw new Error("Checkout session metadata does not match its grant kind.")
  }
  if (
    policy.account.toLowerCase() !== account.toLowerCase() ||
    policy.chainId !== chainId ||
    policy.grantKind !== grantKind ||
    policy.validUntil !== expiresAt ||
    getWalletPermissionId(policy, signerId).toLowerCase() !==
      permissionId.toLowerCase() ||
    getSliceWalletP256SignerId(publicKey).toLowerCase() !==
      signerId.toLowerCase()
  ) {
    throw new Error("Wallet session metadata does not match its policy.")
  }
  return {
    account,
    chainId,
    ...(checkout === undefined ? {} : { checkout }),
    expiresAt,
    grantKind,
    permissionId,
    policy,
    publicKey,
    signerId
  }
}

export const parseSliceWalletPermissionAuthorization = (
  value: SliceWalletProtocolValue
): SliceWalletPermissionAuthorization => {
  const input = record(value, "Wallet authorization")
  assertKeys(
    input,
    [
      "accountIndex",
      "appOrigin",
      "enableSignature",
      "rootCredential",
      "session"
    ],
    ["accountFactory", "accountFactoryData", "executionGrant"]
  )
  if (
    (input.accountFactory === undefined) !==
    (input.accountFactoryData === undefined)
  ) {
    throw new Error(
      "Wallet factory and factory data must be provided together."
    )
  }
  const session = parseSliceWalletFrameSession(input.session)
  const rootCredentialInput = record(input.rootCredential, "Root credential")
  assertKeys(rootCredentialInput, ["credentialIdHash", "publicKey"])
  const rootCredential = {
    credentialIdHash: hexValue(
      rootCredentialInput.credentialIdHash,
      "Root credential id hash",
      32
    ),
    publicKey: hexValue(
      rootCredentialInput.publicKey,
      "Root credential public key",
      65
    )
  }
  if (!rootCredential.publicKey.toLowerCase().startsWith("0x04")) {
    throw new Error("Root credential public key must be uncompressed P-256.")
  }
  let executionGrant: SliceWalletPermissionAuthorization["executionGrant"]
  if (input.executionGrant !== undefined) {
    const grant = record(input.executionGrant, "Execution grant")
    assertKeys(grant, ["expiresAt", "nonce", "scopes", "signerProof"])
    executionGrant = {
      expiresAt: integerValue(grant.expiresAt, "Execution grant expiration"),
      nonce: hexValue(grant.nonce, "Execution grant nonce", 32),
      scopes: stringArray(grant.scopes, "Execution grant scopes"),
      signerProof: hexValue(grant.signerProof, "Execution signer proof", 64)
    }
    if (executionGrant.expiresAt !== session.expiresAt) {
      throw new Error("Execution grant expiration does not match the session.")
    }
  }
  if ((session.grantKind === "generic") === (executionGrant !== undefined)) {
    throw new Error("Execution grant does not match the wallet grant kind.")
  }
  return {
    accountIndex: assertSliceWalletAccountIndex(
      integerValue(input.accountIndex, "Wallet account index")
    ),
    ...(input.accountFactory === undefined
      ? {}
      : {
          accountFactory: addressValue(input.accountFactory, "Account factory"),
          accountFactoryData: hexValue(
            input.accountFactoryData,
            "Account factory data"
          )
        }),
    appOrigin: originValue(input.appOrigin, "Application origin"),
    enableSignature: hexValue(input.enableSignature, "Enable signature"),
    ...(executionGrant === undefined ? {} : { executionGrant }),
    rootCredential,
    session
  }
}

export const parseSliceWalletCeremonyReadyMessage = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyReadyMessage => {
  const input = record(value, "Ceremony ready message")
  assertKeys(input, ["type", "version"])
  if (input.type !== "slice-wallet:ceremony-ready" || input.version !== 1) {
    throw new Error("Ceremony ready message is invalid.")
  }
  return { type: "slice-wallet:ceremony-ready", version: 1 }
}

export const parseSliceWalletCeremonyConnectMessage = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyConnectMessage => {
  const input = record(value, "Ceremony connect message")
  assertKeys(input, ["nonce", "type", "version"])
  if (input.type !== "slice-wallet:ceremony-connect" || input.version !== 1) {
    throw new Error("Ceremony connect message is invalid.")
  }
  return {
    nonce: hexValue(input.nonce, "Ceremony nonce", 32),
    type: "slice-wallet:ceremony-connect",
    version: 1
  }
}

export const parseSliceWalletCeremonyResponse = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyResponse => {
  const input = record(value, "Ceremony response")
  if (input.type === "slice-wallet:ceremony-authorizations") {
    assertKeys(input, ["authorizations", "nonce", "type", "version"])
    if (
      input.version !== 1 ||
      !Array.isArray(input.authorizations) ||
      input.authorizations.length === 0
    ) {
      throw new Error("Ceremony batch response is invalid.")
    }
    return {
      authorizations: input.authorizations.map((authorization) =>
        parseSliceWalletPermissionAuthorization(authorization)
      ),
      nonce: hexValue(input.nonce, "Ceremony nonce", 32),
      type: "slice-wallet:ceremony-authorizations",
      version: 1
    }
  }
  if (input.type === "slice-wallet:ceremony-authorization") {
    assertKeys(input, ["authorization", "nonce", "type", "version"])
    if (input.version !== 1) throw new Error("Ceremony response is invalid.")
    return {
      authorization: parseSliceWalletPermissionAuthorization(
        input.authorization
      ),
      nonce: hexValue(input.nonce, "Ceremony nonce", 32),
      type: "slice-wallet:ceremony-authorization",
      version: 1
    }
  }
  if (input.type === "slice-wallet:popup-required") {
    assertKeys(input, ["nonce", "reason", "type", "version"])
    const reason = stringValue(input.reason, "Popup reason")
    if (input.version !== 1 || !popupRequiredReasons.has(reason)) {
      throw new Error("Ceremony popup response is invalid.")
    }
    return {
      nonce: hexValue(input.nonce, "Ceremony nonce", 32),
      reason: reason as Extract<
        SliceWalletCeremonyResponse,
        { type: "slice-wallet:popup-required" }
      >["reason"],
      type: "slice-wallet:popup-required",
      version: 1
    }
  }
  assertKeys(input, ["code", "message", "nonce", "type", "version"])
  if (
    input.type !== "slice-wallet:ceremony-error" ||
    input.version !== 1 ||
    (input.code !== "authorization_failed" &&
      input.code !== "bridge_unavailable" &&
      input.code !== "invalid_request")
  ) {
    throw new Error("Ceremony error response is invalid.")
  }
  return {
    code: input.code,
    message: stringValue(input.message, "Ceremony error message"),
    nonce: hexValue(input.nonce, "Ceremony nonce", 32),
    type: "slice-wallet:ceremony-error",
    version: 1
  }
}

export const parseSliceWalletCeremonyAccountMessage = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyAccountMessage => {
  const input = record(value, "Ceremony account response")
  assertKeys(
    input,
    ["account", "accountIndex", "credentialIdHash", "nonce", "type", "version"],
    ["recovery", "session"]
  )
  if (input.type !== "slice-wallet:ceremony-account" || input.version !== 1) {
    throw new Error("Ceremony account response is invalid.")
  }
  let recovery: SliceWalletCeremonyAccountMessage["recovery"]
  if (input.recovery !== undefined) {
    const recoveryInput = record(input.recovery, "Recovery enrollment")
    assertKeys(recoveryInput, ["permissionId", "signerAddress"])
    recovery = {
      permissionId: hexValue(
        recoveryInput.permissionId,
        "Recovery permission id",
        4
      ),
      signerAddress: addressValue(
        recoveryInput.signerAddress,
        "Recovery signer address"
      )
    }
  }
  let session: SliceWalletCeremonyAccountMessage["session"]
  if (input.session !== undefined) {
    const sessionInput = record(input.session, "Ceremony session result")
    const status = stringValue(sessionInput.status, "Ceremony session status")
    if (status === "granted") {
      assertKeys(
        sessionInput,
        ["expiresAt", "grantMessage", "sessionSigner", "signature", "status"],
        ["pendingId"]
      )
      const pendingId =
        sessionInput.pendingId === undefined
          ? undefined
          : stringValue(sessionInput.pendingId, "Pending session id")
      if (
        pendingId !== undefined &&
        (!/^[A-Za-z0-9_-]{1,64}$/.test(pendingId) || pendingId.length > 64)
      ) {
        throw new Error("Pending session id is invalid.")
      }
      session = {
        expiresAt: stringValue(sessionInput.expiresAt, "Session expiry"),
        grantMessage: stringValue(sessionInput.grantMessage, "Session grant"),
        ...(pendingId === undefined ? {} : { pendingId }),
        sessionSigner: addressValue(
          sessionInput.sessionSigner,
          "Session signer"
        ),
        signature: hexValue(sessionInput.signature, "Session signature"),
        status
      }
    } else {
      assertKeys(sessionInput, ["status"])
      if (
        status !== "cancelled" &&
        status !== "preparation_failed" &&
        status !== "timed_out"
      ) {
        throw new Error("Ceremony session status is invalid.")
      }
      session = { status }
    }
  }
  return {
    account: addressValue(input.account, "Wallet account"),
    accountIndex: assertSliceWalletAccountIndex(
      integerValue(input.accountIndex, "Wallet account index")
    ),
    credentialIdHash: hexValue(
      input.credentialIdHash,
      "Credential id hash",
      32
    ),
    nonce: hexValue(input.nonce, "Ceremony nonce", 32),
    ...(recovery === undefined ? {} : { recovery }),
    ...(session === undefined ? {} : { session }),
    type: "slice-wallet:ceremony-account",
    version: 1
  }
}

export const parseSliceWalletCeremonyAccountResponse = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyAccountResponse => {
  const input = record(value, "Ceremony account response")
  if (input.type === "slice-wallet:ceremony-account") {
    return parseSliceWalletCeremonyAccountMessage(value)
  }
  const response = parseSliceWalletCeremonyResponse(value)
  if (
    response.type !== "slice-wallet:ceremony-error" &&
    response.type !== "slice-wallet:popup-required"
  ) {
    throw new Error("Ceremony account response is invalid.")
  }
  return response
}

export const parseSliceWalletCeremonyRootSignRequest = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyRootSignRequest => {
  const input = record(value, "Root signature request")
  assertKeys(input, [
    "account",
    "chainId",
    "nonce",
    "request",
    "type",
    "version"
  ])
  if (input.type !== "slice-wallet:root-sign-request" || input.version !== 1) {
    throw new Error("Root signature request is invalid.")
  }
  const request = record(input.request, "Root signature payload")
  if (request.purpose === "message") {
    assertKeys(request, ["message", "messageFormat", "purpose"])
    if (request.messageFormat !== "hex" && request.messageFormat !== "text") {
      throw new Error("Root message format is invalid.")
    }
    const message = stringValue(request.message, "Root message")
    if (request.messageFormat === "hex") {
      hexValue(message, "Root message")
    }
    return {
      account: addressValue(input.account, "Root account"),
      chainId: integerValue(input.chainId, "Root chain id"),
      nonce: hexValue(input.nonce, "Ceremony nonce", 32),
      request: {
        message,
        messageFormat: request.messageFormat,
        purpose: "message"
      },
      type: "slice-wallet:root-sign-request",
      version: 1
    }
  }
  if (request.purpose === "typed_data") {
    assertKeys(request, ["purpose", "source", "typedData"])
    const source = record(request.source, "Root typed-data source")
    let parsedSource: NonNullable<
      Extract<
        SliceWalletRootSignatureRequest,
        { purpose: "typed_data" }
      >["source"]
    >
    if (source.purpose === "application_typed_data") {
      assertKeys(source, ["purpose", "typedDataJson"])
      const typedDataJson = stringValue(
        source.typedDataJson,
        "Application typed data"
      )
      if (typedDataJson.length === 0 || typedDataJson.length > 100_000) {
        throw new Error("Application typed data has an invalid length.")
      }
      parsedSource = { purpose: "application_typed_data", typedDataJson }
    } else {
      assertKeys(source, ["message", "messageFormat", "purpose"])
      if (
        source.purpose !== "message" ||
        (source.messageFormat !== "hex" && source.messageFormat !== "text")
      ) {
        throw new Error("Root typed-data source is invalid.")
      }
      const sourceMessage = stringValue(source.message, "Root source message")
      if (source.messageFormat === "hex") {
        hexValue(sourceMessage, "Root source message")
      }
      parsedSource = {
        message: sourceMessage,
        messageFormat: source.messageFormat,
        purpose: "message"
      }
    }
    const typedData = record(request.typedData, "Root typed data")
    assertKeys(typedData, ["domain", "message", "primaryType", "types"])
    if (typedData.primaryType !== "Kernel") {
      throw new Error("Root typed-data primary type is invalid.")
    }
    const domain = record(typedData.domain, "Root typed-data domain")
    assertKeys(domain, ["chainId", "name", "verifyingContract", "version"])
    const message = record(typedData.message, "Root typed-data message")
    assertKeys(message, ["hash"])
    const types = record(typedData.types, "Root typed-data types")
    assertKeys(types, ["Kernel"])
    const kernelTypes = types.Kernel
    if (!Array.isArray(kernelTypes) || kernelTypes.length !== 1) {
      throw new Error("Root typed-data fields are invalid.")
    }
    const hashField = record(kernelTypes[0], "Root typed-data hash field")
    assertKeys(hashField, ["name", "type"])
    if (hashField.name !== "hash" || hashField.type !== "bytes32") {
      throw new Error("Root typed-data hash field is invalid.")
    }
    return {
      account: addressValue(input.account, "Root account"),
      chainId: integerValue(input.chainId, "Root chain id"),
      nonce: hexValue(input.nonce, "Ceremony nonce", 32),
      request: {
        purpose: "typed_data",
        source: parsedSource,
        typedData: {
          domain: {
            chainId: integerValue(domain.chainId, "Typed-data chain id"),
            name: stringValue(domain.name, "Typed-data domain name"),
            verifyingContract: addressValue(
              domain.verifyingContract,
              "Typed-data verifying contract"
            ),
            version: stringValue(domain.version, "Typed-data domain version")
          },
          message: {
            hash: hexValue(message.hash, "Typed-data message hash", 32)
          },
          primaryType: "Kernel",
          types: { Kernel: [{ name: "hash", type: "bytes32" }] }
        }
      },
      type: "slice-wallet:root-sign-request",
      version: 1
    }
  }
  assertKeys(request, ["purpose", "userOperation"])
  if (request.purpose !== "user_operation") {
    throw new Error("Root signature purpose is unsupported.")
  }
  return {
    account: addressValue(input.account, "Root account"),
    chainId: integerValue(input.chainId, "Root chain id"),
    nonce: hexValue(input.nonce, "Ceremony nonce", 32),
    request: {
      purpose: "user_operation",
      userOperation: parseSliceWalletUnsignedUserOperation(
        request.userOperation
      )
    },
    type: "slice-wallet:root-sign-request",
    version: 1
  }
}

export const parseSliceWalletCeremonyRootResponse = (
  value: SliceWalletProtocolValue
): SliceWalletCeremonyRootResponse => {
  const input = record(value, "Root signature response")
  if (input.type === "slice-wallet:root-signature") {
    assertKeys(input, ["hash", "nonce", "signature", "type", "version"])
    if (input.version !== 1)
      throw new Error("Root signature response is invalid.")
    return {
      hash: hexValue(input.hash, "Root signature hash", 32),
      nonce: hexValue(input.nonce, "Ceremony nonce", 32),
      signature: hexValue(input.signature, "Root signature"),
      type: "slice-wallet:root-signature",
      version: 1
    }
  }
  const response = parseSliceWalletCeremonyResponse(value)
  if (
    response.type !== "slice-wallet:ceremony-error" &&
    response.type !== "slice-wallet:popup-required"
  ) {
    throw new Error("Root signature response is invalid.")
  }
  return response
}

export const parseSliceWalletBridgeRecord = (
  value: SliceWalletProtocolValue,
  challenge: SliceWalletBridgeChallenge
): SliceWalletBridgeRecord => {
  const input = record(value, "Signer bridge record")
  assertKeys(input, ["nonce", "origin", "session", "type", "version"])
  if (
    input.type !== "slice-wallet:bridge-record" ||
    input.version !== 1 ||
    input.nonce !== challenge.nonce
  ) {
    throw new Error("Signer bridge record is invalid.")
  }
  const session = parseSliceWalletFrameSession(input.session)
  if (
    session.account.toLowerCase() !== challenge.account.toLowerCase() ||
    session.chainId !== challenge.chainId ||
    session.grantKind !== challenge.grantKind
  ) {
    throw new Error("Signer bridge record does not match the ceremony request.")
  }
  return {
    nonce: challenge.nonce,
    origin: originValue(input.origin, "Signer application origin"),
    session,
    type: "slice-wallet:bridge-record",
    version: 1
  }
}

export const parseSliceWalletBridgeGrantProofResponse = (
  value: SliceWalletProtocolValue
): SliceWalletBridgeGrantProofResponse => {
  const input = record(value, "Signer grant-proof response")
  if (input.type === "slice-wallet:bridge-grant-proof") {
    assertKeys(input, ["signature", "type", "version"])
    if (input.version !== 1) throw new Error("Signer grant proof is invalid.")
    return {
      signature: hexValue(input.signature, "Signer grant proof", 64),
      type: "slice-wallet:bridge-grant-proof",
      version: 1
    }
  }
  assertKeys(input, ["error", "type", "version"])
  if (input.type !== "slice-wallet:bridge-error" || input.version !== 1) {
    throw new Error("Signer grant-proof error is invalid.")
  }
  return {
    error: stringValue(input.error, "Signer grant-proof error"),
    type: "slice-wallet:bridge-error",
    version: 1
  }
}

export const parseSliceWalletBridgeRegistrationProofResponse = (
  value: SliceWalletProtocolValue
): SliceWalletBridgeRegistrationProofResponse => {
  const input = record(value, "Signer registration-proof response")
  if (input.type === "slice-wallet:bridge-registration-proof") {
    assertKeys(input, ["signature", "type", "version"])
    if (input.version !== 1) {
      throw new Error("Signer registration proof is invalid.")
    }
    return {
      signature: hexValue(input.signature, "Signer registration proof", 64),
      type: "slice-wallet:bridge-registration-proof",
      version: 1
    }
  }
  assertKeys(input, ["error", "type", "version"])
  if (input.type !== "slice-wallet:bridge-error" || input.version !== 1) {
    throw new Error("Signer registration-proof error is invalid.")
  }
  return {
    error: stringValue(input.error, "Signer registration-proof error"),
    type: "slice-wallet:bridge-error",
    version: 1
  }
}
