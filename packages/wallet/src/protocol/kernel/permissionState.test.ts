import { describe, expect, test } from "bun:test"
import { createPublicClient, custom, encodeAbiParameters, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { base } from "viem/chains"
import type { SliceKernelPermission } from "../types/kernel"
import { getKernelPermissionInstallState } from "./permissionState"

const account = "0x1111111111111111111111111111111111111111" as const
const policy = "0x2222222222222222222222222222222222222222" as const
const signer = privateKeyToAccount(`0x${"33".repeat(32)}`)
const permission = {
  id: "0x12345678",
  policies: [{ address: policy, data: "0x", kind: "sudo" }],
  signer: {
    account: signer,
    address: signer.address,
    data: signer.address,
    stubSignature: "0x1234"
  }
} as const satisfies SliceKernelPermission

const encodeMulticallResults = (returnData: readonly Hex[]) =>
  encodeAbiParameters(
    [
      {
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" }
        ],
        type: "tuple[]"
      }
    ],
    [returnData.map((data) => ({ returnData: data, success: true }))]
  )

describe("Kernel permission install state", () => {
  test("treats an undeployed account as uninstalled at nonce zero", async () => {
    const client = createPublicClient({
      chain: base,
      transport: custom({
        async request({ method }) {
          if (method === "eth_getCode") return "0x"
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })

    await expect(
      getKernelPermissionInstallState({ account, client, permission })
    ).resolves.toEqual({ installNonce: 0n, installed: false })
  })

  test("requires every policy and signer package to be installed", async () => {
    const client = createPublicClient({
      chain: base,
      transport: custom({
        async request({ method }) {
          if (method === "eth_getCode") return "0x01"
          if (method === "eth_call") {
            return encodeMulticallResults([
              encodeAbiParameters([{ type: "uint256" }], [7n]),
              encodeAbiParameters([{ type: "bool" }], [false]),
              encodeAbiParameters([{ type: "bool" }], [true])
            ])
          }
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })

    await expect(
      getKernelPermissionInstallState({ account, client, permission })
    ).resolves.toEqual({ installNonce: 7n, installed: false })
  })
})
