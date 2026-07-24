// Auto-generated from contracts deployment facts and wallet chain policy.
// Run: bun run generate:chains

import type {
  SliceWalletAuthorityKind,
  SliceWalletChainManifest
} from "./types/chains"

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
  Object.freeze(manifest.authorityAdmission)
  Object.freeze(manifest.chain.nativeCurrency)
  Object.freeze(manifest.chain.rpcUrls.default.http)
  Object.freeze(manifest.chain.rpcUrls.default)
  Object.freeze(manifest.chain.rpcUrls)
  if (manifest.chain.blockExplorers !== undefined) {
    Object.freeze(manifest.chain.blockExplorers.default)
    Object.freeze(manifest.chain.blockExplorers)
  }
  Object.freeze(manifest.chain)
  if (manifest.commerce.productsModule !== null) {
    Object.freeze(manifest.commerce.productsModule)
  }
  if (manifest.commerce.linkedLibraries !== null) {
    for (const library of Object.values(manifest.commerce.linkedLibraries)) {
      Object.freeze(library)
    }
    Object.freeze(manifest.commerce.linkedLibraries)
  }
  Object.freeze(manifest.commerce)
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
    authorityAdmission: {
      checkout: false,
      generic: false
    },
    chain: {
      blockExplorers: {
        default: {
          name: "Ethereum Explorer",
          url: "https://etherscan.io"
        }
      },
      id: 1,
      name: "Ethereum",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH"
      },
      rpcUrls: {
        default: {
          http: ["https://eth.merkle.io"]
        }
      }
    },
    commerce: {
      linkedLibraries: null,
      productsModule: null
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
          "0xd748c6060679ccb34583963e5edc21299e4c6723e7c7a80561d255861ed209b7",
        expectedRuntimeCodeHash:
          "0xd748c6060679ccb34583963e5edc21299e4c6723e7c7a80561d255861ed209b7",
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
          "0xf86faf7bdc6657af2c9cfe4ab7d966434c7534803d102f802c68faeeafd04254",
        expectedRuntimeCodeHash:
          "0xf86faf7bdc6657af2c9cfe4ab7d966434c7534803d102f802c68faeeafd04254"
      },
      weightedP256Signer: {
        address: "0xAD6e9430244f179101207D614F3c810f987d0786",
        deployedRuntimeCodeHash:
          "0x302550729fddf79d32fad7af872079c5bddfa50cd256c568df208f0bc3ae75aa",
        expectedRuntimeCodeHash:
          "0x302550729fddf79d32fad7af872079c5bddfa50cd256c568df208f0bc3ae75aa"
      },
      weightedP256SignerV2: {
        address: "0x2Ea791821AeEf796EE4444f96e4B4F3A5e8BB5f5",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xdebcf6c2aa2eac6c405b84a69c806fa61d252fdb4d9db0a9361be1673fe4cd70",
        version: "2"
      },
      singleCallPolicy: {
        address: "0xb01643c720984eaA0bc2A568c9a6E578655E7470",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xbb358c7efdb0c13ffd7388bc76ac3b711e5b70a12027894d7ac70dd86bf198cf",
        version: "1"
      },
      erc20AllowanceGuard: {
        address: "0x5eF07dBFf4f1c4Ae5A386629193BAB686D40CC4B",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xe7f628f095116bf5ed357d8e8ecba8689b1dc1a9d75a87a62f33d87e2e3798d8",
        version: "1"
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
      bundlerUrl: "https://api.slice.so/wallet-rpc/1/bundler",
      rpcUrl: "https://eth.merkle.io"
    },
    executionSafety: {
      maxCallGasLimit: "3000000",
      maxFeePerGas: "100000000000",
      maxNativeCostWei: "50000000000000000",
      maxPaymasterPostOpGasLimit: "500000",
      maxPaymasterVerificationGasLimit: "1000000",
      maxPrefundWei: "100000000000000000",
      maxPreVerificationGas: "500000",
      maxPriorityFeePerGas: "5000000000",
      maxVerificationGasLimit: "5000000"
    },
    funding: {
      defaultPath: "self-funded-or-request-paymaster",
      sliceSponsorshipForExternalOrigins: false,
      sponsoredSecurityOperations: []
    },
    rip7212Available: true
  },
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: false
    },
    chain: {
      blockExplorers: {
        default: {
          name: "OP Mainnet Explorer",
          url: "https://optimistic.etherscan.io"
        }
      },
      id: 10,
      name: "OP Mainnet",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH"
      },
      rpcUrls: {
        default: {
          http: ["https://mainnet.optimism.io"]
        }
      }
    },
    commerce: {
      linkedLibraries: null,
      productsModule: null
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
          "0x306a8076c569127202b4a9a9966b76991668f9687d3ff1fa435a0a5bb72dcdcc",
        expectedRuntimeCodeHash:
          "0x306a8076c569127202b4a9a9966b76991668f9687d3ff1fa435a0a5bb72dcdcc",
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
          "0xe519f84c3f2c9ef1638b500fced1257b705f6d412b2adaedf6cc7f17fb39f9ed",
        expectedRuntimeCodeHash:
          "0xe519f84c3f2c9ef1638b500fced1257b705f6d412b2adaedf6cc7f17fb39f9ed"
      },
      weightedP256Signer: {
        address: "0xAD6e9430244f179101207D614F3c810f987d0786",
        deployedRuntimeCodeHash:
          "0x02b510eabd6e28ecee7458edfcbd899180c022e574dad3c1cc93412abc5d2dd4",
        expectedRuntimeCodeHash:
          "0x02b510eabd6e28ecee7458edfcbd899180c022e574dad3c1cc93412abc5d2dd4"
      },
      weightedP256SignerV2: {
        address: "0x2Ea791821AeEf796EE4444f96e4B4F3A5e8BB5f5",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xdebcf6c2aa2eac6c405b84a69c806fa61d252fdb4d9db0a9361be1673fe4cd70",
        version: "2"
      },
      singleCallPolicy: {
        address: "0xb01643c720984eaA0bc2A568c9a6E578655E7470",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xbb358c7efdb0c13ffd7388bc76ac3b711e5b70a12027894d7ac70dd86bf198cf",
        version: "1"
      },
      erc20AllowanceGuard: {
        address: "0x5eF07dBFf4f1c4Ae5A386629193BAB686D40CC4B",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xe7f628f095116bf5ed357d8e8ecba8689b1dc1a9d75a87a62f33d87e2e3798d8",
        version: "1"
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
      bundlerUrl: "https://api.slice.so/wallet-rpc/10/bundler",
      rpcUrl: "https://mainnet.optimism.io"
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
      sponsoredSecurityOperations: []
    },
    rip7212Available: true
  },
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: false
    },
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
    commerce: {
      linkedLibraries: {
        productManagementLib: {
          address: "0x586FD42B36868Ffa47334D79c64769F62E5Fa35d",
          deployedRuntimeCodeHash: null,
          expectedRuntimeCodeHash:
            "0xc295041324a33b77daf02d21ef277eecdba269bac28a2a7558301910d6734af9"
        },
        productPaymentLib: {
          address: "0x7A7De78088e9985dd36bAe4f8F633e5E596d9372",
          deployedRuntimeCodeHash: null,
          expectedRuntimeCodeHash:
            "0x68176bdab087683f8abd32d48cb3c0cb8c2306cb128e3e78fd0b621bfb34b540"
        }
      },
      productsModule: {
        proxyAddress: "0xb9d5B99d5D0fA04dD7eb2b0CD7753317C2ea1a84",
        deployedImplementationAddress:
          "0x0901C4316b23c048fbFC99dA80943D23D5144272",
        deployedRuntimeCodeHash:
          "0xee92378a76f48bea38d0f9d5fc6acf0e00fe912585d7f439761d21613c48d7f7",
        expectedRuntimeCodeHash:
          "0x0f9ed2a85a347110c51f0a0e951987191fc03350912dd450576a8d9dae5b43dd",
        upgradeTransactionHash:
          "0x113ceaee01bb7030a84859bef95f7f2c966c3b516666b4b274cf42ce328511ea",
        verifiedAtBlock: 49036300
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
      weightedP256SignerV2: {
        address: "0x2Ea791821AeEf796EE4444f96e4B4F3A5e8BB5f5",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xdebcf6c2aa2eac6c405b84a69c806fa61d252fdb4d9db0a9361be1673fe4cd70",
        version: "2"
      },
      singleCallPolicy: {
        address: "0xb01643c720984eaA0bc2A568c9a6E578655E7470",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xbb358c7efdb0c13ffd7388bc76ac3b711e5b70a12027894d7ac70dd86bf198cf",
        version: "1"
      },
      erc20AllowanceGuard: {
        address: "0x5eF07dBFf4f1c4Ae5A386629193BAB686D40CC4B",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xe7f628f095116bf5ed357d8e8ecba8689b1dc1a9d75a87a62f33d87e2e3798d8",
        version: "1"
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
      sponsoredSecurityOperations: [
        "device-add",
        "device-remove",
        "recovery-cancel",
        "session-install"
      ]
    },
    rip7212Available: true
  },
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: false
    },
    chain: {
      blockExplorers: {
        default: {
          name: "Arbitrum One Explorer",
          url: "https://arbiscan.io"
        }
      },
      id: 42161,
      name: "Arbitrum One",
      nativeCurrency: {
        decimals: 18,
        name: "Ether",
        symbol: "ETH"
      },
      rpcUrls: {
        default: {
          http: ["https://arb1.arbitrum.io/rpc"]
        }
      }
    },
    commerce: {
      linkedLibraries: null,
      productsModule: null
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
          "0x9c390b4a1d88a48a63dfb485bc4b6117f59e7f48e4138a93b870e1dd35e25fde",
        expectedRuntimeCodeHash:
          "0x9c390b4a1d88a48a63dfb485bc4b6117f59e7f48e4138a93b870e1dd35e25fde",
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
          "0x38bf435be1112dabcaf5af04d6398fd3ad1f432173fd46e3864ff73f9e0b036f",
        expectedRuntimeCodeHash:
          "0x38bf435be1112dabcaf5af04d6398fd3ad1f432173fd46e3864ff73f9e0b036f"
      },
      weightedP256Signer: {
        address: "0xAD6e9430244f179101207D614F3c810f987d0786",
        deployedRuntimeCodeHash:
          "0x5fa4e404e89ea1f5406315c042590621e2bc4e1ebbd5d24527ef96f4f6680d6c",
        expectedRuntimeCodeHash:
          "0x5fa4e404e89ea1f5406315c042590621e2bc4e1ebbd5d24527ef96f4f6680d6c"
      },
      weightedP256SignerV2: {
        address: "0x2Ea791821AeEf796EE4444f96e4B4F3A5e8BB5f5",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xdebcf6c2aa2eac6c405b84a69c806fa61d252fdb4d9db0a9361be1673fe4cd70",
        version: "2"
      },
      singleCallPolicy: {
        address: "0xb01643c720984eaA0bc2A568c9a6E578655E7470",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xbb358c7efdb0c13ffd7388bc76ac3b711e5b70a12027894d7ac70dd86bf198cf",
        version: "1"
      },
      erc20AllowanceGuard: {
        address: "0x5eF07dBFf4f1c4Ae5A386629193BAB686D40CC4B",
        deployedRuntimeCodeHash: null,
        expectedRuntimeCodeHash:
          "0xe7f628f095116bf5ed357d8e8ecba8689b1dc1a9d75a87a62f33d87e2e3798d8",
        version: "1"
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
      bundlerUrl: "https://api.slice.so/wallet-rpc/42161/bundler",
      rpcUrl: "https://arb1.arbitrum.io/rpc"
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
      sponsoredSecurityOperations: []
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

export const assertSliceWalletAuthorityDeployment = ({
  authority,
  chainId
}: {
  authority: SliceWalletAuthorityKind
  chainId: number
}) => {
  const manifest = getSliceWalletChainManifest(chainId)
  if (!manifest.authorityAdmission[authority]) {
    throw new Error(
      `Slice Wallet ${authority} authority is not verified on chain ${chainId}.`
    )
  }
  return manifest
}
