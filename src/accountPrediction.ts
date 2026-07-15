import {
  concatHex,
  createPublicClient,
  custom,
  defineChain,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  toHex,
  zeroAddress
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import { encodeSliceWalletRootValidatorData } from "./rootValidator"
import type { PredictSliceWalletKernelAccountAddressParameters } from "./types/recovery"

export const sliceWalletKernelProxyInitCodeHash =
  "0xc452397f1e7518f8cea0566ac057e243bb1643f6298aba8eec8cdee78ee3b3dd" as const

// Kernel 0.3.3 initializer paired with the pinned proxy initcode hash above.
// Keep this local so SDK ABI changes cannot alter counterfactual addresses.
const kernelV33InitializeAbi = [
  {
    inputs: [
      { name: "_rootValidator", type: "bytes21" },
      { name: "hook", type: "address" },
      { name: "validatorData", type: "bytes" },
      { name: "hookData", type: "bytes" },
      { name: "initConfig", type: "bytes[]" }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const

const createOfflineClient = (chainId: number) =>
  createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `Slice wallet chain ${chainId}`,
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: ["http://127.0.0.1"] } }
    }),
    transport: custom({
      async request({ method }) {
        throw new Error(
          `Offline wallet derivation attempted RPC method ${method}.`
        )
      }
    })
  })

const getKernelProxyInitCode = () =>
  concatHex([
    "0x603d3d8160223d3973",
    sliceWalletKernelAddresses.implementation,
    "0x60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3"
  ])

export const deriveSliceWalletRecoveryBootstrap = async ({
  chainId,
  credential,
  recoverySignerAddress
}: PredictSliceWalletKernelAccountAddressParameters) => {
  const client = createOfflineClient(chainId)
  const recovery = await buildRecoveryPermissionInitConfig({
    client,
    recoverySignerAddress
  })
  const initializationData = encodeFunctionData({
    abi: kernelV33InitializeAbi,
    args: [
      concatHex(["0x01", sliceWalletKernelAddresses.webAuthnRootValidator]),
      zeroAddress,
      encodeSliceWalletRootValidatorData(credential),
      "0x",
      recovery.initConfig
    ],
    functionName: "initialize"
  })
  const initCodeHash = keccak256(getKernelProxyInitCode())
  if (initCodeHash !== sliceWalletKernelProxyInitCodeHash) {
    throw new Error("Pinned Kernel proxy initcode hash does not match.")
  }
  const salt = keccak256(
    concatHex([initializationData, toHex(0n, { size: 32 })])
  )
  return {
    account: getContractAddress({
      bytecodeHash: initCodeHash,
      from: sliceWalletKernelAddresses.factory,
      opcode: "CREATE2",
      salt
    }),
    permissionId: recovery.permissionId
  }
}

export const predictSliceWalletKernelAccountAddress = async (
  parameters: PredictSliceWalletKernelAccountAddressParameters
) => (await deriveSliceWalletRecoveryBootstrap(parameters)).account
