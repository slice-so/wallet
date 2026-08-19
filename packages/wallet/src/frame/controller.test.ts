import { describe, expect, test } from "bun:test"
import type { SliceWalletProtocolValue } from "@slicekit/wallet-primitives/server"
import {
  createNativeTransferCallRule,
  getWalletPolicyHash,
  verifySliceWalletP256
} from "@slicekit/wallet-primitives/server"
import { type Address, type Hex, hexToBytes } from "viem"
import {
  createSliceCheckoutPolicyDescriptor,
  createSliceStoreManagementPolicyDescriptor
} from "../execution/commerce/policies"
import type {
  SliceWalletFrameResponse,
  SliceWalletMessageWindow,
  SliceWalletSessionStore,
  SliceWalletStoredSession,
  SliceWalletWindowMessage
} from "../types/frame"
import { attachSliceWalletSignerFrame } from "./controller"
import {
  hashSliceWalletAppPermissionRegistrationFields,
  hashSliceWalletAppPermissionRequestFields,
  hashSliceWalletSessionRequest
} from "./messages"

const account = "0x1000000000000000000000000000000000000001" as Address
const recipient = "0x2000000000000000000000000000000000000002" as Address
const nonce = `0x${"33".repeat(32)}` as Hex

class MockMessageWindow implements SliceWalletMessageWindow {
  readonly listeners = new Set<(event: SliceWalletWindowMessage) => void>()

  constructor(readonly parent: MessageEventSource) {}

  addEventListener(
    _type: "message",
    listener: (event: SliceWalletWindowMessage) => void
  ) {
    this.listeners.add(listener)
  }

  dispatch(event: SliceWalletWindowMessage) {
    for (const listener of this.listeners) listener(event)
  }

  removeEventListener(
    _type: "message",
    listener: (event: SliceWalletWindowMessage) => void
  ) {
    this.listeners.delete(listener)
  }
}

class MemorySessionStore implements SliceWalletSessionStore {
  readonly records = new Map<string, SliceWalletStoredSession>()
  readonly pending = new Map<string, SliceWalletStoredSession>()
  readonly unlockedAccounts = new Set<string>()

  private key(
    origin: string,
    session: {
      account: Address
      chainId: number
      grantKind: string
    }
  ) {
    return [origin, session.account, session.chainId, session.grantKind].join(
      ":"
    )
  }

  async delete(
    origin: string,
    session: Parameters<MemorySessionStore["key"]>[1]
  ) {
    this.records.delete(this.key(origin, session))
    this.pending.delete(this.key(origin, session))
  }

  async deletePending(
    origin: string,
    session: Parameters<MemorySessionStore["key"]>[1]
  ) {
    this.pending.delete(this.key(origin, session))
  }

  async get(origin: string, session: Parameters<MemorySessionStore["key"]>[1]) {
    return this.records.get(this.key(origin, session)) ?? null
  }

  async getPending(
    origin: string,
    session: Parameters<MemorySessionStore["key"]>[1]
  ) {
    return this.pending.get(this.key(origin, session)) ?? null
  }

  async isAccountUnlocked(origin: string, accountAddress: Address) {
    return this.unlockedAccounts.has(
      `${new URL(origin).origin}:${accountAddress.toLowerCase()}`
    )
  }

  async putPending(record: SliceWalletStoredSession) {
    this.pending.set(this.key(record.appOrigin, record.session), record)
  }

  async setAccountUnlocked(
    origin: string,
    accountAddress: Address,
    unlocked: boolean
  ) {
    const key = `${new URL(origin).origin}:${accountAddress.toLowerCase()}`
    if (unlocked) this.unlockedAccounts.add(key)
    else this.unlockedAccounts.delete(key)
  }

  async commitPending(
    origin: string,
    session: Parameters<MemorySessionStore["key"]>[1]
  ) {
    const id = this.key(origin, session)
    const record = this.pending.get(id)
    if (record === undefined) throw new Error("Missing pending session.")
    this.records.set(id, record)
    this.pending.delete(id)
    return record
  }
}

const receive = (port: MessagePort, timeoutMs = 100) =>
  new Promise<SliceWalletFrameResponse | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs)
    port.addEventListener(
      "message",
      (event: MessageEvent<SliceWalletFrameResponse>) => {
        clearTimeout(timeout)
        resolve(event.data)
      },
      { once: true }
    )
    port.start()
  })

