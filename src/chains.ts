// Auto-generated from contracts deployment facts and wallet chain policy.
// Run: bun run generate:chains

import type { Hex } from "viem"
import type {
  SliceWalletAuthorityKind,
  SliceWalletChainManifest,
  SliceWalletContractDeployments
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
  for (const contract of Object.values(manifest.contracts)) {
    Object.freeze(contract)
  }
  Object.freeze(manifest.contracts)
  Object.freeze(manifest.defaultTransports)
  Object.freeze(manifest.funding.sponsoredSecurityOperations)
  Object.freeze(manifest.funding)
  return Object.freeze(manifest)
}

const canonicalContracts = {
  erc6492BootstrapFactory: {
    address: "0x377E11216A60603Cc187a6B363783fF3A86A41a9"
  },
  entryPoint: {
    address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    version: "0.7"
  },
  kernelFactory: {
    address: "0x2577507b78c2008Ff367261CB6285d44ba5eF2E9"
  },
  kernelMetaFactory: {
    address: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5"
  },
  kernelImplementation: {
    address: "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28",
    version: "0.3.3"
  },
  webAuthnRootValidator: {
    address: "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69",
    version: "0.0.3"
  },
  webAuthnSigner: {
    address: "0x65DEeC8fEe717dc044D0CFD63cCf55F02cCaC2b3",
    version: "0.0.4"
  },
  ecdsaSigner: {
    address: "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF"
  },
  callPolicy: {
    address: "0x85770b902D1e503D5f5141d9eaC16d0d08eEaDd2",
    version: "0.0.5"
  },
  timestampPolicy: {
    address: "0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F"
  },
  rateLimitPolicy: {
    address: "0xf63d4139B25c836334edD76641356c6b74C86873"
  },
  sudoPolicy: {
    address: "0x67b436caD8a6D025DF6C82C5BB43fbF11fC5B9B7"
  },
  p256Verifier: {
    address: "0xc2b78104907F722DABAc4C69f826a522B2754De4"
  },
  soladyP256Verifier: {
    address: "0x000000000000D01eA45F9eFD5c54f037Fa57Ea1a"
  },
  weightedEcdsaSigner: {
    address: "0x45fC7d684683773DDA5bE3b3ba0a7997EccFdb0a"
  },
  weightedP256Signer: {
    address: "0xe9c0dBa15040D8B20a94D5bCA18382496B277485",
    version: "1"
  },
  timelockPolicy: {
    address: "0xA60CEe306BB822E2375cd47BdF76BA54F601754A"
  },
  slicerRegistryPolicy: {
    address: "0x0e894B496Ad5fdc99c6Bd4C5651f807E1dDE4D0c"
  }
} as const
const deployments = [
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: true,
      management: false
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
    rip7212Available: true,
    runtimeCodeHashes: {
      erc6492BootstrapFactory: null,
      entryPoint:
        "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58",
      kernelFactory:
        "0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a",
      kernelMetaFactory:
        "0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa",
      kernelImplementation:
        "0xd748c6060679ccb34583963e5edc21299e4c6723e7c7a80561d255861ed209b7",
      webAuthnRootValidator:
        "0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea",
      webAuthnSigner:
        "0x62b28fd017f103166adc173fd9c173ff3f74238bcf1646fcca69bed4630f7380",
      ecdsaSigner:
        "0x510a0a1ab8b3f256a5c90b5fff51a9fd98656bd1c8a29fbd7857faa70c400ccd",
      callPolicy:
        "0x5934c38b0fac23319486e13370cfb9835a1b70cd10c6821351c669dfac74b356",
      timestampPolicy:
        "0x1e7146c888fec3f757e9ed5473b766cdb8a782e1e10c39f65cbc68f4ab83c4d2",
      rateLimitPolicy:
        "0xb4fffdb494637e8e5bfc15d6500202c252392b498e518668f896dc6da0221183",
      sudoPolicy:
        "0x7be56b30ee64b743005cf51ac4a63f14a9045f68243d8fb275ed36038ba4e1a4",
      p256Verifier:
        "0x3cd725b6ba67b40b7979190c41a015e82cf21e098eb61832ba623f8538bab7fc",
      soladyP256Verifier:
        "0x9933b3f70809361dcfebe1f731b129890454cc29af5b32840dcae92400a8826b",
      weightedEcdsaSigner:
        "0xf86faf7bdc6657af2c9cfe4ab7d966434c7534803d102f802c68faeeafd04254",
      weightedP256Signer: null,
      timelockPolicy:
        "0x916329f95ecb10a3c18bab13155697cbb481161bf8b24acada52461e87e8e3b6",
      slicerRegistryPolicy: null
    }
  },
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: true,
      management: false
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
    rip7212Available: true,
    runtimeCodeHashes: {
      erc6492BootstrapFactory: null,
      entryPoint:
        "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58",
      kernelFactory:
        "0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a",
      kernelMetaFactory:
        "0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa",
      kernelImplementation:
        "0x306a8076c569127202b4a9a9966b76991668f9687d3ff1fa435a0a5bb72dcdcc",
      webAuthnRootValidator:
        "0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea",
      webAuthnSigner:
        "0x62b28fd017f103166adc173fd9c173ff3f74238bcf1646fcca69bed4630f7380",
      ecdsaSigner:
        "0x510a0a1ab8b3f256a5c90b5fff51a9fd98656bd1c8a29fbd7857faa70c400ccd",
      callPolicy:
        "0x5934c38b0fac23319486e13370cfb9835a1b70cd10c6821351c669dfac74b356",
      timestampPolicy:
        "0x1e7146c888fec3f757e9ed5473b766cdb8a782e1e10c39f65cbc68f4ab83c4d2",
      rateLimitPolicy:
        "0xb4fffdb494637e8e5bfc15d6500202c252392b498e518668f896dc6da0221183",
      sudoPolicy:
        "0x7be56b30ee64b743005cf51ac4a63f14a9045f68243d8fb275ed36038ba4e1a4",
      p256Verifier:
        "0x3cd725b6ba67b40b7979190c41a015e82cf21e098eb61832ba623f8538bab7fc",
      soladyP256Verifier:
        "0x9933b3f70809361dcfebe1f731b129890454cc29af5b32840dcae92400a8826b",
      weightedEcdsaSigner:
        "0xe519f84c3f2c9ef1638b500fced1257b705f6d412b2adaedf6cc7f17fb39f9ed",
      weightedP256Signer: null,
      timelockPolicy:
        "0x916329f95ecb10a3c18bab13155697cbb481161bf8b24acada52461e87e8e3b6",
      slicerRegistryPolicy: null
    }
  },
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: true,
      management: false
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
    rip7212Available: true,
    runtimeCodeHashes: {
      erc6492BootstrapFactory: null,
      entryPoint:
        "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58",
      kernelFactory:
        "0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a",
      kernelMetaFactory:
        "0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa",
      kernelImplementation:
        "0xe5b56d82025d2358308f77833fe29c3856b1a7a0f7a4b9f86b1fd77da3e3b4fb",
      webAuthnRootValidator:
        "0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea",
      webAuthnSigner:
        "0x62b28fd017f103166adc173fd9c173ff3f74238bcf1646fcca69bed4630f7380",
      ecdsaSigner:
        "0x510a0a1ab8b3f256a5c90b5fff51a9fd98656bd1c8a29fbd7857faa70c400ccd",
      callPolicy:
        "0x5934c38b0fac23319486e13370cfb9835a1b70cd10c6821351c669dfac74b356",
      timestampPolicy:
        "0x1e7146c888fec3f757e9ed5473b766cdb8a782e1e10c39f65cbc68f4ab83c4d2",
      rateLimitPolicy:
        "0xb4fffdb494637e8e5bfc15d6500202c252392b498e518668f896dc6da0221183",
      sudoPolicy:
        "0x7be56b30ee64b743005cf51ac4a63f14a9045f68243d8fb275ed36038ba4e1a4",
      p256Verifier:
        "0x3cd725b6ba67b40b7979190c41a015e82cf21e098eb61832ba623f8538bab7fc",
      soladyP256Verifier:
        "0x9933b3f70809361dcfebe1f731b129890454cc29af5b32840dcae92400a8826b",
      weightedEcdsaSigner:
        "0xd9dea77190cbc2104d2ecd8beab745196d3c5a01fe7b0ba49ee5b3b6c9a90be2",
      weightedP256Signer: null,
      timelockPolicy:
        "0x916329f95ecb10a3c18bab13155697cbb481161bf8b24acada52461e87e8e3b6",
      slicerRegistryPolicy: null
    }
  },
  {
    admitted: true,
    authorityAdmission: {
      checkout: false,
      generic: true,
      management: false
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
    rip7212Available: true,
    runtimeCodeHashes: {
      erc6492BootstrapFactory: null,
      entryPoint:
        "0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58",
      kernelFactory:
        "0xcc4b1b98f5716bf61042d87bfedd4709a5c9a597c41f3bb0e6fb6fe1a4ebd37a",
      kernelMetaFactory:
        "0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa",
      kernelImplementation:
        "0x9c390b4a1d88a48a63dfb485bc4b6117f59e7f48e4138a93b870e1dd35e25fde",
      webAuthnRootValidator:
        "0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea",
      webAuthnSigner:
        "0x62b28fd017f103166adc173fd9c173ff3f74238bcf1646fcca69bed4630f7380",
      ecdsaSigner:
        "0x510a0a1ab8b3f256a5c90b5fff51a9fd98656bd1c8a29fbd7857faa70c400ccd",
      callPolicy:
        "0x5934c38b0fac23319486e13370cfb9835a1b70cd10c6821351c669dfac74b356",
      timestampPolicy:
        "0x1e7146c888fec3f757e9ed5473b766cdb8a782e1e10c39f65cbc68f4ab83c4d2",
      rateLimitPolicy:
        "0xb4fffdb494637e8e5bfc15d6500202c252392b498e518668f896dc6da0221183",
      sudoPolicy:
        "0x7be56b30ee64b743005cf51ac4a63f14a9045f68243d8fb275ed36038ba4e1a4",
      p256Verifier:
        "0x3cd725b6ba67b40b7979190c41a015e82cf21e098eb61832ba623f8538bab7fc",
      soladyP256Verifier:
        "0x9933b3f70809361dcfebe1f731b129890454cc29af5b32840dcae92400a8826b",
      weightedEcdsaSigner:
        "0x38bf435be1112dabcaf5af04d6398fd3ad1f432173fd46e3864ff73f9e0b036f",
      weightedP256Signer: null,
      timelockPolicy:
        "0x916329f95ecb10a3c18bab13155697cbb481161bf8b24acada52461e87e8e3b6",
      slicerRegistryPolicy: null
    }
  }
] as const

