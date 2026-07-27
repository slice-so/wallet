import { describe, expect, test } from "bun:test"
import { anvil } from "viem/chains"
import {
  assertSliceWalletAuthorityDeployment,
  getSliceWalletChainManifest,
  getSliceWalletChainPolicy,
  sliceWalletChainManifests,
  sliceWalletDevelopmentChainIds,
  sliceWalletSupportedChainIds
} from "./chains"
import { sliceKernelWeightedP256SignerAddress } from "./execution/utils/sliceKernelAddresses"

describe("Slice Wallet chain manifest", () => {
  test("deep-freezes generated security and operational metadata", () => {
    const base = getSliceWalletChainPolicy(8453)

    expect(Object.isFrozen(sliceWalletChainManifests)).toBe(true)
    expect(Object.isFrozen(base)).toBe(true)
    expect(Object.isFrozen(base.chain)).toBe(true)
    expect(Object.isFrozen(base.chain.nativeCurrency)).toBe(true)
    expect(Object.isFrozen(base.contracts)).toBe(true)
    expect(Object.isFrozen(base.contracts.weightedP256Signer)).toBe(true)
    expect(Object.isFrozen(base.authorityAdmission)).toBe(true)
    expect(Object.isFrozen(base.executionSafety)).toBe(true)
    expect(Object.isFrozen(base.defaultTransports)).toBe(true)
    expect(Object.isFrozen(base.funding.sponsoredSecurityOperations)).toBe(true)
    expect(() =>
      Object.defineProperty(base.contracts, "entryPoint", { value: null })
    ).toThrow()
  })

  test("admits only authorities whose required deployments match verified facts", () => {
    const base = getSliceWalletChainManifest(8453)

    expect(base.authorityAdmission).toEqual({
      checkout: false,
      generic: true
    })
    expect(base.contracts.timestampPolicy.deployedRuntimeCodeHash).toBe(
      base.contracts.timestampPolicy.expectedRuntimeCodeHash
    )
    expect(base.contracts.rateLimitPolicy.deployedRuntimeCodeHash).toBe(
      base.contracts.rateLimitPolicy.expectedRuntimeCodeHash
    )
    expect(base.contracts.weightedP256Signer.deployedRuntimeCodeHash).toBeNull()
    expect(base.contracts.weightedP256Signer.address).toBe(
      sliceKernelWeightedP256SignerAddress
    )
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "generic",
        chainId: 8453
      })
    ).not.toThrow()
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "checkout",
        chainId: 8453
      })
    ).toThrow("Slice Wallet checkout authority is not verified on chain 8453.")
  })

  test("exposes only chains with complete admission evidence", () => {
    expect(sliceWalletSupportedChainIds).toEqual([1, 10, 8453, 42161])
    for (const chainId of sliceWalletSupportedChainIds) {
      expect(getSliceWalletChainPolicy(chainId).admitted).toBe(true)
      expect(getSliceWalletChainManifest(chainId).chain.id).toBe(chainId)
    }
    expect(getSliceWalletChainManifest(8453).chain.id).toBe(8453)
  })

  test("admits the deterministically seeded local development chain", () => {
    expect(sliceWalletDevelopmentChainIds).toEqual([anvil.id])
    const local = getSliceWalletChainManifest(anvil.id)

    expect(local.authorityAdmission).toEqual({
      checkout: true,
      generic: true
    })
    expect(local.contracts.weightedP256Signer.deployedRuntimeCodeHash).toBe(
      local.contracts.weightedP256Signer.expectedRuntimeCodeHash
    )
    expect(local.defaultTransports).toEqual({
      bundlerUrl: "http://127.0.0.1:4337",
      rpcUrl: "http://127.0.0.1:8545"
    })
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "checkout",
        chainId: anvil.id
      })
    ).not.toThrow()
    expect(getSliceWalletChainPolicy(anvil.id)).toBe(local)
  })

  test("rejects chains missing from the generated inputs", () => {
    expect(() => getSliceWalletChainPolicy(137)).toThrow(
      "Slice Wallet chain 137 is unsupported."
    )
  })
})
