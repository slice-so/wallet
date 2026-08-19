import {
  sliceWalletEntryPoint,
  sliceWalletKernelAddresses,
  sliceWalletKernelVersion
} from "@slicekit/wallet-primitives/server"
import { createKernelAccount, type KernelValidator } from "@zerodev/sdk"
import type { Address } from "viem"
import {
  getUserOperationHash,
  toWebAuthnAccount
} from "viem/account-abstraction"
import { toAccount } from "viem/accounts"
import { getChainId } from "viem/actions"
import { getAction } from "viem/utils"
import {
  encodeWebAuthnRootValidatorData,
  encodeWebAuthnValidatorSignature
} from "./execution/kernelPasskey/webAuthn"
import { sliceWalletWebAuthnDummySignature } from "./rootValidator"
import type {
  CreateSliceWalletKernelAccountParameters,
  SliceWalletKernelAccount
} from "./types/account"

export const createSliceWalletKernelAccount = async ({
  address,
  client,
  credential,
  getFn,
  rpId
}: CreateSliceWalletKernelAccountParameters): Promise<SliceWalletKernelAccount> => {
  const owner = toWebAuthnAccount({
    credential,
    ...(getFn === undefined ? {} : { getFn }),
    ...(rpId === undefined ? {} : { rpId })
  })

  const validatorAccount = toAccount({
    address: sliceWalletKernelAddresses.webAuthnRootValidator,
    async signMessage({ message }) {
      return encodeWebAuthnValidatorSignature(
        await owner.signMessage({ message })
      )
    },
    async signTransaction() {
      throw new Error("A smart-account validator does not sign transactions.")
    },
    async signTypedData(typedData) {
      return encodeWebAuthnValidatorSignature(
        await owner.signTypedData(typedData)
      )
    }
  })
  const rootValidator: KernelValidator<"SliceWalletWebAuthnRootValidator"> = {
    ...validatorAccount,
    address: sliceWalletKernelAddresses.webAuthnRootValidator,
    getEnableData: async () => encodeWebAuthnRootValidatorData(credential),
    getIdentifier: () => sliceWalletKernelAddresses.webAuthnRootValidator,
    getNonceKey: async (_accountAddress?: Address, customNonceKey?: bigint) =>
      customNonceKey ?? 0n,
    getStubSignature: async () => sliceWalletWebAuthnDummySignature,
    isEnabled: async () => true,
    signUserOperation: async (userOperation) => {
      const { chainId: requestedChainId, ...operation } = userOperation
      const chainId =
        requestedChainId ??
        client.chain?.id ??
        (await getAction(client, getChainId, "getChainId")({}))
      const hash = getUserOperationHash({
        chainId,
        entryPointAddress: sliceWalletEntryPoint.address,
        entryPointVersion: sliceWalletEntryPoint.version,
        userOperation: { ...operation, signature: "0x" }
      })
      return encodeWebAuthnValidatorSignature(await owner.sign({ hash }))
    },
    source: "SliceWalletWebAuthnRootValidator",
    supportedKernelVersions: sliceWalletKernelVersion,
    validatorType: "SECONDARY"
  }

  return createKernelAccount(client, {
    ...(address === undefined ? {} : { address }),
    accountImplementationAddress: sliceWalletKernelAddresses.implementation,
    entryPoint: sliceWalletEntryPoint,
    factoryAddress: sliceWalletKernelAddresses.factory,
    kernelVersion: sliceWalletKernelVersion,
    metaFactoryAddress: sliceWalletKernelAddresses.metaFactory,
    plugins: { sudo: rootValidator },
    useMetaFactory: true
  })
}

export const getSliceWalletKernelAccountAddress = async (
  parameters: CreateSliceWalletKernelAccountParameters
) => (await createSliceWalletKernelAccount(parameters)).address
