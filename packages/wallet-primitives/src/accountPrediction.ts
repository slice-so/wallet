import {
  bytesToBigInt,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  hexToBytes,
  keccak256,
  toHex,
  zeroAddress
} from "viem"
import { assertSliceWalletAccountIndex } from "./accountIndex"
import { sliceWalletKernelAddresses } from "./constants"
import type { SliceWalletRegisteredRootCredential } from "./types/account"

export const sliceWalletKernelProxyInitCodeHash =
  "0xc452397f1e7518f8cea0566ac057e243bb1643f6298aba8eec8cdee78ee3b3dd" as const

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

const getKernelProxyInitCode = () =>
  concatHex([
    "0x603d3d8160223d3973",
    sliceWalletKernelAddresses.implementation,
    "0x60095155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3"
  ])

export const encodeSliceWalletRootValidatorData = (
  credential: SliceWalletRegisteredRootCredential
) => {
  const bytes = hexToBytes(credential.publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Expected an uncompressed P-256 root public key.")
  }
  if (hexToBytes(credential.credentialIdHash).length !== 32) {
    throw new Error("Root credential id hash must be 32 bytes.")
  }
  return encodeAbiParameters(
    [
      {
        components: [
          { name: "x", type: "uint256" },
          { name: "y", type: "uint256" }
        ],
        name: "webAuthnData",
        type: "tuple"
      },
      { name: "authenticatorIdHash", type: "bytes32" }
    ],
    [
      {
        x: bytesToBigInt(bytes.slice(1, 33)),
        y: bytesToBigInt(bytes.slice(33, 65))
      },
      credential.credentialIdHash
    ]
  )
}

export const predictSliceWalletKernelAccountAddressFromInitConfig = ({
  credential,
  index = 0n,
  initConfig = []
}: {
  credential: SliceWalletRegisteredRootCredential
  index?: bigint
  initConfig?: readonly `0x${string}`[]
}) => {
  assertSliceWalletAccountIndex(Number(index))
  const initializationData = encodeFunctionData({
    abi: kernelV33InitializeAbi,
    args: [
      concatHex(["0x01", sliceWalletKernelAddresses.webAuthnRootValidator]),
      zeroAddress,
      encodeSliceWalletRootValidatorData(credential),
      "0x",
      [...initConfig]
    ],
    functionName: "initialize"
  })
  const initCodeHash = keccak256(getKernelProxyInitCode())
  if (initCodeHash !== sliceWalletKernelProxyInitCodeHash) {
    throw new Error("Pinned Kernel proxy initcode hash does not match.")
  }
  return getContractAddress({
    bytecodeHash: initCodeHash,
    from: sliceWalletKernelAddresses.factory,
    opcode: "CREATE2",
    salt: keccak256(concatHex([initializationData, toHex(index, { size: 32 })]))
  })
}