const buildContracts = (
  runtimeCodeHashes: Readonly<
    Record<keyof typeof canonicalContracts, Hex | null>
  >
) =>
  ({
    erc6492BootstrapFactory: {
      ...canonicalContracts.erc6492BootstrapFactory,
      runtimeCodeHash: runtimeCodeHashes.erc6492BootstrapFactory ?? null
    },
    entryPoint: {
      ...canonicalContracts.entryPoint,
      runtimeCodeHash: runtimeCodeHashes.entryPoint ?? null
    },
    kernelFactory: {
      ...canonicalContracts.kernelFactory,
      runtimeCodeHash: runtimeCodeHashes.kernelFactory ?? null
    },
    kernelMetaFactory: {
      ...canonicalContracts.kernelMetaFactory,
      runtimeCodeHash: runtimeCodeHashes.kernelMetaFactory ?? null
    },
    kernelImplementation: {
      ...canonicalContracts.kernelImplementation,
      runtimeCodeHash: runtimeCodeHashes.kernelImplementation ?? null
    },
    webAuthnRootValidator: {
      ...canonicalContracts.webAuthnRootValidator,
      runtimeCodeHash: runtimeCodeHashes.webAuthnRootValidator ?? null
    },
    webAuthnSigner: {
      ...canonicalContracts.webAuthnSigner,
      runtimeCodeHash: runtimeCodeHashes.webAuthnSigner ?? null
    },
    ecdsaSigner: {
      ...canonicalContracts.ecdsaSigner,
      runtimeCodeHash: runtimeCodeHashes.ecdsaSigner ?? null
    },
    callPolicy: {
      ...canonicalContracts.callPolicy,
      runtimeCodeHash: runtimeCodeHashes.callPolicy ?? null
    },
    timestampPolicy: {
      ...canonicalContracts.timestampPolicy,
      runtimeCodeHash: runtimeCodeHashes.timestampPolicy ?? null
    },
    rateLimitPolicy: {
      ...canonicalContracts.rateLimitPolicy,
      runtimeCodeHash: runtimeCodeHashes.rateLimitPolicy ?? null
    },
    sudoPolicy: {
      ...canonicalContracts.sudoPolicy,
      runtimeCodeHash: runtimeCodeHashes.sudoPolicy ?? null
    },
    p256Verifier: {
      ...canonicalContracts.p256Verifier,
      runtimeCodeHash: runtimeCodeHashes.p256Verifier ?? null
    },
    soladyP256Verifier: {
      ...canonicalContracts.soladyP256Verifier,
      runtimeCodeHash: runtimeCodeHashes.soladyP256Verifier ?? null
    },
    weightedEcdsaSigner: {
      ...canonicalContracts.weightedEcdsaSigner,
      runtimeCodeHash: runtimeCodeHashes.weightedEcdsaSigner ?? null
    },
    weightedP256Signer: {
      ...canonicalContracts.weightedP256Signer,
      runtimeCodeHash: runtimeCodeHashes.weightedP256Signer ?? null
    },
    timelockPolicy: {
      ...canonicalContracts.timelockPolicy,
      runtimeCodeHash: runtimeCodeHashes.timelockPolicy ?? null
    },
    slicerRegistryPolicy: {
      ...canonicalContracts.slicerRegistryPolicy,
      runtimeCodeHash: runtimeCodeHashes.slicerRegistryPolicy ?? null
    }
  }) satisfies SliceWalletContractDeployments

