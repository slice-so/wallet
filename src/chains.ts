// Auto-generated from contracts deployment facts and wallet chain policy.
// Run: bun run generate:chains

import type { SliceWalletChainManifest } from "./types/chains"

const parseBigIntFields = (
  manifest: Omit<SliceWalletChainManifest, "executionSafety"> & {
    executionSafety: {
      readonly [Key in keyof SliceWalletChainManifest["executionSafety"]]: string
    }
  }
): SliceWalletChainManifest => ({
  ...manifest,
  executionSafety: Object.freeze({
    maxCallGasLimit: BigInt(manifest.executionSafety.maxCallGasLimit),
    maxFeePerGas: BigInt(manifest.executionSafety.maxFeePerGas),
    maxNativeCostWei: BigInt(manifest.executionSafety.maxNativeCostWei),
    maxPaymasterPostOpGasLimit: BigInt(
      manifest.executionSafety.maxPaymasterPostOpGasLimit
    ),
    maxPaymasterVerificationGasLimit: BigInt(
      manifest.executionSafety.maxPaymasterVerificationGasLimit
    ),
    maxPrefundWei: BigInt(manifest.executionSafety.maxPrefundWei),
    maxPreVerificationGas: BigInt(
      manifest.executionSafety.maxPreVerificationGas
    ),
    maxPriorityFeePerGas: BigInt(manifest.executionSafety.maxPriorityFeePerGas),
    maxVerificationGasLimit: BigInt(
      manifest.executionSafety.maxVerificationGasLimit
    )
  })
})

const freezeManifest = (manifest: SliceWalletChainManifest) => {
  Object.freeze(manifest.chain.nativeCurrency)
  Object.freeze(manifest.chain.rpcUrls.default.http)
  Object.freeze(manifest.chain.rpcUrls.default)
  Object.freeze(manifest.chain.rpcUrls)
  if (manifest.chain.blockExplorers !== undefined) {
    Object.freeze(manifest.chain.blockExplorers.default)
    Object.freeze(manifest.chain.blockExplorers)
  }
  Object.freeze(manifest.chain)
  for (const contract of Object.values(manifest.contracts)) {
    Object.freeze(contract)
  }
  Object.freeze(manifest.contracts)
  Object.freeze(manifest.defaultTransports)
  Object.freeze(manifest.funding.sponsoredSecurityOperations)
  Object.freeze(manifest.funding)
  return Object.freeze(manifest)
}

