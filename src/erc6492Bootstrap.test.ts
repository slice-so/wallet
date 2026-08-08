import { describe, expect, it } from "bun:test"
import {
  bytesToHex,
  concatHex,
  decodeFunctionData,
  encodeFunctionData,
  hexToBytes,
  parseErc6492Signature,
  serializeErc6492Signature
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
import {
  compactSliceWalletErc6492Signature,
  compressSliceWalletBootstrapCalldata
} from "./erc6492Bootstrap"

const bootstrapFactoryAbi = [
  {
    inputs: [{ name: "metaFactoryData", type: "bytes" }],
    name: "deploy",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "payable",
    type: "function"
  }
] as const

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

describe("compact ERC-6492 bootstrap", () => {
  it("matches Solady calldata compression semantics", () => {
    const input = concatHex([
      "0xac9650d8",
      bytesToHex(new Uint8Array(128)),
      bytesToHex(new Uint8Array(32).fill(0xff)),
      "0x1234"
    ])
    const compressed = compressSliceWalletBootstrapCalldata(input)

    expect(decompressCalldata(compressed)).toBe(input)
    expect(hexToBytes(compressed).length).toBeLessThan(
      hexToBytes(input).length / 10
    )
  })

  it("replaces only the factory proof while preserving the inner signature", () => {
    const metaFactoryData = encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: "factory", type: "address" },
            { name: "createData", type: "bytes" },
            { name: "salt", type: "bytes32" }
          ],
          name: "deployWithFactory",
          outputs: [{ name: "account", type: "address" }],
          stateMutability: "payable",
          type: "function"
        }
      ] as const,
      args: [
        sliceWalletKernelAddresses.factory,
        bytesToHex(new Uint8Array(2_000)),
        `0x${"11".repeat(32)}`
      ],
      functionName: "deployWithFactory"
    })
    const innerSignature = `0x${"22".repeat(512)}` as const
    const original = serializeErc6492Signature({
      address: sliceWalletKernelAddresses.metaFactory,
      data: metaFactoryData,
      signature: innerSignature
    })

    const compact = compactSliceWalletErc6492Signature({
      chainId: 31337,
      signature: original
    })
    const parsed = parseErc6492Signature(compact)
    if (parsed.address === undefined || parsed.data === undefined) {
      throw new Error("Expected an ERC-6492 proof.")
    }
    const bootstrapCall = decodeFunctionData({
      abi: bootstrapFactoryAbi,
      data: decompressCalldata(parsed.data)
    })

    expect(parsed.address).toBe(
      sliceWalletKernelAddresses.erc6492BootstrapFactory
    )
    expect(parsed.signature).toBe(innerSignature)
    expect(bootstrapCall.args[0]).toBe(metaFactoryData)
    expect(hexToBytes(compact).length).toBeLessThan(
      hexToBytes(original).length / 2
    )
  })

  it("uses the verified bootstrap on admitted production chains", () => {
    const original = serializeErc6492Signature({
      address: sliceWalletKernelAddresses.metaFactory,
      data: "0x1234",
      signature: "0x5678"
    })
    const compact = compactSliceWalletErc6492Signature({
      chainId: 8453,
      signature: original
    })

    expect(compact).not.toBe(original)
    expect(parseErc6492Signature(compact).address).toBe(
      sliceWalletKernelAddresses.erc6492BootstrapFactory
    )
  })
})
