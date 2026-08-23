import { describe, expect, it } from "bun:test"
import { concat, padHex } from "viem"
import {
  sliceWalletSimulationStaticCallCode,
  sliceWalletSimulationStaticCallProxy
} from "./protocol/constants"

const READINESS_ATTEMPTS = 50
const READINESS_INTERVAL_MS = 200
const FETCH_TIMEOUT_MS = 2_000
// Worst-case readiness: every probe burns its full timeout and then waits out
// the retry interval. The test timeout must exceed that budget plus the RPC
// exchanges and process teardown, or a slow Anvil start reads as a test bug.
const READINESS_BUDGET_MS =
  READINESS_ATTEMPTS * (FETCH_TIMEOUT_MS + READINESS_INTERVAL_MS)
const TEST_TIMEOUT_MS = READINESS_BUDGET_MS + 30_000

const anvilAvailable = async () => {
  try {
    const process = Bun.spawnSync(["which", "anvil"])
    return process.exitCode === 0
  } catch {
    return false
  }
}

// Ask the OS for a free port instead of hard-coding one, so a developer's own
// node (or a parallel test run) never collides with this fixture.
const allocatePort = () => {
  const probe = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} }
  })
  const { port } = probe
  probe.stop(true)
  return port
}

const spawnAnvil = (port: number) =>
  Bun.spawn(["anvil", "--port", String(port)], {
    stderr: "pipe",
    stdout: "pipe"
  })

type AnvilProcess = ReturnType<typeof spawnAnvil>

const shutDownAnvil = async (anvil: AnvilProcess) => {
  anvil.kill()
  await anvil.exited
}

// Anvil's own output is the only useful diagnostic when startup fails, so drain
// it rather than reporting a bare timeout.
const describeAnvilFailure = async (anvil: AnvilProcess, port: number) => {
  await shutDownAnvil(anvil)
  const [stdout, stderr] = await Promise.all([
    new Response(anvil.stdout).text(),
    new Response(anvil.stderr).text()
  ])
  return [
    `Anvil did not become ready on port ${port} within ${READINESS_BUDGET_MS}ms (exit code ${anvil.exitCode}).`,
    `stdout:\n${stdout.trim() || "(empty)"}`,
    `stderr:\n${stderr.trim() || "(empty)"}`
  ].join("\n")
}

const postRpc = (rpcUrl: string, method: string, params: readonly unknown[]) =>
  fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })

const waitForAnvil = async (anvil: AnvilProcess, rpcUrl: string) => {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    if (anvil.exitCode !== null) return false
    try {
      const response = await postRpc(rpcUrl, "web3_clientVersion", [])
      if (response.ok) return true
    } catch {
      // The node is not listening yet; retry until the budget is spent.
    }
    await Bun.sleep(READINESS_INTERVAL_MS)
  }
  return false
}

// The forwarder is injected as raw state-override code, so its runtime must
// be validated by execution, not just encoding checks: this test replays the
// exact override against a local Anvil node.
describe("static-call forwarder bytecode", () => {
  it(
    "forwards reads via STATICCALL and propagates reverts",
    async () => {
      if (!(await anvilAvailable())) {
        console.warn("anvil not installed; skipping forwarder execution test.")
        return
      }
      const port = allocatePort()
      const rpcUrl = `http://127.0.0.1:${port}`
      const anvil = spawnAnvil(port)
      try {
        if (!(await waitForAnvil(anvil, rpcUrl))) {
          throw new Error(await describeAnvilFailure(anvil, port))
        }

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
        const viaProxyError = await postRpc(rpcUrl, "eth_call", [
          {
            data: wrapped(mockStorer),
            to: sliceWalletSimulationStaticCallProxy
          },
          "latest"
        ])
        const viaProxyBody = (await viaProxyError.json()) as {
          error?: { message?: string }
          result?: unknown
        }
        expect(viaProxyBody.error).toBeDefined()
        expect(viaProxyBody.result).toBeUndefined()

        // A reverting inner read surfaces as a failed subcall would in
        // aggregate3: eth_call reverts and the proxy propagates the inner
        // return data as revert data.
        const reverting = await postRpc(rpcUrl, "eth_call", [
          {
            data: wrapped(mockReverter),
            to: sliceWalletSimulationStaticCallProxy
          },
          "latest"
        ])
        const revertedBody = (await reverting.json()) as {
          error?: { data?: string }
        }
        expect(revertedBody.error?.data?.endsWith("fe")).toBe(true)
      } finally {
        await shutDownAnvil(anvil)
      }
    },
    TEST_TIMEOUT_MS
  )
})

const rpc = async (
  anvil: AnvilProcess,
  rpcUrl: string,
  method: string,
  params: readonly unknown[]
): Promise<string | null> => {
  const response = await postRpc(rpcUrl, method, params)
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