const manifests = [
  {
    admitted: true,
    chain: {
      blockExplorers: {
        default: {
          name: "Base Explorer",
          url: "https://basescan.org"
        }
      },
      id: 8453,
      name: "Base",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH"
      },
      rpcUrls: {
        default: {
          http: ["https://mainnet.base.org"]
        }
      }
    },
    contracts: {
      entryPoint: {
        address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
        deployedRuntimeCodeHash:
          "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58",
        expectedRuntimeCodeHash:
          "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58",
        version: "0.7"
      },
      kernelFactory: {
        address: "0x2577507b78c2008Ff367261CB6285d44ba5eF2E9",
        deployedRuntimeCodeHash:
          "0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a",
        expectedRuntimeCodeHash:
          "0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a"
      },
      kernelMetaFactory: {
        address: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
        deployedRuntimeCodeHash:
          "0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa",
        expectedRuntimeCodeHash:
          "0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa"
      },
      kernelImplementation: {
        address: "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28",
        deployedRuntimeCodeHash:
          "0xe5b56d82025d2358308f77833fe29c3856b1a7a0f7a4b9f86b1fd77da3e3b4fb",
        expectedRuntimeCodeHash:
          "0xe5b56d82025d2358308f77833fe29c3856b1a7a0f7a4b9f86b1fd77da3e3b4fb",
        version: "0.3.3"
      },
      webAuthnRootValidator: {
        address: "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69",
        deployedRuntimeCodeHash:
          "0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea",
        expectedRuntimeCodeHash:
          "0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea",
        version: "0.0.3"
      },
      webAuthnSigner: {
        address: "0x65DEeC8fEe717dc044D0CFD63cCf55F02cCaC2b3",
        deployedRuntimeCodeHash:
          "0x62b28fd017f103166adc173fd9c173ff3f74238bcf1646fcca69bed4630f7380",
        expectedRuntimeCodeHash:
          "0x62b28fd017f103166adc173fd9c173ff3f74238bcf1646fcca69bed4630f7380",
        version: "0.0.4"
      },
      ecdsaSigner: {
        address: "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF",
        deployedRuntimeCodeHash:
          "0x510a0a1ab8b3f256a5c90b5fff51a9fd98656bd1c8a29fbd7857faa70c400ccd",
        expectedRuntimeCodeHash:
          "0x510a0a1ab8b3f256a5c90b5fff51a9fd98656bd1c8a29fbd7857faa70c400ccd"
      },
      callPolicy: {
        address: "0x85770b902D1e503D5f5141d9eaC16d0d08eEaDd2",
        deployedRuntimeCodeHash:
          "0x5934c38b0fac23319486e13370cfb9835a1b70cd10c6821351c669dfac74b356",
        expectedRuntimeCodeHash:
          "0x5934c38b0fac23319486e13370cfb9835a1b70cd10c6821351c669dfac74b356",
        version: "0.0.5"
      },
      sudoPolicy: {
        address: "0x67b436caD8a6D025DF6C82C5BB43fbF11fC5B9B7",
        deployedRuntimeCodeHash:
          "0x7be56b30ee64b743005cf51ac4a63f14a9045f68243d8fb275ed36038ba4e1a4",
        expectedRuntimeCodeHash:
          "0x7be56b30ee64b743005cf51ac4a63f14a9045f68243d8fb275ed36038ba4e1a4"
      },
      p256Verifier: {
        address: "0xc2b78104907F722DABAc4C69f826a522B2754De4",
        deployedRuntimeCodeHash:
          "0x3cd725b6ba67b40b7979190c41a015e82cf21e098eb61832ba623f8538bab7fc",
        expectedRuntimeCodeHash:
          "0x3cd725b6ba67b40b7979190c41a015e82cf21e098eb61832ba623f8538bab7fc"
      },
      soladyP256Verifier: {
        address: "0x000000000000D01eA45F9eFD5c54f037Fa57Ea1a",
        deployedRuntimeCodeHash:
          "0x9933b3f70809361dcfebe1f731b129890454cc29af5b32840dcae92400a8826b",
        expectedRuntimeCodeHash:
          "0x9933b3f70809361dcfebe1f731b129890454cc29af5b32840dcae92400a8826b"
      },
      weightedEcdsaSigner: {
        address: "0x45fC7d684683773DDA5bE3b3ba0a7997EccFdb0a",
        deployedRuntimeCodeHash:
          "0xd9dea77190cbc2104d2ecd8beab745196d3c5a01fe7b0ba49ee5b3b6c9a90be2",
        expectedRuntimeCodeHash:
          "0xd9dea77190cbc2104d2ecd8beab745196d3c5a01fe7b0ba49ee5b3b6c9a90be2"
      },
      weightedP256Signer: {
        address: "0xAD6e9430244f179101207D614F3c810f987d0786",
        deployedRuntimeCodeHash:
          "0xe9b3e9cb5ce3aca28fd9e1246997f51ae1eb2b98766b6e1a082f2fff059bbb5c",
        expectedRuntimeCodeHash:
          "0xe9b3e9cb5ce3aca28fd9e1246997f51ae1eb2b98766b6e1a082f2fff059bbb5c"
      },
      timelockPolicy: {
        address: "0x7f66B69270f96EC6793c545742CCBbBe028Be3f6",
        deployedRuntimeCodeHash:
          "0x54fa75c9eee444ae33dd03ce10e7ee988b8c7adc4e3f75b224ad9ef8091ca852",
        expectedRuntimeCodeHash:
          "0x54fa75c9eee444ae33dd03ce10e7ee988b8c7adc4e3f75b224ad9ef8091ca852"
      }
    },
    defaultTransports: {
      bundlerUrl: "https://api.slice.so/wallet-rpc/8453/bundler",
      rpcUrl: "https://mainnet.base.org"
    },
    executionSafety: {
      maxCallGasLimit: "3000000",
      maxFeePerGas: "20000000000",
      maxNativeCostWei: "10000000000000000",
      maxPaymasterPostOpGasLimit: "500000",
      maxPaymasterVerificationGasLimit: "1000000",
      maxPrefundWei: "20000000000000000",
      maxPreVerificationGas: "500000",
      maxPriorityFeePerGas: "2000000000",
      maxVerificationGasLimit: "5000000"
    },
    funding: {
      defaultPath: "self-funded-or-request-paymaster",
      sliceSponsorshipForExternalOrigins: false,
      sponsoredSecurityOperations: ["recovery-cancel"]
    },
    rip7212Available: true
  }
] as const

export const sliceWalletChainManifests = Object.freeze(
  Object.fromEntries(
    manifests.map((manifest) => [
      manifest.chain.id,
      freezeManifest(parseBigIntFields(manifest))
    ])
  ) as Readonly<Record<number, SliceWalletChainManifest>>
)

export const sliceWalletSupportedChainIds = Object.freeze(
  manifests
    .filter((manifest) => manifest.admitted)
    .map((manifest) => manifest.chain.id)
)

export const getSliceWalletChainManifest = (chainId: number) => {
  const manifest = sliceWalletChainManifests[chainId]
  if (manifest === undefined || !manifest.admitted) {
    throw new Error(`Slice Wallet chain ${chainId} is not provisioned.`)
  }
  return manifest
}

export const getSliceWalletChainPolicy = (chainId: number) => {
  const manifest = sliceWalletChainManifests[chainId]
  if (manifest === undefined) {
    throw new Error(`Slice Wallet chain ${chainId} is unsupported.`)
  }
  return manifest
}
