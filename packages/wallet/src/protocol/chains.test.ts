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
import {
  sliceKernelSlicerRegistryPolicyAddress,
  sliceKernelWeightedP256SignerAddress
} from "./execution/utils/sliceKernelAddresses"

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

  test("de-admits authorities while Kernel runtime evidence is missing", () => {
    const base = getSliceWalletChainPolicy(8453)

    expect(base.authorityAdmission).toEqual({
      checkout: false,
      generic: false,
      management: false
    })
    expect(base.contracts.timestampPolicy.runtimeCodeHash).not.toBeNull()
    expect(base.contracts.rateLimitPolicy.runtimeCodeHash).not.toBeNull()
    expect(base.contracts.weightedP256Signer.runtimeCodeHash).toBeNull()
    expect(base.contracts.timelockPolicy.runtimeCodeHash).toBeNull()
    expect(base.contracts.slicerRegistryPolicy.runtimeCodeHash).toBeNull()
    expect(base.contracts.kernelFactory.initCodeHash).not.toBeNull()
    expect(base.contracts.kernelFactory.runtimeCodeHash).toBeNull()
    expect(base.contracts.kernelImplementation.runtimeCodeHash).toBeNull()
    expect(base.contracts.weightedP256Signer.address).toBe(
      sliceKernelWeightedP256SignerAddress
    )
    expect(base.contracts.slicerRegistryPolicy.address).toBe(
      sliceKernelSlicerRegistryPolicyAddress
    )
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "generic",
        chainId: 8453
      })
    ).toThrow("Slice Wallet chain 8453 is not provisioned.")
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "checkout",
        chainId: 8453
      })
    ).toThrow("Slice Wallet chain 8453 is not provisioned.")
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "management",
        chainId: 8453
      })
    ).toThrow("Slice Wallet chain 8453 is not provisioned.")
  })

  test("exposes only chains with complete admission evidence", () => {
    expect(sliceWalletSupportedChainIds).toEqual([])
    for (const chainId of [1, 10, 8453, 42161]) {
      expect(getSliceWalletChainPolicy(chainId).admitted).toBe(false)
      expect(() => getSliceWalletChainManifest(chainId)).toThrow(
        `Slice Wallet chain ${chainId} is not provisioned.`
      )
    }
  })

  test("admits the deterministically seeded local development chain", () => {
    expect(sliceWalletDevelopmentChainIds).toEqual([anvil.id])
    const local = getSliceWalletChainManifest(anvil.id)

    expect(local.authorityAdmission).toEqual({
      checkout: true,
      generic: true,
      management: true
    })
    expect(local.contracts.weightedP256Signer.runtimeCodeHash).toBeNull()
    expect(local.contracts.kernelFactory.initCodeHash).not.toBeNull()
    expect(local.defaultTransports).toEqual({
      bundlerUrl: "http://127.0.0.1:4337",
      paymasterUrl: "http://127.0.0.1:4338",
      rpcUrl: "http://127.0.0.1:8545"
    })
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "checkout",
        chainId: anvil.id
      })
    ).not.toThrow()
    expect(() =>
      assertSliceWalletAuthorityDeployment({
        authority: "management",
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