const productionManifests = Object.fromEntries(
  deployments.map(({ runtimeCodeHashes, ...deployment }) => {
    const manifest = {
      ...deployment,
      contracts: buildContracts(runtimeCodeHashes)
    }
    return [manifest.chain.id, freezeManifest(parseBigIntFields(manifest))]
  })
) as Readonly<Record<number, SliceWalletChainManifest>>

const canonicalDevelopmentManifest = productionManifests[8453]
if (canonicalDevelopmentManifest === undefined) {
  throw new Error("The canonical Base wallet manifest is missing.")
}

const developmentManifest = freezeManifest({
  ...canonicalDevelopmentManifest,
  admitted: true,
  authorityAdmission: { checkout: true, generic: true, management: true },
  chain: {
    ...canonicalDevelopmentManifest.chain,
    blockExplorers: {
      default: { name: "Anvil RPC", url: "http://127.0.0.1:8545" }
    },
    id: 31337,
    name: "Anvil",
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } }
  },
  contracts: Object.fromEntries(
    Object.entries(canonicalDevelopmentManifest.contracts).map(
      ([name, contract]) => [name, { ...contract }]
    )
  ) as SliceWalletChainManifest["contracts"],
  defaultTransports: {
    bundlerUrl: "http://127.0.0.1:4337",
    rpcUrl: "http://127.0.0.1:8545"
  },
  rip7212Available: false
})

export const sliceWalletChainManifests = Object.freeze({
  ...productionManifests,
  [developmentManifest.chain.id]: developmentManifest
} as Readonly<Record<number, SliceWalletChainManifest>>)

export const sliceWalletSupportedChainIds = Object.freeze(
  deployments
    .filter((deployment) => deployment.admitted)
    .map((deployment) => deployment.chain.id)
)

export const sliceWalletDevelopmentChainIds = Object.freeze([
  developmentManifest.chain.id
])

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