const unlockCommittedAccount = async (
  window: MockMessageWindow,
  parent: MessageEventSource
) => {
  const channel = new MessageChannel()
  const record = receive(channel.port1)
  window.dispatch({
    data: {
      account,
      nonce,
      type: "slice-wallet:bridge-unlock-challenge",
      version: 1
    },
    origin: "https://id.slice.so",
    ports: [channel.port2],
    source: parent
  })
  expect(await record).toMatchObject({
    account,
    nonce,
    origin: "https://app.example",
    type: "slice-wallet:bridge-unlock-record"
  })
  const response = receive(channel.port1)
  channel.port1.postMessage({
    account,
    nonce,
    type: "slice-wallet:bridge-unlock",
    version: 1
  } satisfies SliceWalletProtocolValue)
  expect(await response).toMatchObject({
    account,
    nonce,
    type: "slice-wallet:bridge-unlocked"
  })
}

describe("isolated signer-frame controller", () => {
  test("rejects odd-length application permission identity fields", () => {
    expect(() =>
      hashSliceWalletAppPermissionRequestFields({
        accountAddress: account,
        accountIndex: 0,
        appOrigin: "https://app.example",
        chainId: 8453,
        permissionId: "0x1234567" as Hex,
        policyHash: `0x${"11".repeat(32)}`,
        signerAddress: recipient,
        signerPublicKey: `0x04${"22".repeat(64)}`
      })
    ).toThrow("Permission id must be canonical 4-byte hex.")
  })

  test("binds the first parent origin and rejects substitute connections", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect-1", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    expect(await connected).toMatchObject({ id: "connect-1", result: null })

    const policy = {
      account,
      calls: [createNativeTransferCallRule({ maximumValue: 1n, recipient })],
      chainId: 8453,
      grantKind: "generic",
      rateLimit: { count: 1, intervalSec: 60 },
      validAfter: Math.floor(Date.now() / 1_000) - 300,
      validUntil: Math.floor(Date.now() / 1_000) + 3_600,
      version: 1
    } as const
    const created = receive(connection.port1)
    connection.port1.postMessage({
      id: "create-1",
      method: "createSession",
      params: { policy },
      version: 1
    } satisfies SliceWalletProtocolValue)
    const createdResponse = await created
    expect(createdResponse).not.toBeNull()
    expect(store.pending.size).toBe(1)
    expect([...store.pending.values()][0]?.appOrigin).toBe(
      "https://app.example"
    )

    const substituteParent = new MessageChannel()
    const substituteConnection = new MessageChannel()
    const substituteResponse = receive(substituteConnection.port1, 25)
    window.dispatch({
      data: { id: "connect-2", method: "connect", version: 1 },
      origin: "https://evil.example",
      ports: [substituteConnection.port2],
      source: substituteParent.port1
    })
    expect(await substituteResponse).toBeNull()
    detach()
  })

  test("rejects a non-canonical checkout policy at the frame boundary", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected

    const response = receive(connection.port1)
    connection.port1.postMessage({
      id: "create-checkout",
      method: "createSession",
      params: {
        checkout: {
          allowanceUsdMicros: "100000000",
          coSignerAddress: recipient
        },
        policy: {
          account,
          calls: [
            createNativeTransferCallRule({ maximumValue: 1n, recipient })
          ],
          chainId: 8453,
          grantKind: "checkout",
          validAfter: 90,
          validUntil: 1_000,
          version: 1
        }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)

    expect(await response).toMatchObject({
      error: {
        message: "Checkout wallet policy contains unsupported authority."
      },
      id: "create-checkout"
    })
    expect(store.pending.size).toBe(0)
    detach()
  })

  test("unlocks a committed session only through the pinned id bridge", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected
    const policy = {
      account,
      calls: [createNativeTransferCallRule({ maximumValue: 1n, recipient })],
      chainId: 8453,
      grantKind: "generic",
      rateLimit: { count: 1, intervalSec: 60 },
      validAfter: Math.floor(Date.now() / 1_000) - 300,
      validUntil: Math.floor(Date.now() / 1_000) + 3_600,
      version: 1
    } as const
    const created = receive(connection.port1)
    connection.port1.postMessage({
      id: "create",
      method: "createSession",
      params: { policy },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await created
    const challenge = {
      account,
      chainId: 8453,
      grantKind: "generic",
      nonce,
      type: "slice-wallet:bridge-challenge",
      version: 1
    } as const

    const spoofed = new MessageChannel()
    const spoofedResponse = receive(spoofed.port1, 25)
    window.dispatch({
      data: challenge,
      origin: "https://app.example",
      ports: [spoofed.port2],
      source: parent.port1
    })
    expect(await spoofedResponse).toBeNull()

    const trusted = new MessageChannel()
    const trustedResponse = receive(trusted.port1)
    window.dispatch({
      data: challenge,
      origin: "https://id.slice.so",
      ports: [trusted.port2],
      source: parent.port1
    })
    expect(await trustedResponse).toMatchObject({
      nonce,
      origin: "https://app.example",
      type: "slice-wallet:bridge-record"
    })
    const pendingSession = [...store.pending.values()][0]?.session
    if (pendingSession === undefined) {
      throw new Error("Missing pending generic session.")
    }
    const registrationChallenge = `0x${"77".repeat(32)}` as Hex
    const registrationIdentity = {
      accountAddress: pendingSession.account,
      accountIndex: 0,
      appOrigin: "https://app.example",
      chainId: pendingSession.chainId,
      permissionId: pendingSession.permissionId,
      policyHash: getWalletPolicyHash(pendingSession.policy),
      signerAddress: pendingSession.signerId,
      signerPublicKey: pendingSession.publicKey
    }
    const requestHash =
      hashSliceWalletAppPermissionRequestFields(registrationIdentity)
    const registrationProof = receive(trusted.port1)
    trusted.port1.postMessage({
      accountIndex: 0,
      action: "register",
      challenge: registrationChallenge,
      challengeExpiresAt: 1_800_000_100,
      requestHash,
      session: { account, chainId: 8453, grantKind: "generic" },
      type: "slice-wallet:bridge-sign-registration",
      version: 1
    } satisfies SliceWalletProtocolValue)
    const proofResponse = await registrationProof
    if (
      proofResponse === null ||
      !("signature" in proofResponse) ||
      typeof proofResponse.signature !== "string"
    ) {
      throw new Error("Missing registration proof.")
    }
    const registrationSignature = proofResponse.signature as Hex
    expect(proofResponse).toMatchObject({
      signature: expect.stringMatching(/^0x[0-9a-f]{128}$/),
      type: "slice-wallet:bridge-registration-proof",
      version: 1
    })
    expect(
      await verifySliceWalletP256({
        message: hexToBytes(
          hashSliceWalletAppPermissionRegistrationFields({
            ...registrationIdentity,
            action: "register",
            challenge: registrationChallenge,
            challengeExpiresAt: 1_800_000_100,
            requestHash
          })
        ),
        publicKey: pendingSession.publicKey,
        signature: registrationSignature
      })
    ).toBe(true)

    const committed = receive(connection.port1)
    connection.port1.postMessage({
      id: "commit",
      method: "commitSession",
      params: { account, chainId: 8453, grantKind: "generic" },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    const locked = receive(connection.port1)
    connection.port1.postMessage({
      id: "lock",
      method: "lockAccount",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await locked
    const lockedState = receive(connection.port1)
    connection.port1.postMessage({
      id: "locked-state",
      method: "getAccountLockState",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await lockedState).toMatchObject({
      id: "locked-state",
      result: "locked"
    })

    const unlockChallenge = {
      account,
      nonce,
      type: "slice-wallet:bridge-unlock-challenge",
      version: 1
    } as const
    const untrustedUnlock = new MessageChannel()
    const untrustedUnlockResponse = receive(untrustedUnlock.port1, 25)
    window.dispatch({
      data: unlockChallenge,
      origin: "https://app.example",
      ports: [untrustedUnlock.port2],
      source: parent.port1
    })
    expect(await untrustedUnlockResponse).toBeNull()

    const trustedUnlock = new MessageChannel()
    const unlockRecord = receive(trustedUnlock.port1)
    window.dispatch({
      data: unlockChallenge,
      origin: "https://id.slice.so",
      ports: [trustedUnlock.port2],
      source: parent.port1
    })
    expect(await unlockRecord).toMatchObject({
      account,
      nonce,
      origin: "https://app.example",
      type: "slice-wallet:bridge-unlock-record"
    })
    const unlockResponse = receive(trustedUnlock.port1)
    trustedUnlock.port1.postMessage({
      account,
      nonce,
      type: "slice-wallet:bridge-unlock",
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await unlockResponse).toMatchObject({
      account,
      nonce,
      type: "slice-wallet:bridge-unlocked"
    })
    const unlockedState = receive(connection.port1)
    connection.port1.postMessage({
      id: "unlocked-state",
      method: "getAccountLockState",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await unlockedState).toMatchObject({
      id: "unlocked-state",
      result: "unlocked"
    })
    detach()

    const restartedParent = new MessageChannel()
    const restartedWindow = new MockMessageWindow(restartedParent.port1)
    const detachRestarted = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window: restartedWindow
    })
    const restartedConnection = new MessageChannel()
    const restarted = receive(restartedConnection.port1)
    restartedWindow.dispatch({
      data: { id: "reconnect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [restartedConnection.port2],
      source: restartedParent.port1
    })
    await restarted
    const restartedState = receive(restartedConnection.port1)
    restartedConnection.port1.postMessage({
      id: "restarted-state",
      method: "getAccountLockState",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await restartedState).toMatchObject({
      id: "restarted-state",
      result: "unlocked"
    })
    detachRestarted()
  })

  test("propagates an explicit account lock to another frame instance", async () => {
    const store = new MemorySessionStore()
    const firstParent = new MessageChannel()
    const firstWindow = new MockMessageWindow(firstParent.port1)
    const secondParent = new MessageChannel()
    const secondWindow = new MockMessageWindow(secondParent.port1)
    const detachFirst = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window: firstWindow
    })
    const detachSecond = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window: secondWindow
    })
    const firstConnection = new MessageChannel()
    const secondConnection = new MessageChannel()
    const firstConnected = receive(firstConnection.port1)
    const secondConnected = receive(secondConnection.port1)
    firstWindow.dispatch({
      data: { id: "connect-first", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [firstConnection.port2],
      source: firstParent.port1
    })
    secondWindow.dispatch({
      data: { id: "connect-second", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [secondConnection.port2],
      source: secondParent.port1
    })
    await Promise.all([firstConnected, secondConnected])
    const policy = createSliceCheckoutPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 1_000,
      startsAt: 90
    })
    const created = receive(secondConnection.port1)
    secondConnection.port1.postMessage({
      id: "create-second",
      method: "createSession",
      params: {
        checkout: {
          allowanceUsdMicros: "100000000",
          coSignerAddress: recipient
        },
        policy
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await created
    const committed = receive(secondConnection.port1)
    secondConnection.port1.postMessage({
      id: "commit-second",
      method: "commitSession",
      params: { account, chainId: 8453, grantKind: "checkout" },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    await unlockCommittedAccount(firstWindow, firstParent.port1)

    const unlocked = receive(secondConnection.port1)
    secondConnection.port1.postMessage({
      id: "second-unlocked",
      method: "getAccountLockState",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await unlocked).toMatchObject({
      id: "second-unlocked",
      result: "unlocked"
    })

    const locked = receive(firstConnection.port1)
    firstConnection.port1.postMessage({
      id: "lock-first",
      method: "lockAccount",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await locked
    const secondState = receive(secondConnection.port1)
    secondConnection.port1.postMessage({
      id: "second-locked",
      method: "getAccountLockState",
      params: { account },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await secondState).toMatchObject({
      id: "second-locked",
      result: "locked"
    })
    const refused = receive(secondConnection.port1)
    secondConnection.port1.postMessage({
      id: "sign-after-lock",
      method: "signSessionRequest",
      params: {
        action: "status",
        challenge: nonce,
        delegationId: "delegation-1",
        expiresAt: 200,
        session: { account, chainId: 8453, grantKind: "checkout" }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await refused).toMatchObject({
      error: {
        code: "invalid_request",
        message: "Wallet session is locked. Connect with your passkey."
      },
      id: "sign-after-lock"
    })

    detachFirst()
    detachSecond()
  })

  test("answers an account-wide management bridge challenge and rejects slicer scope", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected
    const created = receive(connection.port1)
    connection.port1.postMessage({
      id: "create-management",
      method: "createSession",
      params: {
        policy: createSliceStoreManagementPolicyDescriptor({
          account,
          chainId: 8453,
          expiresAt: 2_000_000_000,
          startsAt: 100
        })
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await created

    const scoped = new MessageChannel()
    const scopedResponse = receive(scoped.port1, 25)
    window.dispatch({
      data: {
        account,
        chainId: 8453,
        grantKind: "management",
        nonce,
        slicerId: 0,
        type: "slice-wallet:bridge-challenge",
        version: 1
      },
      origin: "https://id.slice.so",
      ports: [scoped.port2],
      source: parent.port1
    })
    expect(await scopedResponse).toBeNull()

    const trusted = new MessageChannel()
    const trustedResponse = receive(trusted.port1)
    window.dispatch({
      data: {
        account,
        chainId: 8453,
        grantKind: "management",
        nonce,
        type: "slice-wallet:bridge-challenge",
        version: 1
      },
      origin: "https://id.slice.so",
      ports: [trusted.port2],
      source: parent.port1
    })
    expect(await trustedResponse).toMatchObject({
      session: { account, chainId: 8453, grantKind: "management" },
      type: "slice-wallet:bridge-record"
    })
    detach()
  })

  test("signs a structured status proof with the committed checkout key", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected

    const policy = createSliceCheckoutPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 1_000,
      startsAt: 90
    })
    const created = receive(connection.port1)
    connection.port1.postMessage({
      id: "create",
      method: "createSession",
      params: {
        checkout: {
          allowanceUsdMicros: "100000000",
          coSignerAddress: recipient
        },
        policy
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await created

    const committed = receive(connection.port1)
    connection.port1.postMessage({
      id: "commit",
      method: "commitSession",
      params: { account, chainId: 8453, grantKind: "checkout" },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    await unlockCommittedAccount(window, parent.port1)

    const signed = receive(connection.port1)
    connection.port1.postMessage({
      id: "status",
      method: "signSessionRequest",
      params: {
        action: "status",
        challenge: nonce,
        delegationId: "delegation-1",
        expiresAt: 200,
        session: { account, chainId: 8453, grantKind: "checkout" }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await signed).toMatchObject({
      id: "status",
      result: expect.stringMatching(/^0x[0-9a-f]{128}$/)
    })
    detach()
  })

  test("signs replacement finalization with the pending checkout key", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected
    const policy = createSliceCheckoutPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 1_000,
      startsAt: 90
    })
    const create = async (id: string) => {
      const response = receive(connection.port1)
      connection.port1.postMessage({
        id,
        method: "createSession",
        params: {
          checkout: {
            allowanceUsdMicros: "100000000",
            coSignerAddress: recipient
          },
          policy
        },
        version: 1
      } satisfies SliceWalletProtocolValue)
      await response
      const created = [...store.pending.values()][0]?.session
      if (created === undefined) throw new Error("Missing pending session.")
      return created
    }
    const committedSession = await create("old")
    const committed = receive(connection.port1)
    connection.port1.postMessage({
      id: "commit",
      method: "commitSession",
      params: { account, chainId: 8453, grantKind: "checkout" },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    const pendingSession = await create("new")
    const signed = receive(connection.port1)
    connection.port1.postMessage({
      id: "finalize",
      method: "signSessionRequest",
      params: {
        action: "finalize_replacement",
        challenge: nonce,
        delegationId: "new-delegation",
        expiresAt: 200,
        session: { account, chainId: 8453, grantKind: "checkout" }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    const response = await signed
    if (
      response === null ||
      !("result" in response) ||
      typeof response.result !== "string"
    ) {
      throw new Error("Missing replacement signature.")
    }
    const signature = response.result as Hex
    const message = hexToBytes(
      hashSliceWalletSessionRequest({
        action: "finalize_replacement",
        appOrigin: "https://app.example",
        challenge: nonce,
        delegationId: "new-delegation",
        expiresAt: 200,
        session: pendingSession
      })
    )
    expect(
      await verifySliceWalletP256({
        message,
        publicKey: pendingSession.publicKey,
        signature
      })
    ).toBe(true)
    expect(
      await verifySliceWalletP256({
        message,
        publicKey: committedSession.publicKey,
        signature
      })
    ).toBe(false)
    detach()
  })

  test("signs replacement finalization from a pending management session", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected
    const response = receive(connection.port1)
    connection.port1.postMessage({
      id: "create",
      method: "createSession",
      params: {
        policy: createSliceStoreManagementPolicyDescriptor({
          account,
          chainId: 8453,
          expiresAt: 1_000,
          startsAt: 90
        })
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await response
    const pendingSession = [...store.pending.values()][0]?.session
    const signed = receive(connection.port1)
    connection.port1.postMessage({
      id: "finalize",
      method: "signSessionRequest",
      params: {
        action: "finalize_replacement",
        challenge: nonce,
        delegationId: "management-delegation",
        expiresAt: 200,
        session: {
          account,
          chainId: 8453,
          grantKind: "management"
        }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await signed).toMatchObject({
      id: "finalize",
      result: expect.stringMatching(/^0x[0-9a-f]{128}$/)
    })
    expect(pendingSession.grantKind).toBe("management")

    const committed = receive(connection.port1)
    connection.port1.postMessage({
      id: "commit",
      method: "commitSession",
      params: {
        account,
        chainId: 8453,
        grantKind: "management"
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    await unlockCommittedAccount(window, parent.port1)
    const revoked = receive(connection.port1)
    connection.port1.postMessage({
      id: "revoke",
      method: "signSessionRequest",
      params: {
        action: "revoke",
        challenge: nonce,
        delegationId: "management-delegation",
        expiresAt: 200,
        session: {
          account,
          chainId: 8453,
          grantKind: "management"
        }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await revoked).toMatchObject({
      id: "revoke",
      result: expect.stringMatching(/^0x[0-9a-f]{128}$/)
    })
    detach()
  })

  test("runs the malicious-transport drill before producing a co-sign proof", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected

    const policy = createSliceCheckoutPolicyDescriptor({
      account,
      chainId: 8453,
      expiresAt: 1_000,
      startsAt: 90
    })
    const created = receive(connection.port1)
    connection.port1.postMessage({
      id: "create",
      method: "createSession",
      params: {
        checkout: {
          allowanceUsdMicros: "100000000",
          coSignerAddress: recipient
        },
        policy
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await created
    const committed = receive(connection.port1)
    connection.port1.postMessage({
      id: "commit",
      method: "commitSession",
      params: { account, chainId: 8453, grantKind: "checkout" },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    await unlockCommittedAccount(window, parent.port1)

    const refused = receive(connection.port1)
    connection.port1.postMessage({
      id: "co-sign",
      method: "signCoSignRequest",
      params: {
        challenge: nonce,
        challengeExpiresAt: 200,
        challengeIssuedAt: 100,
        delegationId: "delegation-1",
        session: { account, chainId: 8453, grantKind: "checkout" },
        userOperation: {
          callData: "0x",
          callGasLimit: 3_000_001n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          nonce: 1n,
          preVerificationGas: 1n,
          sender: account,
          verificationGasLimit: 1n
        },
        validUntil: 200,
        windowEndExclusive: 2_000_000_001,
        windowId: "lifetime",
        windowStart: 0
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await refused).toMatchObject({
      error: {
        code: "invalid_request",
        message: "Wallet operation exceeds the gas safety envelope."
      },
      id: "co-sign"
    })
    detach()
  })

  test("runs the malicious-transport drill before scoped-session signing", async () => {
    const parent = new MessageChannel()
    const window = new MockMessageWindow(parent.port1)
    const store = new MemorySessionStore()
    const detach = attachSliceWalletSignerFrame({
      decodeScopedCalls: () => [{ to: recipient, value: 1n }],
      now: () => 100,
      selfOrigin: "https://id.slice.so",
      sessionStore: store,
      validateCheckoutCalls: () => {},
      window
    })
    const connection = new MessageChannel()
    const connected = receive(connection.port1)
    window.dispatch({
      data: { id: "connect", method: "connect", version: 1 },
      origin: "https://app.example",
      ports: [connection.port2],
      source: parent.port1
    })
    await connected

    const policy = {
      account,
      calls: [createNativeTransferCallRule({ maximumValue: 1n, recipient })],
      chainId: 8453,
      grantKind: "generic",
      rateLimit: { count: 1, intervalSec: 60 },
      validAfter: 90,
      validUntil: 1_000,
      version: 1
    } as const
    const created = receive(connection.port1)
    connection.port1.postMessage({
      id: "create",
      method: "createSession",
      params: { policy },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await created
    const committed = receive(connection.port1)
    connection.port1.postMessage({
      id: "commit",
      method: "commitSession",
      params: { account, chainId: 8453, grantKind: "generic" },
      version: 1
    } satisfies SliceWalletProtocolValue)
    await committed
    await unlockCommittedAccount(window, parent.port1)

    const refused = receive(connection.port1)
    connection.port1.postMessage({
      id: "scoped-sign",
      method: "signScopedUserOperation",
      params: {
        session: { account, chainId: 8453, grantKind: "generic" },
        userOperation: {
          callData: "0x",
          callGasLimit: 3_000_001n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          nonce: 1n,
          preVerificationGas: 1n,
          sender: account,
          verificationGasLimit: 1n
        }
      },
      version: 1
    } satisfies SliceWalletProtocolValue)
    expect(await refused).toMatchObject({
      error: {
        code: "invalid_request",
        message: "Wallet operation exceeds the gas safety envelope."
      },
      id: "scoped-sign"
    })
    detach()
  })
})
