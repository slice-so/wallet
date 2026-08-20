import type {
  Abi,
  Address,
  Chain,
  Client,
  Hex,
  JsonRpcAccount,
  LocalAccount,
  SignableMessage,
  Transport,
  TypedDataDefinition
} from "viem"
import type {
  SmartAccount,
  SmartAccountImplementation,
  UserOperation
} from "viem/account-abstraction"

export type SliceKernelClient = Client<
  Transport,
  Chain | undefined,
  JsonRpcAccount | LocalAccount | undefined
>

export type SliceKernelCall = { data?: Hex; to: Address; value?: bigint }

export type SliceKernelInstall = {
  internalData: Hex
  module: Address
  moduleData: Hex
  moduleType: bigint
}

export type SliceWalletKernelTypedDataValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | readonly SliceWalletKernelTypedDataValue[]
  | { readonly [key: string]: SliceWalletKernelTypedDataValue }

export type SliceWalletKernelTypedData = {
  domain: {
    chainId?: number
    name?: string
    salt?: Hex
    verifyingContract?: Address
    version?: string
  }
  message: { readonly [key: string]: SliceWalletKernelTypedDataValue }
  primaryType: string
  types: Readonly<
    Record<string, readonly { readonly name: string; readonly type: string }[]>
  >
}

export type SliceKernelSignatureContext =
  | {
      message: SignableMessage
      purpose: "message"
      typedData: SliceWalletKernelTypedData
    }
  | {
      purpose: "typed_data"
      source: TypedDataDefinition
      typedData: SliceWalletKernelTypedData
    }
  | {
      purpose: "user_operation"
      userOperation: UserOperation<"0.9">
    }

export type SliceKernelValidator = {
  address: Address
  getEnableData: () => Promise<Hex>
  getStubSignature: () => Promise<Hex>
  signHash: (hash: Hex, context: SliceKernelSignatureContext) => Promise<Hex>
}

export type SliceKernelModularSignerData = {
  address: Address
  data: Hex
}

export type SliceKernelModularSigner = SliceKernelModularSignerData & {
  account: LocalAccount
  stubSignature: Hex
}

export type SliceKernelPolicy = {
  address: Address
  data: Hex
  kind:
    | "call"
    | "rate-limit"
    | "slicer-registry"
    | "sudo"
    | "timelock"
    | "timestamp"
}

export type SliceKernelPermissionData = {
  id: Hex
  policies: readonly SliceKernelPolicy[]
  signer: SliceKernelModularSignerData
}

export type SliceKernelPermission = Omit<
  SliceKernelPermissionData,
  "signer"
> & {
  signer: SliceKernelModularSigner
}

export type SliceKernelAccount = SmartAccount<
  SmartAccountImplementation<
    Abi,
    "0.9",
    {
      initialPackages: readonly SliceKernelInstall[]
      permission?: SliceKernelPermission
      rootValidator: SliceKernelValidator
    }
  >
>

export type SliceKernelInstallTypedData = {
  domain: {
    chainId: number
    name: "Kernel"
    verifyingContract: Address
    version: "0.4.0"
  }
  message: {
    nonce: bigint
    packages: readonly SliceKernelInstall[]
  }
  primaryType: "InstallPackages"
  types: {
    Install: readonly [
      { name: "moduleType"; type: "uint256" },
      { name: "module"; type: "address" },
      { name: "moduleData"; type: "bytes" },
      { name: "internalData"; type: "bytes" }
    ]
    InstallPackages: readonly [
      { name: "nonce"; type: "uint256" },
      { name: "packages"; type: "Install[]" }
    ]
  }
}

export type SliceKernelSignUserOperation = (
  userOperation: UserOperation<"0.9"> & { chainId?: number }
) => Promise<Hex>
