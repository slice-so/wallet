import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import type { Address, Hex } from "viem"
import type {
  SliceWalletRegisteredRootCredential,
  SliceWalletRootSigner
} from "./account"
import type {
  SliceWalletFrameSession,
  SliceWalletSignerFrameClient,
  SliceWalletUnsignedUserOperation
} from "./frame"

export type SliceWalletCheckoutCoSignChallenge = {
  challenge: Hex
  challengeIssuedAt: number
  expiresAt: number
  spendWindowId: string
  validUntil: number
  windowEndExclusive: number
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
    challengeIssuedAt: number
    delegationId: string
    expiresAt: number
    proofSignature: Hex
    spendWindowId: string
    userOperation: SliceWalletUnsignedUserOperation
    validUntil: number
    windowEndExclusive: number
    windowStart: number
  }) => Promise<SliceWalletCheckoutCoSignResult>
  createChallenge: (
    delegationId: string
  ) => Promise<SliceWalletCheckoutCoSignChallenge>
}

type SliceWalletPermissionAccountCommonParameters = {
  address: Address
  accountIndex: bigint
  client: KernelSmartAccountImplementation["client"]
  credential: SliceWalletRegisteredRootCredential
  enableSignature?: Hex
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

export type BuildSliceWalletPermissionEnableTypedDataParameters = Omit<
  SliceWalletPermissionAccountCommonParameters,
  "enableSignature" | "frameClient" | "getFactoryArgs"
>
