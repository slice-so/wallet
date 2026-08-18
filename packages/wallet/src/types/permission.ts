import type {
  SliceWalletFrameSession,
  SliceWalletRegisteredRootCredential
} from "@slicekit/wallet-primitives"
import type { Address, Hex } from "viem"
import type { SliceWalletPublicClient, SliceWalletRootSigner } from "./account"
import type {
  SliceWalletSignerFrameClient,
  SliceWalletUnsignedUserOperation
} from "./frame"
export type SliceWalletCheckoutCoSignChallenge = {
  challenge: Hex
  challengeExpiresAt: number
  challengeIssuedAt: number
  validUntil: number
  windowEndExclusive: number
  windowId: string
  windowStart: number
}

export type SliceWalletCheckoutCoSignResult = {
  coSignature: Hex
  proposalHash: Hex
  remainingUsdMicros: string
  userOperationHash: Hex
  validUntil: number
}

export type SliceWalletCheckoutCoSignerClient = {
  coSign: (input: {
    challenge: Hex
    challengeExpiresAt: number
    challengeIssuedAt: number
    delegationId: string
    proofSignature: Hex
    userOperation: SliceWalletUnsignedUserOperation
    validUntil: number
    windowEndExclusive: number
    windowId: string
    windowStart: number
  }) => Promise<SliceWalletCheckoutCoSignResult>
  createChallenge: (
    delegationId: string
  ) => Promise<SliceWalletCheckoutCoSignChallenge>
}

type SliceWalletPermissionAccountCommonParameters = {
  address: Address
  accountIndex: bigint
  client: SliceWalletPublicClient
  credential: SliceWalletRegisteredRootCredential
  enableSignature?: Hex
  factoryVersion?: string
  frameClient: SliceWalletSignerFrameClient
  getFactoryArgs?: () => Promise<{
    factory?: Address
    factoryData?: Hex
  }>
  rootSigner?: SliceWalletRootSigner
  session: SliceWalletFrameSession
}

export type CreateSliceWalletPermissionAccountParameters =
  SliceWalletPermissionAccountCommonParameters &
    (
      | {
          checkoutCoSigner: SliceWalletCheckoutCoSignerClient
          delegationId: string
          mode: "checkout"
        }
      | {
          mode: "generic" | "management"
        }
    )
