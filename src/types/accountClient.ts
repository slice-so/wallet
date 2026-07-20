import type { ToKernelSmartAccountReturnType } from "permissionless/accounts"
import type {
  Chain,
  Client,
  Hex,
  JsonRpcAccount,
  LocalAccount,
  Transport
} from "viem"
import type {
  PaymasterActions,
  SmartAccount,
  UserOperationReceipt
} from "viem/account-abstraction"
import type {
  P256Credential,
  ToWebAuthnAccountParameters
} from "viem/account-abstraction"
import type { Address } from "viem"

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

export type SliceKernelPasskeyCredential = Pick<
  P256Credential,
  "id" | "publicKey"
>

export type SliceKernelPasskeyClient = Client<
  Transport,
  Chain | undefined,
  JsonRpcAccount | LocalAccount | undefined
>

export type SliceKernelPasskeyAccount = ToKernelSmartAccountReturnType<
  "0.7",
  false
>

export type CreateSliceKernelPasskeyAccountParameters = {
  address?: Address
  client: SliceKernelPasskeyClient
  credential: SliceKernelPasskeyCredential
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
