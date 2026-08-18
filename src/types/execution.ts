import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import type { Address, Hex } from "viem"
import type { UserOperation } from "viem/account-abstraction"
import type { SliceWalletPasskeyCredential } from "./account"

type SliceExecutionAccountCommonParameters = {
  address: Address
  accountIndex: bigint
  client: KernelSmartAccountImplementation["client"]
  credential: SliceWalletPasskeyCredential
  enableSignature?: Hex
  getFactoryArgs?: () => Promise<{
    factory?: Address | undefined
    factoryData?: Hex | undefined
  }>
  sessionPrivateKey?: Hex
  sessionSignerAddress: Address
  validUntil: number
}

export type CreateSliceExecutionAccountParameters =
  SliceExecutionAccountCommonParameters &
    (
      | {
          coSignerAddress: Address
          getCoSignature?: (args: {
            userOperation: UserOperation<"0.7">
          }) => Promise<Hex>
          mode: "checkout"
        }
      | { mode: "store_management"; startsAt: number }
    )

export type BuildSliceExecutionEnableTypedDataParameters =
  CreateSliceExecutionAccountParameters extends infer Parameters
    ? Parameters extends CreateSliceExecutionAccountParameters
      ? Omit<
          Parameters,
          "enableSignature" | "getFactoryArgs" | "sessionPrivateKey"
        >
      : never
    : never
