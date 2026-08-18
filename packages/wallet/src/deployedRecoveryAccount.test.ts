import { describe, expect, it } from "bun:test"
import { createPublicClient, custom } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { base } from "viem/chains"
import {
  buildRecoveryUserOperation,
  createDeployedRecoveryPermissionAccount
} from "./recovery"

const recoveryPrivateKey = `0x${"33".repeat(32)}` as const

describe("deployed recovery permission account", () => {
  it("constructs from only deployed public state and omits factory args", async () => {
    const client = createPublicClient({
      chain: base,
      transport: custom({
        async request({ method }) {
          if (method === "eth_getCode") return "0x01"
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })
    const account = await createDeployedRecoveryPermissionAccount({
      address: "0x1111111111111111111111111111111111111111",
      accountIndex: 0n,
      chainId: base.id,
      client,
      recoveryPrivateKey,
      recoverySignerAddress: privateKeyToAccount(recoveryPrivateKey).address
    })

    expect(account.address).toBe("0x1111111111111111111111111111111111111111")
    expect(await account.getFactoryArgs()).toEqual({
      factory: undefined,
      factoryData: undefined
    })
    expect(account.recoveryPermissionId).toMatch(/^0x[0-9a-f]{8}$/)

    await expect(
      buildRecoveryUserOperation({
        account: {
          ...account,
          getFactoryArgs: async () => ({
            factory: "0x2222222222222222222222222222222222222222" as const,
            factoryData: "0x1234" as const
          })
        },
        calls: [],
        chainId: base.id,
        gas: {
          callGasLimit: 1n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          preVerificationGas: 1n,
          verificationGasLimit: 1n
        }
      })
    ).rejects.toThrow("cannot include factory data")
  })
})
