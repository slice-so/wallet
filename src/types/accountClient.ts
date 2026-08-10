import type { Address, Chain, Client, Hex, Transport } from "viem"
import type {
  PaymasterActions,
  PrepareUserOperationParameterType,
  SmartAccount,
  ToWebAuthnAccountParameters,
  UserOperation,
  UserOperationReceipt
} from "viem/account-abstraction"
import type {
  SliceWalletPasskeyCredential,
  SliceWalletPublicClient
} from "./account"

export type SliceAccountBackend = "kernel-passkey"

export type SliceAccountClientCall = {
  to: Address
  data: Hex
  value?: bigint
}

export type SliceAccountClientPaymasterContext =
  | boolean
  | null
  | number
  | string
  | readonly SliceAccountClientPaymasterContext[]
  | { readonly [key: string]: SliceAccountClientPaymasterContext }

export type SliceAccountClientSendCallsParameters = {
  calls: readonly SliceAccountClientCall[]
  chainId?: number
  paymasterContext?: SliceAccountClientPaymasterContext
  paymasterUrl?: string
}

export type SliceAccountClientExecutionResult = {
  executionId: Hex
  transactionHash: Hex
}

export type SliceAccountClient = {
  account: Address
  backend: SliceAccountBackend
  chainId: number
  sendCalls: (
    parameters: SliceAccountClientSendCallsParameters
  ) => Promise<SliceAccountClientExecutionResult>
}

export type SliceAccountClientExecutionRequest = {
  account: Address
  backend: SliceAccountBackend
  calls: readonly SliceAccountClientCall[]
  chainId: number
  paymasterContext?: SliceAccountClientPaymasterContext
  paymasterUrl?: string
}

export type SliceAccountClientExecutionSubmission = {
  executionId: Hex
}

export type SliceAccountClientExecutionReceiptRequest = {
  executionId: Hex
}

export type SliceAccountClientExecutionReceipt = {
  revertReason?: string
  success: boolean
  transactionHash: Hex
}

export type SliceAccountClientTransport = {
  submitCalls: (
    request: SliceAccountClientExecutionRequest
  ) => Promise<SliceAccountClientExecutionSubmission>
  waitForExecutionReceipt: (
    request: SliceAccountClientExecutionReceiptRequest
  ) => Promise<SliceAccountClientExecutionReceipt>
}

export type CreateSliceKernelPasskeyAccountParameters = {
  address?: Address
  client: SliceWalletPublicClient
  credential: SliceWalletPasskeyCredential
  getFn?: ToWebAuthnAccountParameters["getFn"]
  rpId?: ToWebAuthnAccountParameters["rpId"]
}

export type RegisterSliceKernelPasskeyCredentialParameters = {
  authenticatorSelection?: {
    authenticatorAttachment?: "cross-platform" | "platform"
    residentKey?: "discouraged" | "preferred" | "required"
    requireResidentKey?: boolean
    userVerification?: "discouraged" | "preferred" | "required"
  }
  excludeCredentialIds?: readonly string[]
  name: string
  rp?: { id: string; name: string }
  timeout?: number
}

export type SliceKernelPasskeyPaymasterClient = Pick<
  PaymasterActions,
  "getPaymasterData" | "getPaymasterStubData"
>

export type SliceKernelPasskeyBundlerReceipt = Pick<
  UserOperationReceipt<"0.7">,
  "reason" | "success"
> & { receipt: { transactionHash: Hex } }

export type SliceKernelPasskeySendUserOperationParameters = {
  account: SmartAccount
  calls: readonly SliceAccountClientCall[]
  paymaster?: SliceKernelPasskeyPaymasterClient
  paymasterContext?: SliceAccountClientPaymasterContext
}

export type SliceKernelPasskeyBundlerClient = {
  prepareUserOperation?: (
    parameters: {
      account: SmartAccount
      paymaster?: SliceKernelPasskeyPaymasterClient
      paymasterContext?: SliceAccountClientPaymasterContext
      parameters?: readonly PrepareUserOperationParameterType[]
    } & (
      | {
          callData: Hex
          calls?: never
          factory?: Address
          factoryData?: Hex
          nonce: bigint
        }
      | { callData?: never; calls: readonly SliceAccountClientCall[] }
    )
  ) => Promise<UserOperation<"0.7">>
  sendPreparedUserOperation?: (
    userOperation: UserOperation<"0.7">
  ) => Promise<Hex>
  sendUserOperation: (
    parameters: SliceKernelPasskeySendUserOperationParameters
  ) => Promise<Hex>
  waitForUserOperationReceipt: (parameters: {
    hash: Hex
  }) => Promise<SliceKernelPasskeyBundlerReceipt>
}

export type CreateSliceKernelPasskeyBundlerClient = (parameters: {
  bundlerUrl: string
  chain: Chain
  client: Client<Transport>
}) => SliceKernelPasskeyBundlerClient

export type CreateSliceKernelPasskeyPaymasterClient = (parameters: {
  paymasterUrl: string
}) => SliceKernelPasskeyPaymasterClient

export type SliceKernelPasskeyUserOperationEvent =
  | {
      account: Address
      type: "userOperationSubmitted"
      userOperationHash: Hex
    }
  | {
      account: Address
      revertReason?: string
      success: boolean
      transactionHash: Hex
      type: "userOperationReceipt"
      userOperationHash: Hex
    }

export type CreateSliceKernelPasskeyTransportParameters = {
  account: SmartAccount
  bundlerUrl: string
  chain?: Chain
  client: Client<Transport>
  createBundlerClient?: CreateSliceKernelPasskeyBundlerClient
  createPaymasterClient?: CreateSliceKernelPasskeyPaymasterClient
  onUserOperationEvent?: (event: SliceKernelPasskeyUserOperationEvent) => void
}
