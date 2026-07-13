import type { Address, Hex } from "viem"
import type {
  WalletCall,
  WalletGrantKind,
  WalletPolicyDescriptor
} from "./policy"

export type SliceWalletProtocolValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | readonly SliceWalletProtocolValue[]
  | { readonly [key: string]: SliceWalletProtocolValue }

export type SliceWalletFrameSession = {
  account: Address
  chainId: number
  checkout?: SliceWalletCheckoutGrant
  expiresAt: number
  grantKind: WalletGrantKind
  permissionId: Hex
  policy: WalletPolicyDescriptor
  publicKey: Hex
  signerId: Address
}

export type SliceWalletCheckoutGrant = {
  allowanceUsdMicros: string
  budgetPeriodSec?: number
  coSignerAddress: Address
}

export type SliceWalletFrameSessionKey = Pick<
  SliceWalletFrameSession,
  "account" | "chainId" | "grantKind"
>

export type SliceWalletPermissionAuthorization = {
  accountFactory?: Address
  accountFactoryData?: Hex
  appOrigin: string
  enableSignature: Hex
  executionGrant?: {
    expiresAt: number
    nonce: Hex
    scopes: readonly string[]
    signerProof: Hex
  }
  rootCredential: {
    credentialIdHash: Hex
    publicKey: Hex
  }
  session: SliceWalletFrameSession
}

/** Frame-internal record. It must never cross the parent protocol. */
export type SliceWalletStoredSession = {
  appOrigin: string
  privateKey: CryptoKey
  session: SliceWalletFrameSession
}

export type SliceWalletSessionStore = {
  commitPending: (
    appOrigin: string,
    key: SliceWalletFrameSessionKey
  ) => Promise<SliceWalletStoredSession>
  delete: (appOrigin: string, key: SliceWalletFrameSessionKey) => Promise<void>
  deletePending: (
    appOrigin: string,
    key: SliceWalletFrameSessionKey
  ) => Promise<void>
  get: (
    appOrigin: string,
    key: SliceWalletFrameSessionKey
  ) => Promise<SliceWalletStoredSession | null>
  getPending: (
    appOrigin: string,
    key: SliceWalletFrameSessionKey
  ) => Promise<SliceWalletStoredSession | null>
  putPending: (record: SliceWalletStoredSession) => Promise<void>
}

export type SliceWalletWindowMessage = {
  data: SliceWalletProtocolValue
  origin: string
  ports: readonly MessagePort[]
  source: object | null
}

export type SliceWalletMessageWindow = {
  addEventListener: (
    type: "message",
    listener: (event: SliceWalletWindowMessage) => void
  ) => void
  parent: object
  removeEventListener: (
    type: "message",
    listener: (event: SliceWalletWindowMessage) => void
  ) => void
}

export type SliceWalletSignerFrameControllerOptions = {
  consumeAuthorization?: (
    key: SliceWalletFrameSessionKey
  ) => Promise<SliceWalletPermissionAuthorization | null>
  cryptoImpl?: Crypto
  decodeScopedCalls: (callData: Hex) => readonly WalletCall[]
  managementOrigins?: readonly string[]
  now?: () => number
  onSessionCreated?: (
    session: SliceWalletFrameSession,
    appOrigin: string
  ) => void
  rpId?: string
  selfOrigin: string
  sessionStore: SliceWalletSessionStore
  usePrecompiled?: boolean
  validateCheckoutCalls: (
    calls: readonly WalletCall[],
    session: SliceWalletFrameSession
  ) => void
  window: SliceWalletMessageWindow
}

export type SliceWalletFrameConnectRequest = {
  id: string
  method: "connect"
  version: 1
}

