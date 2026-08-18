import { describe, expect, test } from "bun:test"
import { sliceWalletKernelAddresses } from "@slicekit/wallet-primitives"
import { kernelFactoryAbi } from "@slicekit/wallet-primitives/kernel"
import {
  bytesToHex,
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  hexToBytes,
  parseErc6492Signature,
  serializeErc6492Signature
} from "viem"
import {
  compactKernelErc6492Signature,
  compressKernelErc6492BootstrapCalldata
} from "./erc6492Bootstrap"

const decompressCalldata = (data: `0x${string}`) => {
  const input = hexToBytes(data)
  const output: number[] = []
  let offset = 0
  while (offset < input.length) {
    const byte = input[offset] ^ (offset < 4 ? 0xff : 0)
    offset += 1
    if (byte !== 0) {
      output.push(byte)
      continue
    }
    const control = input[offset] ^ (offset < 4 ? 0xff : 0)
    offset += 1
    const length = (control & 0x7f) + 1
    const value = control >> 7 === 1 ? 0xff : 0
    for (let index = 0; index < length; index += 1) output.push(value)
  }
  return bytesToHex(Uint8Array.from(output))
}

describe("Kernel v4 ERC-6492 bootstrap", () => {
  test("matches Solady calldata compression semantics", () => {
    const input = concatHex([
      "0xac9650d8",
      bytesToHex(new Uint8Array(128)),
      bytesToHex(new Uint8Array(32).fill(0xff)),
      "0x1234"
    ])
    const compressed = compressKernelErc6492BootstrapCalldata(input)

    expect(decompressCalldata(compressed)).toBe(input)
    expect(hexToBytes(compressed).length).toBeLessThan(
      hexToBytes(input).length / 10
    )
  })

  test("replaces only the v4 deployment proof and preserves its factory call", () => {
    const factoryData = encodeFunctionData({
      abi: kernelFactoryAbi,
      args: [
        [
          {
            internalData: "0x",
            module: "0x0000000000000000000000000000000000001234",
            moduleData: bytesToHex(new Uint8Array(2_000)),
            moduleType: 1n
          }
        ],
        7n
      ],
      functionName: "deploy"
    })
    const innerSignature = `0x${"22".repeat(512)}` as const
    const original = serializeErc6492Signature({
      address: sliceWalletKernelAddresses.factory,
      data: factoryData,
      signature: innerSignature
    })

    const compact = compactKernelErc6492Signature({
      bootstrapFactory: sliceWalletKernelAddresses.erc6492BootstrapFactory,
      factory: sliceWalletKernelAddresses.factory,
      signature: original
    })
    const parsed = parseErc6492Signature(compact)
    if (parsed.address === undefined || parsed.data === undefined) {
      throw new Error("Expected a compact ERC-6492 proof.")
    }
    const bootstrapCall = decodeFunctionData({
      abi: kernelFactoryAbi,
      data: decompressCalldata(parsed.data)
    })

    expect(parsed.address).toBe(
      sliceWalletKernelAddresses.erc6492BootstrapFactory
    )
    expect(parsed.signature).toBe(innerSignature)
    expect(bootstrapCall.functionName).toBe("deploy")
    expect(bootstrapCall.args[1]).toBe(7n)
    expect(decompressCalldata(parsed.data)).toBe(factoryData)
    expect(hexToBytes(compact).length).toBeLessThan(
      hexToBytes(original).length / 2
    )
  })

  test("does not rewrite a proof for another factory", () => {
    const signature = serializeErc6492Signature({
      address: "0x0000000000000000000000000000000000001234",
      data: "0x1234",
      signature: "0x5678"
    })
    expect(
      compactKernelErc6492Signature({
        bootstrapFactory: sliceWalletKernelAddresses.erc6492BootstrapFactory,
        factory: sliceWalletKernelAddresses.factory,
        signature
      })
    ).toBe(signature)
  })
})
