import { type Address, type Hex, hexToBytes, isAddress, isHex } from "viem"
import { getSliceWalletP256SignerId } from "../../p256Server"
import {
  getWalletPermissionId,
  parseSerializedWalletPolicyDescriptor,
  serializeWalletPolicyDescriptor
} from "../../policy"
import type {
  CreateSliceWalletCheckoutExecutionClientParameters,
  SliceWalletCheckoutExecutionClient,
  SliceWalletCheckoutExecutionDelegationState,
  SliceWalletCheckoutExecutionGrantRegistration,
  SliceWalletExecutionSessionDescriptor,
  SliceWalletManagementExecutionClient,
  SliceWalletManagementExecutionGrantRegistration
} from "../../types/commerce"
import type {
  SliceWalletFrameSession,
  SliceWalletPermissionAuthorization
} from "../../types/frame"
import type { SliceWalletCheckoutCoSignerClient } from "../../types/permission"
import {
  walletDelegationExecutionScope,
  walletDelegationStoreManagementScope
} from "./delegationScopes"

export class SliceWalletExecutionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "SliceWalletExecutionRequestError"
  }
}

const readJson = async <Result>(response: Response): Promise<Result> => {
  if (!response.ok) {
    const text = await response.text()
    let code = "request_failed"
    try {
      const body = JSON.parse(text) as { error?: string }
      if (typeof body.error === "string") code = body.error
    } catch {}
    throw new SliceWalletExecutionRequestError(response.status, code, text)
  }
  return (await response.json()) as Result
}

const isBytes32 = (value: string): value is Hex =>
  isHex(value, { strict: true }) && hexToBytes(value).length === 32

type CoSignChallengeWire = {
  challenge: string
  challengeExpiresAt: number
  challengeIssuedAt: number
  validUntil: number
  windowEndExclusive: number
  windowId: string
  windowStart: number
}

const parseChallenge = (body: CoSignChallengeWire) => {
  const now = Math.floor(Date.now() / 1000)
  if (
    !isBytes32(body.challenge) ||
    !Number.isSafeInteger(body.challengeExpiresAt) ||
    !Number.isSafeInteger(body.challengeIssuedAt) ||
    !Number.isSafeInteger(body.validUntil) ||
    !Number.isSafeInteger(body.windowEndExclusive) ||
    !Number.isSafeInteger(body.windowStart) ||
    typeof body.windowId !== "string" ||
    body.windowId.length === 0 ||
    body.challengeIssuedAt > now ||
    body.challengeExpiresAt <= now ||
    body.challengeExpiresAt > body.challengeIssuedAt + 120 ||
    body.validUntil <= now ||
    body.validUntil > body.challengeExpiresAt ||
    body.windowStart > body.challengeIssuedAt ||
    body.windowEndExclusive <= body.challengeIssuedAt
  ) {
    throw new Error("Slice wallet execution challenge is invalid.")
  }
  return {
    challenge: body.challenge,
    challengeExpiresAt: body.challengeExpiresAt,
    challengeIssuedAt: body.challengeIssuedAt,
    validUntil: body.validUntil,
    windowEndExclusive: body.windowEndExclusive,
    windowId: body.windowId,
    windowStart: body.windowStart
  }
}

const parseSessionChallenge = (body: {
  challenge: string
  expiresAt: number
}) => {
  if (
    !isBytes32(body.challenge) ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Slice wallet execution challenge is invalid.")
  }
  return { challenge: body.challenge, expiresAt: body.expiresAt }
}

export const serializeSliceWalletExecutionSessionDescriptor = (
  session: SliceWalletFrameSession
): SliceWalletExecutionSessionDescriptor => {
  if (session.grantKind === "generic") {
    throw new Error("Generic sessions are not execution delegations.")
  }
  return {
    account: session.account,
    chainId: session.chainId,
    ...(session.checkout === undefined ? {} : { checkout: session.checkout }),
    expiresAt: session.expiresAt,
    grantKind: session.grantKind,
    permissionId: session.permissionId,
    policy: serializeWalletPolicyDescriptor(session.policy),
    publicKey: session.publicKey,
    signerId: session.signerId
  }
}

