import { describe, expect, test } from "bun:test"
import {
  assertSliceWalletAuthorityDeployment,
  getSliceWalletChainManifest,
  getSliceWalletChainPolicy,
  sliceWalletChainManifests,
  sliceWalletSupportedChainIds
} from "./chains"

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
    expect(Object.isFrozen(base.commerce)).toBe(true)
    expect(Object.isFrozen(base.commerce.productsModule)).toBe(true)
    expect(Object.isFrozen(base.commerce.linkedLibraries)).toBe(true)
    expect(
      Object.isFrozen(base.commerce.linkedLibraries?.productPaymentLib)
    ).toBe(true)
    expect(Object.isFrozen(base.executionSafety)).toBe(true)
    expect(Object.isFrozen(base.defaultTransports)).toBe(true)
    expect(Object.isFrozen(base.funding.sponsoredSecurityOperations)).toBe(true)
    expect(() =>
      Object.defineProperty(base.contracts, "entryPoint", { value: null })
    ).toThrow()
  })

  test("fails closed while authority deployments do not match verified facts", () => {
    const base = getSliceWalletChainManifest(8453)

    expect(base.authorityAdmission).toEqual({
      checkout: false,
      generic: false
    })
    expect(base.contracts.singleCallPolicy.deployedRuntimeCodeHash).toBeNull()
    expect(
      base.contracts.weightedP256SignerV2.deployedRuntimeCodeHash
    ).toBeNull()
    expect(
      base.contracts.erc20AllowanceGuard.deployedRuntimeCodeHash
    ).toBeNull()
    expect(base.commerce.productsModule?.deployedRuntimeCodeHash).not.toBe(
      base.commerce.productsModule?.expectedRuntimeCodeHash
    )
    expect(
      base.commerce.linkedLibraries?.productPaymentLib.deployedRuntimeCodeHash
    ).toBeNull()
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "generic",
        chainId: 8453
      })
    ).toThrow("Slice Wallet generic authority is not verified on chain 8453.")
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

  test("rejects chains missing from the generated inputs", () => {
    expect(() => getSliceWalletChainPolicy(137)).toThrow(
      "Slice Wallet chain 137 is unsupported."
    )
  })
})
