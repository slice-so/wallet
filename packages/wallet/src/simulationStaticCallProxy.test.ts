import { describe, expect, it } from "bun:test"
import { concat, padHex } from "viem"
import {
  sliceWalletSimulationStaticCallCode,
  sliceWalletSimulationStaticCallProxy
} from "./protocol/constants"

const anvilAvailable = async () => {
  try {
    const process = Bun.spawnSync(["which", "anvil"])
    return process.exitCode === 0
  } catch {
    return false
  }
}

// The forwarder is injected as raw state-override code, so its runtime must
// be validated by execution, not just encoding checks: this test replays the
// exact override against a local Anvil node.
describe("static-call forwarder bytecode", () => {
  it("forwards reads via STATICCALL and propagates reverts", async () => {
    if (!(await anvilAvailable())) {
      console.warn("anvil not installed; skipping forwarder execution test.")
      return
    }
    const port = 8547
    const rpcUrl = `http://localhost:${port}`
    const anvil = Bun.spawn(["anvil", "--port", String(port)], {
      stdout: "ignore",
      stderr: "ignore"
    })
    try {
      let ready = false
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const probe = await new Promise((resolve) => {
          void fetch(rpcUrl, {
            body: JSON.stringify({
              id: 1,
              jsonrpc: "2.0",
              method: "web3_clientVersion",
              params: []
            }),
            headers: { "content-type": "application/json" },
            method: "POST"
          })
            .then((response) => resolve(response.ok))
            .catch(() => resolve(false))
        })
        if (probe === true) {
          ready = true
          break
        }
        await Bun.sleep(200)
      }
      if (!ready) throw new Error("Anvil did not become ready.")

      const mockReturner = "0x0000000000000000000000000000000000020001"
      const mockReverter = "0x0000000000000000000000000000000000020002"
      const mockStorer = "0x0000000000000000000000000000000000020003"
      // Returns one word containing 42.
      await rpc(anvil, rpcUrl, "anvil_setCode", [
        mockReturner,
        "0x602a60005260206000f3"
      ])
      // Reverts with a one-word sentinel value.
      await rpc(anvil, rpcUrl, "anvil_setCode", [
        mockReverter,
        "0x60fe60005260206000fd"
      ])
      // Attempts SSTORE(slot 0, value 1) then returns 42. This is the
      // CALL/STATICCALL discriminator: the store succeeds at the top level
      // but must revert inside a static context.
      await rpc(anvil, rpcUrl, "anvil_setCode", [
        mockStorer,
        "0x6001600055602a60005260206000f3"
      ])
      await rpc(anvil, rpcUrl, "anvil_setCode", [
        sliceWalletSimulationStaticCallProxy,
        sliceWalletSimulationStaticCallCode
      ])

      const wrapped = (innerTarget: string) =>
        concat([
          padHex(innerTarget as `0x${string}`, { size: 32 }),
          "0xdeadbeef" as const
        ])

      const forwarded = await rpc(anvil, rpcUrl, "eth_call", [
        {
          data: wrapped(mockReturner),
          to: sliceWalletSimulationStaticCallProxy
        },
        "latest"
      ])
      expect(forwarded).toBe(
        "0x000000000000000000000000000000000000000000000000000000000000002a"
      )

      // Control: the SSTORE mock succeeds when called directly, proving the
      // mock itself is valid and that top-level eth_call permits mutation.
      const directStore = await rpc(anvil, rpcUrl, "eth_call", [
        { data: "0xdeadbeef", to: mockStorer },
        "latest"
      ])
      expect(directStore).toBe(
        "0x000000000000000000000000000000000000000000000000000000000000002a"
      )

      // THE static-context proof: the same store attempt through the proxy
      // must revert. Under an ordinary CALL it would succeed, so this
      // assertion fails if the forwarder ever regresses to CALL.
      const viaProxyError = await fetch(rpcUrl, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "eth_call",
          params: [
            {
              data: wrapped(mockStorer),
              to: sliceWalletSimulationStaticCallProxy
            },
            "latest"
          ]
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
      const viaProxyBody = (await viaProxyError.json()) as {
        error?: { message?: string }
        result?: unknown
      }
      expect(viaProxyBody.error).toBeDefined()
      expect(viaProxyBody.result).toBeUndefined()

      // A reverting inner read surfaces as a failed subcall would in
      // aggregate3: eth_call reverts and the proxy propagates the inner
      // return data as revert data.
      const reverting = await fetch(rpcUrl, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "eth_call",
          params: [
            {
              data: wrapped(mockReverter),
              to: sliceWalletSimulationStaticCallProxy
            },
            "latest"
          ]
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      })
      const revertedBody = (await reverting.json()) as {
        error?: { data?: string }
      }
      expect(revertedBody.error?.data?.endsWith("fe")).toBe(true)
    } finally {
      anvil.kill()
    }
  })
})

const rpc = async (
  anvil: Bun.Subprocess,
  rpcUrl: string,
  method: string,
  params: readonly unknown[]
): Promise<string | null> => {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST"
  })
  const body = (await response.json()) as {
    error?: { message?: string }
    result?: string | null
  }
  if (body.error !== undefined) {
    throw new Error(
      `${method} failed against anvil (pid ${anvil.pid}): ${body.error.message ?? "unknown error"}`
    )
  }
  return body.result ?? null
}
