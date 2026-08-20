import { describe, expect, it, mock } from "bun:test"
import type { Hex } from "viem"
import type { SliceWalletProtocolValue } from "../protocol/index"
import { formatSliceWalletExistingCredentialAuthorization } from "../registry"
import type {
  SliceWalletRecoveryHandoffAuthorizationRequest,
  SliceWalletRecoveryHandoffCredentialResponse
} from "../types"
import {
  isSliceWalletRecoveryHandoffDeploymentProfileMatch,
  registerRecoveredSliceWalletCredential
} from "./recoveryClient"

const account = "0x1111111111111111111111111111111111111111" as const
const recoveryPermissionId = "0x12345678" as const
const recoverySignerAddress =
  "0x2222222222222222222222222222222222222222" as const
const credentialIdHash = `0x${"33".repeat(32)}` as Hex
const publicKey = `0x04${"44".repeat(64)}` as Hex
const challenge = `0x${"55".repeat(32)}` as Hex

const createRecoveryWindow = (
  authorizationFactoryVersion = "slice-kernel-v4-ep09-r1"
) => {
  let onWindowMessage:
    | ((event: MessageEvent<SliceWalletProtocolValue>) => void)
    | null = null
  let closed = false
  const popup = Object.assign(Object.create(null) as WindowProxy, {
    close: mock(() => {
      closed = true
    }),
    get closed() {
      return closed
    },
    postMessage: (
      message: SliceWalletProtocolValue,
      _targetOrigin: string,
      transfer: Transferable[]
    ) => {
      const port = transfer[0]
      if (!(port instanceof MessagePort)) {
        throw new Error("Recovery ceremony is missing its message port.")
      }
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message)
      ) {
        throw new Error("Recovery ceremony connect message is invalid.")
      }
      const messageRecord = message as {
        readonly [key: string]: SliceWalletProtocolValue
      }
      if (typeof messageRecord.nonce !== "string") {
        throw new Error("Recovery ceremony connect nonce is invalid.")
      }
      const nonce = messageRecord.nonce as Hex
      const authorization = {
        account,
        accountIndex: 7,
        challenge,
        chainId: 8453,
        credentialIdHash,
        factoryVersion: authorizationFactoryVersion,
        message: formatSliceWalletExistingCredentialAuthorization({
          accountAddress: account,
          accountIndex: 7,
          challenge,
          chainId: 8453,
          credentialIdHash,
          factoryVersion: authorizationFactoryVersion,
          publicKey
        }),
        nonce,
        publicKey,
        type: "slice-wallet:recovery-root-authorization",
        version: 1
      } satisfies SliceWalletRecoveryHandoffAuthorizationRequest
      port.addEventListener(
        "message",
        (event: MessageEvent<SliceWalletProtocolValue>) => {
          if (
            typeof event.data !== "object" ||
            event.data === null ||
            Array.isArray(event.data)
          ) {
            return
          }
          const response = event.data as {
            readonly [key: string]: SliceWalletProtocolValue
          }
          if (response.type !== "slice-wallet:recovery-root-signature") return
          const result = {
            credentialId: "recovered-credential",
            nonce,
            registry: {
              accountAddress: account,
              accountIndex: authorization.accountIndex,
              createdAt: new Date().toISOString(),
              credentialIdHash: authorization.credentialIdHash,
              factoryVersion: authorization.factoryVersion,
              publicKey: authorization.publicKey,
              recoveryPermissionId,
              recoverySignerAddress,
              registrationKind: "existing_account"
            },
            type: "slice-wallet:recovery-credential",
            version: 1
          } satisfies SliceWalletRecoveryHandoffCredentialResponse
          port.postMessage(result)
        },
        { once: true }
      )
      port.start()
      port.postMessage(authorization)
      port.postMessage({
        ...authorization,
        credentialIdHash: `0x${"66".repeat(32)}`,
        publicKey: `0x04${"77".repeat(64)}`
      })
    }
  })
  const window = Object.assign(Object.create(null) as Window, {
    addEventListener: (type: string, listener: EventListener) => {
      if (type === "message") {
        onWindowMessage = listener as (
          event: MessageEvent<SliceWalletProtocolValue>
        ) => void
      }
    },
    crypto: globalThis.crypto,
    matchMedia: () => ({ matches: false }),
    navigator: {
      userActivation: { isActive: true },
      userAgent: "Mozilla/5.0 Chrome/140.0 Safari/537.36"
    },
    open: mock(() => {
      queueMicrotask(() =>
        onWindowMessage?.(
          Object.assign(
            Object.create(null) as MessageEvent<SliceWalletProtocolValue>,
            {
              data: { type: "slice-wallet:ceremony-ready", version: 1 },
              origin: "https://id.slice.so",
              source: popup
            }
          )
        )
      )
      return popup
    }),
    removeEventListener: (type: string, listener: EventListener) => {
      if (type === "message" && onWindowMessage === listener) {
        onWindowMessage = null
      }
    }
  })
  return window
}

describe("recovery credential handoff", () => {
  it("matches only the deployment profile requested by the recovery app", () => {
    expect(
      isSliceWalletRecoveryHandoffDeploymentProfileMatch({
        factoryVersion: "slice-kernel-v4-ep09-r1",
        requestFactoryVersion: "slice-kernel-v4-ep09-r1"
      })
    ).toBe(true)
    expect(
      isSliceWalletRecoveryHandoffDeploymentProfileMatch({
        factoryVersion: "slice-kernel-v4-ep09-r1",
        requestFactoryVersion: "slice-kernel-future"
      })
    ).toBe(false)
  })

  it("does not sign an authorization carrying an unknown profile", async () => {
    const signMessage = mock(async () => "0x1234" as Hex)

    await expect(
      registerRecoveredSliceWalletCredential({
        account,
        accountIndex: 7,
        chainId: 8453,
        factoryVersion: "slice-kernel-v4-ep09-r1",
        idOrigin: "https://id.slice.so",
        recoveryPermissionId,
        recoverySignerAddress,
        signMessage,
        timeoutMs: 100,
        window: createRecoveryWindow("4.0")
      })
    ).rejects.toThrow("Unknown Slice Wallet deployment profile")
    expect(signMessage).not.toHaveBeenCalled()
  })

  it("signs only one authorization while still receiving the final result", async () => {
    const signMessage = mock(async () => {
      await Bun.sleep(5)
      return "0x1234" as Hex
    })

    const result = await registerRecoveredSliceWalletCredential({
      account,
      accountIndex: 7,
      chainId: 8453,
      factoryVersion: "slice-kernel-v4-ep09-r1",
      idOrigin: "https://id.slice.so",
      recoveryPermissionId,
      recoverySignerAddress,
      signMessage,
      timeoutMs: 100,
      window: createRecoveryWindow()
    })

    expect(signMessage).toHaveBeenCalledTimes(1)
    expect(result.credentialId).toBe("recovered-credential")
    expect(result.registry.credentialIdHash).toBe(credentialIdHash)
  })
})
