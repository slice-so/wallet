import { describe, expect, it } from "bun:test"
import { createPublicClient, custom } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { base } from "viem/chains"
import { createDeployedRecoveryPermissionAccount } from "./recovery"

const recoveryPrivateKey = `0x${"33".repeat(32)}` as const

describe("deployed recovery permission account", () => {
  it("constructs from only deployed public state and omits factory args", async () => {
    const client = createPublicClient({
      chain: base,
      transport: custom({
        async request({ method }) {
          throw new Error(`Unexpected RPC request: ${method}`)
        }
      })
    })
    const account = await createDeployedRecoveryPermissionAccount({
      address: "0x1111111111111111111111111111111111111111",
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
  })
})