export type SliceWalletFrameRequest =
  | {
      id: string
      method: "clearSession"
      params: SliceWalletFrameSessionKey
      version: 1
    }
  | {
      id: string
      method: "commitSession"
      params: SliceWalletFrameSessionKey
      version: 1
    }
  | {
      id: string
      method: "discardSession"
      params: SliceWalletFrameSessionKey
      version: 1
    }
  | {
      id: string
      method: "consumeAuthorization"
      params: SliceWalletFrameSessionKey
      version: 1
    }
  | {
      id: string
      method: "createSession"
      params: {
        checkout?: SliceWalletCheckoutGrant
        policy: WalletPolicyDescriptor
      }
      version: 1
    }
  | {
      id: string
      method: "getSession"
      params: SliceWalletFrameSessionKey
      version: 1
    }
  | {
      id: string
      method: "signCheckoutProposal"
      params: {
        callData: Hex
        nonce: bigint
        sender: Address
        session: SliceWalletFrameSessionKey
      }
      version: 1
    }
  | {
      id: string
      method: "signCoSignRequest"
      params: {
        challenge: Hex
        delegationId: string
        expiresAt: number
        session: SliceWalletFrameSessionKey
        userOperation: SliceWalletUnsignedUserOperation
      }
      version: 1
    }
  | {
      id: string
      method: "signGrantProof"
      params: {
        expiresAt: number
        nonce: Hex
        scopes: readonly string[]
        session: SliceWalletFrameSessionKey
      }
      version: 1
    }
  | {
      id: string
      method: "signSessionRequest"
      params: {
        action: "revoke" | "status"
        challenge: Hex
        delegationId: string
        expiresAt: number
        session: SliceWalletFrameSessionKey
      }
      version: 1
    }
  | {
      id: string
      method: "signScopedUserOperation"
      params: {
        session: SliceWalletFrameSessionKey
        userOperation: SliceWalletUnsignedUserOperation
      }
      version: 1
    }

export type SliceWalletUnsignedUserOperation = {
  callData: Hex
  callGasLimit: bigint
  factory?: Address
  factoryData?: Hex
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  nonce: bigint
  paymaster?: Address
  paymasterData?: Hex
  paymasterPostOpGasLimit?: bigint
  paymasterVerificationGasLimit?: bigint
  preVerificationGas: bigint
  sender: Address
  verificationGasLimit: bigint
}

export type SliceWalletFrameResponse =
  | {
      error: {
        code: string
        message: string
      }
      id: string
      version: 1
    }
  | {
      id: string
      result:
        | Hex
        | SliceWalletPermissionAuthorization
        | SliceWalletFrameSession
        | {
            proposalHash: Hex
            signature: Hex
          }
        | {
            proofSignature: Hex
            proposalHash: Hex
            signature: Hex
            userOperationHash: Hex
          }
        | null
      version: 1
    }

export type SliceWalletFrameRequestInput =
  SliceWalletFrameRequest extends infer Request
    ? Request extends SliceWalletFrameRequest
      ? Omit<Request, "id" | "version">
      : never
    : never

export type SliceWalletSignerFrameClient = {
  destroy: () => void
  request: (
    request: SliceWalletFrameRequestInput
  ) => Promise<
    Extract<
      SliceWalletFrameResponse,
      { result: object | string | null }
    >["result"]
  >
  setContinuationVisible: (visible: boolean) => void
}

export type SliceWalletBridgeChallenge = {
  account: Address
  chainId: number
  grantKind: WalletGrantKind
  nonce: Hex
  type: "slice-wallet:bridge-challenge"
  version: 1
}

export type SliceWalletBridgeRecord = {
  nonce: Hex
  origin: string
  session: SliceWalletFrameSession
  type: "slice-wallet:bridge-record"
  version: 1
}

export type SliceWalletBridgeGrantProofRequest = {
  expiresAt: number
  nonce: Hex
  scopes: readonly string[]
  session: SliceWalletFrameSessionKey
  type: "slice-wallet:bridge-sign-grant"
  version: 1
}

export type SliceWalletBridgeGrantProofResponse =
  | {
      signature: Hex
      type: "slice-wallet:bridge-grant-proof"
      version: 1
    }
  | {
      error: string
      type: "slice-wallet:bridge-error"
      version: 1
    }
