import { toHex } from "viem"
import { createSliceWalletRegisteredKernelAccount } from "../rootValidator"
import type {
  CreateSliceWalletCeremonyKernelAccountParameters,
  SliceWalletRootSignatureRequest
} from "../types"
import { createSliceWalletCeremonyRootSigner } from "./rootSignerClient"

export const createSliceWalletCeremonyKernelAccount = async ({
  address,
  ceremonyMode = "popup",
  chainId,
  client,
  credential,
  document,
  idOrigin,
  index,
  initConfig,
  window
}: CreateSliceWalletCeremonyKernelAccountParameters) => {
  if (address === undefined) {
    throw new Error("A registry-backed ceremony account requires an address.")
  }
  let pendingMessage: Extract<
    SliceWalletRootSignatureRequest,
    { purpose: "message" }
  > | null = null
  let pendingTypedData: NonNullable<
    Extract<
      SliceWalletRootSignatureRequest,
      { purpose: "typed_data" }
    >["source"]
  > | null = null
  const ceremonySigner = createSliceWalletCeremonyRootSigner({
    account: address,
    ceremonyMode,
    chainId,
    document,
    idOrigin,
    window
  })
  const account = await createSliceWalletRegisteredKernelAccount({
    address,
    chainId,
    client,
    credential,
    ...(index === undefined ? {} : { index }),
    ...(initConfig === undefined ? {} : { initConfig }),
    rootSigner: (hash, purpose, request) => {
      const source = pendingMessage ?? pendingTypedData
      const requestWithSource =
        request?.purpose === "typed_data" && source !== null
          ? { ...request, source }
          : request
      return ceremonySigner(hash, purpose, requestWithSource)
    }
  })
  const signMessage: typeof account.signMessage = async (parameters) => {
    if (pendingMessage !== null || pendingTypedData !== null) {
      throw new Error("A Slice Wallet root ceremony is already pending.")
    }
    const message = parameters.message
    pendingMessage =
      typeof message === "string"
        ? { message, messageFormat: "text", purpose: "message" }
        : {
            message:
              typeof message.raw === "string"
                ? message.raw
                : toHex(message.raw),
            messageFormat: "hex",
            purpose: "message"
          }
    try {
      return await account.signMessage(parameters)
    } finally {
      pendingMessage = null
    }
  }

  const signTypedData: typeof account.signTypedData = async (parameters) => {
    if (pendingMessage !== null || pendingTypedData !== null) {
      throw new Error("A Slice Wallet root ceremony is already pending.")
    }
    pendingTypedData = {
      purpose: "application_typed_data",
      typedDataJson: JSON.stringify(parameters, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    }
    try {
      return await account.signTypedData(parameters)
    } finally {
      pendingTypedData = null
    }
  }

  return { ...account, signMessage, signTypedData }
}
