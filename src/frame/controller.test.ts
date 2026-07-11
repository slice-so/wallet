import { describe, expect, test } from "bun:test"
import type { Address, Hex } from "viem"
import { createNativeTransferCallRule } from "../policy"
import type {
  SliceWalletFrameResponse,
  SliceWalletMessageWindow,
  SliceWalletProtocolValue,
  SliceWalletSessionStore,
  SliceWalletStoredSession,
  SliceWalletWindowMessage
} from "../types/frame"
import { attachSliceWalletSignerFrame } from "./controller"

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

  private key(
    origin: string,
    session: { account: Address; chainId: number; grantKind: string }
  ) {
    return `${origin}:${session.account}:${session.chainId}:${session.grantKind}`
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

  async putPending(record: SliceWalletStoredSession) {
    this.pending.set(this.key(record.appOrigin, record.session), record)
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

describe("isolated signer-frame controller", () => {
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
      validAfter: 100,
      validUntil: 2_000_000_000,
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

  test("answers bridge challenges only from the pinned id origin", async () => {
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
      validAfter: 100,
      validUntil: 2_000_000_000,
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
    detach()
  })
})
