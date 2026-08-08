import {
  bytesToHex,
  encodeFunctionData,
  type Hex,
  hexToBytes,
  parseErc6492Signature,
  serializeErc6492Signature
} from "viem"
import {
  getSliceWalletChainPolicy,
  sliceWalletDevelopmentChainIds
} from "./chains"
import { sliceWalletKernelAddresses } from "./constants"

const bootstrapFactoryAbi = [
  {
    inputs: [{ name: "metaFactoryData", type: "bytes" }],
    name: "deploy",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "payable",
    type: "function"
  }
] as const

const appendCompressedByte = (output: number[], byte: number) => {
  output.push(output.length < 4 ? byte ^ 0xff : byte)
}

/** Matches Solady LibZip.cdCompress for calldata consumed by cdFallback. */
export const compressSliceWalletBootstrapCalldata = (data: Hex): Hex => {
  const input = hexToBytes(data)
  const output: number[] = []
  let zeroRun = 0
  let ffRun = 0

  const appendRun = (value: 0 | 1, length: number) => {
    appendCompressedByte(output, 0)
    appendCompressedByte(output, length - 1 + value * 0x80)
  }
  const flushZeroRun = () => {
    if (zeroRun === 0) return
    appendRun(0, zeroRun)
    zeroRun = 0
  }
  const flushFfRun = () => {
    if (ffRun === 0) return
    appendRun(1, ffRun)
    ffRun = 0
  }

  for (const byte of input) {
    if (byte === 0) {
      flushFfRun()
      zeroRun += 1
      if (zeroRun === 0x80) flushZeroRun()
      continue
    }
    if (byte === 0xff) {
      flushZeroRun()
      ffRun += 1
      if (ffRun === 0x20) flushFfRun()
      continue
    }
    flushFfRun()
    flushZeroRun()
    appendCompressedByte(output, byte)
  }
  flushFfRun()
  flushZeroRun()
  return bytesToHex(Uint8Array.from(output))
}

const hasVerifiedBootstrapFactory = (chainId: number) => {
  const deployment =
    getSliceWalletChainPolicy(chainId).contracts.erc6492BootstrapFactory
  return (
    sliceWalletDevelopmentChainIds.includes(
      chainId as (typeof sliceWalletDevelopmentChainIds)[number]
    ) || deployment.runtimeCodeHash !== null
  )
}

export const compactSliceWalletErc6492Signature = ({
  chainId,
  signature
}: {
  chainId: number
  signature: Hex
}): Hex => {
  if (!hasVerifiedBootstrapFactory(chainId)) return signature

  const parsed = parseErc6492Signature(signature)
  if (
    parsed.address === undefined ||
    parsed.data === undefined ||
    parsed.address.toLowerCase() !==
      sliceWalletKernelAddresses.metaFactory.toLowerCase()
  ) {
    return signature
  }

  const bootstrapCall = encodeFunctionData({
    abi: bootstrapFactoryAbi,
    args: [parsed.data],
    functionName: "deploy"
  })
  return serializeErc6492Signature({
    address: sliceWalletKernelAddresses.erc6492BootstrapFactory,
    data: compressSliceWalletBootstrapCalldata(bootstrapCall),
    signature: parsed.signature
  })
}
