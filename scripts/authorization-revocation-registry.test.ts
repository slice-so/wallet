import { describe, expect, it } from "bun:test"
import deployments from "../../contracts/wallet/deployments/addresses.json"
import { sliceIdAuthorizationRevocationRegistryAddress } from "../src/execution/utils/sliceUserOperationPolicy"

describe("authorization revocation registry deployment facts", () => {
  it("pins one Base-scoped service outside wallet chain contracts", () => {
    const service = deployments.services.authorizationRevocationRegistry
    expect(service.chainId).toBe(8453)
    expect(service.address.toLowerCase()).toBe(
      sliceIdAuthorizationRevocationRegistryAddress
    )
    for (const chain of Object.values(deployments.chains)) {
      expect("authorizationRevocationRegistry" in chain.contracts).toBe(false)
    }
  })
})
