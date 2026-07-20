import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import type { Address, Hex } from "viem"
import type { UserOperation } from "viem/account-abstraction"
import type { SliceKernelPasskeyCredential } from "./accountClient"

export type SliceExecutionUserOperation = UserOperation<"0.7">

type SliceExecutionAccountCommonParameters = {
  address: Address
  accountIndex: bigint
  client: KernelSmartAccountImplementation["client"]
  credential: SliceKernelPasskeyCredential
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
            userOperation: SliceExecutionUserOperation
          }) => Promise<Hex>
          mode: "checkout"
        }
      | { mode: "store_management" }
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
