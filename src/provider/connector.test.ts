import { describe, expect, test } from "bun:test"
import { createConfig, http } from "@wagmi/core"
import { anvil } from "viem/chains"
import { sliceWalletConnector } from "./connector"

describe("Slice Wallet Wagmi connector", () => {
  test("reports as injected so embedded-wallet UIs invoke connect", () => {
    const browserWindow = Object.assign(Object.create(null) as Window, {
      localStorage: null,
      location: { href: "http://localhost:3001" }
    })
    const config = createConfig({
      chains: [anvil],
      connectors: [
        sliceWalletConnector(
          {
            announce: false,
            defaultChainId: anvil.id,
            idOrigin: "http://localhost:3003",
            transports: {
              [anvil.id]: {
                bundlerUrl: "http://localhost:3001/api/bundler",
                rpcUrl: "http://localhost:8545"
              }
            }
          },
          {
            document: Object.create(null) as Document,
            window: browserWindow
          }
        )
      ],
      transports: { [anvil.id]: http("http://localhost:8545") }
    })

    expect(config.connectors[0]).toMatchObject({
      id: "slice-wallet",
      name: "Slice ID",
      type: "injected"
    })
  })
})