export const parseSliceWalletExecutionSessionDescriptor = (
  descriptor: SliceWalletExecutionSessionDescriptor
): SliceWalletFrameSession => {
  const policy = parseSerializedWalletPolicyDescriptor(descriptor.policy)
  if (
    !isAddress(descriptor.account) ||
    !Number.isSafeInteger(descriptor.chainId) ||
    descriptor.chainId <= 0 ||
    !Number.isSafeInteger(descriptor.expiresAt) ||
    descriptor.expiresAt <= 0 ||
    !isHex(descriptor.permissionId, { strict: true }) ||
    hexToBytes(descriptor.permissionId).length !== 4 ||
    !isHex(descriptor.publicKey, { strict: true }) ||
    hexToBytes(descriptor.publicKey).length !== 65 ||
    !isAddress(descriptor.signerId) ||
    policy.account.toLowerCase() !== descriptor.account.toLowerCase() ||
    policy.chainId !== descriptor.chainId ||
    policy.grantKind !== descriptor.grantKind ||
    policy.validUntil !== descriptor.expiresAt ||
    getSliceWalletP256SignerId(descriptor.publicKey).toLowerCase() !==
      descriptor.signerId.toLowerCase() ||
    getWalletPermissionId(policy, descriptor.signerId).toLowerCase() !==
      descriptor.permissionId.toLowerCase() ||
    (descriptor.grantKind === "checkout") !==
      (descriptor.checkout !== undefined) ||
    (descriptor.checkout !== undefined &&
      (!/^\d+$/.test(descriptor.checkout.allowanceUsdMicros) ||
        !isAddress(descriptor.checkout.coSignerAddress) ||
        (descriptor.checkout.budgetPeriodSec !== undefined &&
          (!Number.isSafeInteger(descriptor.checkout.budgetPeriodSec) ||
            descriptor.checkout.budgetPeriodSec <= 0))))
  ) {
    throw new Error("Slice wallet predecessor descriptor is invalid.")
  }
  return {
    account: descriptor.account,
    chainId: descriptor.chainId,
    ...(descriptor.checkout === undefined
      ? {}
      : { checkout: descriptor.checkout }),
    expiresAt: descriptor.expiresAt,
    grantKind: descriptor.grantKind,
    permissionId: descriptor.permissionId,
    policy,
    publicKey: descriptor.publicKey,
    signerId: descriptor.signerId
  }
}

const assertCheckoutAuthorization = (
  authorization: SliceWalletPermissionAuthorization
) => {
  const { executionGrant, session } = authorization
  if (
    session.grantKind !== "checkout" ||
    session.checkout === undefined ||
    executionGrant === undefined ||
    executionGrant.scopes.length !== 1 ||
    executionGrant.scopes[0] !== walletDelegationExecutionScope
  ) {
    throw new Error("Slice checkout authorization is incomplete.")
  }
  return { executionGrant, session }
}

const assertManagementAuthorization = (
  authorization: SliceWalletPermissionAuthorization
) => {
  const { executionGrant, session } = authorization
  if (
    session.grantKind !== "management" ||
    session.checkout !== undefined ||
    executionGrant === undefined ||
    executionGrant.scopes.length !== 1 ||
    executionGrant.scopes[0] !== walletDelegationStoreManagementScope
  ) {
    throw new Error("Slice management authorization is incomplete.")
  }
  return { executionGrant, session }
}

const parseRegistration = (
  value: SliceWalletCheckoutExecutionGrantRegistration
) => {
  if (
    typeof value.allowanceUsdMicros !== "string" ||
    !/^\d+$/.test(value.allowanceUsdMicros) ||
    (value.budgetPeriodSec !== undefined &&
      (!Number.isSafeInteger(value.budgetPeriodSec) ||
        value.budgetPeriodSec <= 0)) ||
    !isAddress(value.coSignerAddress) ||
    typeof value.delegationId !== "string" ||
    value.delegationId.length === 0 ||
    typeof value.expiresAt !== "string" ||
    Number.isNaN(new Date(value.expiresAt).getTime()) ||
    !isHex(value.permissionId, { strict: true }) ||
    hexToBytes(value.permissionId).length !== 4 ||
    !isAddress(value.signerAddress) ||
    !isValidRegistrationLifecycle(value)
  ) {
    throw new Error("Slice checkout grant response is invalid.")
  }
  return value
}

