import { toWebAuthnAccount } from "viem/account-abstraction"
import {
  encodeWebAuthnRootValidatorData,
  encodeWebAuthnValidatorSignature
} from "./execution/kernelPasskey/webAuthn"
import { createKernelV4Account } from "./kernel/account"
import type { SliceKernelValidator } from "./protocol/index"
import { resolveSliceWalletDeployment } from "./protocol/kernel"
import { sliceWalletWebAuthnDummySignature } from "./rootValidator"
import type {
  CreateSliceWalletKernelAccountParameters,
  SliceWalletKernelAccount
} from "./types/account"

export const createSliceWalletKernelAccount = async ({
  address,
  chainId,
  client,
  credential,
  factoryVersion,
  getFn,
  rpId
}: CreateSliceWalletKernelAccountParameters): Promise<SliceWalletKernelAccount> => {
  const effectiveChainId = chainId ?? client.chain?.id ?? 8453
  const owner = toWebAuthnAccount({
    credential,
    ...(getFn === undefined ? {} : { getFn }),
    ...(rpId === undefined ? {} : { rpId })
  })
  const deployment = resolveSliceWalletDeployment({
    chainId: effectiveChainId,
    factoryVersion
  })
  const rootValidator = {
    address: deployment.rootValidator,
    getEnableData: async () => encodeWebAuthnRootValidatorData(credential),
    getStubSignature: async () => sliceWalletWebAuthnDummySignature,
    signHash: async (hash) =>
      encodeWebAuthnValidatorSignature(await owner.sign({ hash }))
  } satisfies SliceKernelValidator

  return createKernelV4Account({
    ...(address === undefined ? {} : { address }),
    client,
    entryPoint: deployment.entryPoint,
    ...(deployment.erc6492BootstrapFactory === undefined
      ? {}
      : {
          erc6492BootstrapFactory: deployment.erc6492BootstrapFactory
        }),
    factory: deployment.factory,
    implementation: deployment.implementation,
    rootValidator
  })
}

export const getSliceWalletKernelAccountAddress = async (
  parameters: CreateSliceWalletKernelAccountParameters
) => (await createSliceWalletKernelAccount(parameters)).address
