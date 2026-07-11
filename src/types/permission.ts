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
  expiresAt: number
}

export type SliceWalletCheckoutCoSignResult = {
  coSignature: Hex
  proposalHash: Hex
  remainingUsdMicros: string
  userOperationHash: Hex
}

export type SliceWalletCheckoutCoSignerClient = {
  coSign: (input: {
    challenge: Hex
    delegationId: string
    expiresAt: number
    proofSignature: Hex
    userOperation: SliceWalletUnsignedUserOperation
  }) => Promise<SliceWalletCheckoutCoSignResult>
  createChallenge: (
    delegationId: string
  ) => Promise<SliceWalletCheckoutCoSignChallenge>
}

type SliceWalletPermissionAccountCommonParameters = {
  address: Address
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