const isValidRegistrationLifecycle = (value: {
  previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
  requiresFinalization: boolean
}) => {
  if (
    typeof value.requiresFinalization !== "boolean" ||
    !Array.isArray(value.previousSessions)
  ) {
    return false
  }
  value.previousSessions.forEach(parseSliceWalletExecutionSessionDescriptor)
  return true
}

const validateWireDescriptor = (
  descriptor: SliceWalletExecutionSessionDescriptor
) => {
  parseSliceWalletExecutionSessionDescriptor(descriptor)
  return descriptor
}

const stringifyUserOperation = (value: object) =>
  JSON.stringify(value, (_key, field) =>
    typeof field === "bigint" ? `0x${field.toString(16)}` : field
  )

export const createSliceWalletCheckoutExecutionClient = ({
  apiUrl,
  fetch: fetchImpl = fetch
}: CreateSliceWalletCheckoutExecutionClientParameters): SliceWalletCheckoutExecutionClient => {
  const endpoint = (path: string) => new URL(path, apiUrl)

  const createChallenge: SliceWalletCheckoutCoSignerClient["createChallenge"] =
    async (delegationId) => {
      const body = await readJson<CoSignChallengeWire>(
        await fetchImpl(
          endpoint(
            `/wallet-delegations/execution/p256/${encodeURIComponent(delegationId)}/co-sign/challenge`
          ),
          { method: "POST" }
        )
      )
      return parseChallenge(body)
    }

  const coSign: SliceWalletCheckoutCoSignerClient["coSign"] = async (input) => {
    const body = await readJson<{
      coSignature: string
      proposalHash: string
      remainingUsdMicros: string
      userOperationHash: string
      validUntil: number
    }>(
      await fetchImpl(
        endpoint(
          `/wallet-delegations/execution/p256/${encodeURIComponent(input.delegationId)}/co-sign`
        ),
        {
          body: stringifyUserOperation({
            challenge: input.challenge,
            challengeExpiresAt: input.challengeExpiresAt,
            challengeIssuedAt: input.challengeIssuedAt,
            proofSignature: input.proofSignature,
            validUntil: input.validUntil,
            windowEndExclusive: input.windowEndExclusive,
            windowId: input.windowId,
            windowStart: input.windowStart,
            userOperation: input.userOperation
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        }
      )
    )
    if (
      !isHex(body.coSignature, { strict: true }) ||
      !isBytes32(body.proposalHash) ||
      !/^\d+$/.test(body.remainingUsdMicros) ||
      !isBytes32(body.userOperationHash) ||
      !Number.isSafeInteger(body.validUntil) ||
      body.validUntil !== input.validUntil
    ) {
      throw new Error("Slice checkout co-sign response is invalid.")
    }
    return {
      coSignature: body.coSignature,
      proposalHash: body.proposalHash,
      remainingUsdMicros: body.remainingUsdMicros,
      userOperationHash: body.userOperationHash,
      validUntil: body.validUntil
    }
  }

  return {
    coSign,
    createChallenge,
    createSessionChallenge: async (delegationId) =>
      parseSessionChallenge(
        await readJson<{ challenge: string; expiresAt: number }>(
          await fetchImpl(
            endpoint(
              `/wallet-delegations/execution/p256/${encodeURIComponent(delegationId)}/session/challenge`
            ),
            { method: "POST" }
          )
        )
      ),
    fetchDelegation: async (proof) =>
      readJson<SliceWalletCheckoutExecutionDelegationState>(
        await fetchImpl(
          endpoint(
            `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`
          ),
          {
            body: JSON.stringify({
              action: "status",
              challenge: proof.challenge,
              expiresAt: proof.expiresAt,
              proofSignature: proof.proofSignature
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          }
        )
      ),
    fetchPredecessorDescriptors: async (proof) =>
      readJson<{
        previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
      }>(
        await fetchImpl(
          endpoint(
            `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`
          ),
          {
            body: JSON.stringify({
              action: "predecessor_descriptors",
              challenge: proof.challenge,
              expiresAt: proof.expiresAt,
              proofSignature: proof.proofSignature
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          }
        )
      ).then((body) => ({
        previousSessions: body.previousSessions.map(validateWireDescriptor)
      })),
    finalizeReplacement: async (proof) =>
      readJson<{ finalized: true }>(
        await fetchImpl(
          endpoint(
            `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`
          ),
          {
            body: JSON.stringify({
              action: "finalize_replacement",
              challenge: proof.challenge,
              ...(proof.expectedDisableCallHash === undefined
                ? {}
                : {
                    expectedDisableCallHash: proof.expectedDisableCallHash
                  }),
              expiresAt: proof.expiresAt,
              proofSignature: proof.proofSignature,
              ...(proof.userOperationHash === undefined
                ? {}
                : { userOperationHash: proof.userOperationHash })
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          }
        )
      ),
    getConfiguration: async (chainId) => {
      const url = endpoint("/wallet-delegations/execution/p256/configuration")
      url.searchParams.set("chainId", String(chainId))
      const configuration = await readJson<{ coSignerAddress: Address }>(
        await fetchImpl(url)
      )
      if (!isAddress(configuration.coSignerAddress)) {
        throw new Error("Slice checkout execution configuration is invalid.")
      }
      return configuration
    },
    registerAuthorization: async (
      authorization: SliceWalletPermissionAuthorization
    ) => {
      const { executionGrant, session } =
        assertCheckoutAuthorization(authorization)
      const checkout = session.checkout
      if (checkout === undefined) {
        throw new Error("Slice checkout authorization is incomplete.")
      }
      const response =
        await readJson<SliceWalletCheckoutExecutionGrantRegistration>(
          await fetchImpl(
            endpoint("/wallet-delegations/execution/p256/grant"),
            {
              body: JSON.stringify({
                accountAddress: session.account,
                accountIndex: authorization.accountIndex,
                ...(authorization.accountFactory === undefined
                  ? {}
                  : { accountFactory: authorization.accountFactory }),
                ...(authorization.accountFactoryData === undefined
                  ? {}
                  : { accountFactoryData: authorization.accountFactoryData }),
                allowanceUsdMicros: checkout.allowanceUsdMicros,
                appOrigin: authorization.appOrigin,
                ...(checkout.budgetPeriodSec === undefined
                  ? {}
                  : { budgetPeriodSec: checkout.budgetPeriodSec }),
                chainId: session.chainId,
                coSignerAddress: checkout.coSignerAddress,
                expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
                grantKind: "checkout",
                nonce: executionGrant.nonce,
                permissionId: session.permissionId,
                policy: serializeWalletPolicyDescriptor(session.policy),
                publicKey: session.publicKey,
                rootCredentialIdHash:
                  authorization.rootCredential.credentialIdHash,
                rootPublicKey: authorization.rootCredential.publicKey,
                enableSignature: authorization.enableSignature,
                signerId: session.signerId,
                signerProof: executionGrant.signerProof,
                signerScheme: "p256"
              }),
              headers: { "content-type": "application/json" },
              method: "POST"
            }
          )
        )
      const registration = parseRegistration(response)
      if (
        registration.allowanceUsdMicros !== checkout.allowanceUsdMicros ||
        registration.budgetPeriodSec !== checkout.budgetPeriodSec ||
        registration.coSignerAddress.toLowerCase() !==
          checkout.coSignerAddress.toLowerCase() ||
        registration.permissionId.toLowerCase() !==
          session.permissionId.toLowerCase() ||
        registration.signerAddress.toLowerCase() !==
          session.signerId.toLowerCase()
      ) {
        throw new Error(
          "Slice checkout grant response does not match its request."
        )
      }
      return registration
    },
    revokeDelegation: async (proof) =>
      readJson<{ revoked: true }>(
        await fetchImpl(
          endpoint(
            `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`
          ),
          {
            body: JSON.stringify({
              action: "revoke",
              challenge: proof.challenge,
              expectedDisableCallHash: proof.expectedDisableCallHash,
              expiresAt: proof.expiresAt,
              proofSignature: proof.proofSignature,
              userOperationHash: proof.userOperationHash
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          }
        )
      )
  }
}

export const createSliceWalletManagementExecutionClient = ({
  apiUrl,
  fetch: fetchImpl = fetch
}: CreateSliceWalletCheckoutExecutionClientParameters): SliceWalletManagementExecutionClient => ({
  createSessionChallenge: async (delegationId) =>
    parseSessionChallenge(
      await readJson<{ challenge: string; expiresAt: number }>(
        await fetchImpl(
          new URL(
            `/wallet-delegations/execution/p256/${encodeURIComponent(delegationId)}/session/challenge`,
            apiUrl
          ),
          { method: "POST" }
        )
      )
    ),
  fetchPredecessorDescriptors: async (proof) =>
    readJson<{
      previousSessions: readonly SliceWalletExecutionSessionDescriptor[]
    }>(
      await fetchImpl(
        new URL(
          `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`,
          apiUrl
        ),
        {
          body: JSON.stringify({
            action: "predecessor_descriptors",
            challenge: proof.challenge,
            expiresAt: proof.expiresAt,
            proofSignature: proof.proofSignature
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        }
      )
    ).then((body) => ({
      previousSessions: body.previousSessions.map(validateWireDescriptor)
    })),
  finalizeReplacement: async (proof) =>
    readJson<{ finalized: true }>(
      await fetchImpl(
        new URL(
          `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`,
          apiUrl
        ),
        {
          body: JSON.stringify({
            action: "finalize_replacement",
            challenge: proof.challenge,
            ...(proof.expectedDisableCallHash === undefined
              ? {}
              : { expectedDisableCallHash: proof.expectedDisableCallHash }),
            expiresAt: proof.expiresAt,
            proofSignature: proof.proofSignature,
            ...(proof.userOperationHash === undefined
              ? {}
              : { userOperationHash: proof.userOperationHash })
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        }
      )
    ),
  registerAuthorization: async ({ authorization, slicerAddress, slicerId }) => {
    if (!Number.isSafeInteger(slicerId) || slicerId < 0) {
      throw new Error(
        "Slice management grant requires a non-negative slicer id."
      )
    }
    const { executionGrant, session } =
      assertManagementAuthorization(authorization)
    const registration =
      await readJson<SliceWalletManagementExecutionGrantRegistration>(
        await fetchImpl(
          new URL("/wallet-delegations/execution/p256/grant", apiUrl),
          {
            body: JSON.stringify({
              accountAddress: session.account,
              accountIndex: authorization.accountIndex,
              ...(authorization.accountFactory === undefined
                ? {}
                : { accountFactory: authorization.accountFactory }),
              ...(authorization.accountFactoryData === undefined
                ? {}
                : { accountFactoryData: authorization.accountFactoryData }),
              appOrigin: authorization.appOrigin,
              chainId: session.chainId,
              expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
              grantKind: "management",
              nonce: executionGrant.nonce,
              permissionId: session.permissionId,
              policy: serializeWalletPolicyDescriptor(session.policy),
              publicKey: session.publicKey,
              rootCredentialIdHash:
                authorization.rootCredential.credentialIdHash,
              rootPublicKey: authorization.rootCredential.publicKey,
              enableSignature: authorization.enableSignature,
              signerId: session.signerId,
              signerProof: executionGrant.signerProof,
              signerScheme: "p256",
              slicerAddress,
              slicerId
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          }
        )
      )
    if (
      typeof registration.delegationId !== "string" ||
      registration.delegationId.length === 0 ||
      Number.isNaN(new Date(registration.expiresAt).getTime()) ||
      !isHex(registration.permissionId, { strict: true }) ||
      hexToBytes(registration.permissionId).length !== 4 ||
      !isAddress(registration.signerAddress) ||
      !isAddress(registration.slicerAddress) ||
      !Number.isSafeInteger(registration.slicerId) ||
      registration.slicerId < 0 ||
      registration.permissionId.toLowerCase() !==
        session.permissionId.toLowerCase() ||
      registration.signerAddress.toLowerCase() !==
        session.signerId.toLowerCase() ||
      registration.slicerAddress.toLowerCase() !==
        slicerAddress.toLowerCase() ||
      registration.slicerId !== slicerId ||
      !isValidRegistrationLifecycle(registration)
    ) {
      throw new Error(
        "Slice management grant response does not match its request."
      )
    }
    return registration
  },
  revokeDelegation: async (proof) =>
    readJson<{ revoked: true }>(
      await fetchImpl(
        new URL(
          `/wallet-delegations/execution/p256/${encodeURIComponent(proof.delegationId)}/session`,
          apiUrl
        ),
        {
          body: JSON.stringify({
            action: "revoke",
            challenge: proof.challenge,
            expectedDisableCallHash: proof.expectedDisableCallHash,
            expiresAt: proof.expiresAt,
            proofSignature: proof.proofSignature,
            userOperationHash: proof.userOperationHash
          }),
          headers: { "content-type": "application/json" },
          method: "POST"
        }
      )
    )
})
