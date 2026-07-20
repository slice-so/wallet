import type { KernelSmartAccountImplementation } from "@zerodev/sdk"
import type { ToKernelSmartAccountReturnType } from "permissionless/accounts"
import type {
  Address,
  Chain,
  Client,
  Hex,
  JsonRpcAccount,
  LocalAccount,
  Transport
} from "viem"
import type {
  CreateWebAuthnCredentialParameters,
  P256Credential,
  ToWebAuthnAccountParameters
} from "viem/account-abstraction"
import type { SliceWalletUnsignedUserOperation } from "./frame"

export type SliceWalletAccountIndex = number

export type SliceWalletActivityTokenDescriptor = {
  address: Address
  symbol: string
}

export type SliceWalletAccountActivity = {
  address: Address
  code: Hex | null
  nativeBalance: string
  tokenBalances: Readonly<Record<string, string>>
}

export type SliceWalletAccountActivityBatchRequest = {
  id: number
  jsonrpc: "2.0"
  method: "eth_call" | "eth_getBalance" | "eth_getCode"
  params: readonly (string | { data: Hex; to: Address })[]
}

export type SliceWalletAccountActivityBatchResponse = {
  error?: { code: number; message: string }
  id: number
  jsonrpc: "2.0"
  result?: string
}

export type SliceWalletPasskeyCredential = Pick<
  P256Credential,
  "id" | "publicKey"
>

export type CreateSliceWalletPasskeyParameters = {
  authenticatorSelection?: CreateWebAuthnCredentialParameters["authenticatorSelection"]
  excludeCredentialIds?: readonly string[]
  name: string
  rpName?: string
  timeout?: number
}

export type SliceWalletRegisteredRootCredential = {
  credentialIdHash: Hex
  publicKey: Hex
}

export type SliceWalletPublicClient = Client<
  Transport,
  Chain | undefined,
  JsonRpcAccount | LocalAccount | undefined
>

export type SliceWalletKernelAccount = ToKernelSmartAccountReturnType<
  "0.7",
  false
>

export type SliceWalletRootSignaturePurpose =
  | "message"
  | "typed_data"
  | "user_operation"

export type SliceWalletKernelTypedData = {
  domain: {
    chainId: number
    name: string
    verifyingContract: Address
    version: string
  }
  message: { hash: Hex }
  primaryType: "Kernel"
  types: {
    Kernel: readonly [{ name: "hash"; type: "bytes32" }]
  }
}

export type SliceWalletRootSignatureRequest =
  | {
      message: string
      messageFormat: "hex" | "text"
      purpose: "message"
    }
  | {
      purpose: "typed_data"
      source?:
        | {
            message: string
            messageFormat: "hex" | "text"
            purpose: "message"
          }
        | {
            purpose: "application_typed_data"
            typedDataJson: string
          }
      typedData: SliceWalletKernelTypedData
    }
  | {
      purpose: "user_operation"
      userOperation: SliceWalletUnsignedUserOperation
    }

export type SliceWalletRootSigner = (
  hash: Hex,
  purpose: SliceWalletRootSignaturePurpose,
  request?: SliceWalletRootSignatureRequest
) => Promise<Hex>

export type CreateSliceWalletKernelAccountParameters = {
  address?: `0x${string}`
  client: SliceWalletPublicClient
  credential: SliceWalletPasskeyCredential
  getFn?: ToWebAuthnAccountParameters["getFn"]
  rpId?: ToWebAuthnAccountParameters["rpId"]
}

export type CreateSliceWalletRegisteredKernelAccountParameters = {
  address?: `0x${string}`
  chainId: number
  client: KernelSmartAccountImplementation["client"]
  credential: SliceWalletRegisteredRootCredential
  index?: bigint
  initConfig?: Hex[]
  rootSigner?: SliceWalletRootSigner
}
