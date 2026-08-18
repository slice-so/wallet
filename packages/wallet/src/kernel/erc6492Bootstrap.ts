import {
  type Address,
  bytesToHex,
  type Hex,
  hexToBytes,
  isAddressEqual,
  parseErc6492Signature,
  serializeErc6492Signature
} from "viem"

const appendCompressedByte = (output: number[], byte: number) => {
  output.push(output.length < 4 ? byte ^ 0xff : byte)
}

/** Matches Solady LibZip.cdCompress for calldata consumed by cdFallback. */
export const compressKernelErc6492BootstrapCalldata = (data: Hex): Hex => {
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

export const compactKernelErc6492Signature = ({
  bootstrapFactory,
  factory,
  signature
}: {
  bootstrapFactory: Address
  factory: Address
  signature: Hex
}): Hex => {
  const parsed = parseErc6492Signature(signature)
  if (
    parsed.address === undefined ||
    parsed.data === undefined ||
    !isAddressEqual(parsed.address, factory)
  ) {
    return signature
  }

  return serializeErc6492Signature({
    address: bootstrapFactory,
    data: compressKernelErc6492BootstrapCalldata(parsed.data),
    signature: parsed.signature
  })
}
