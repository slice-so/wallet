#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { getProductsModuleAddress } from "@slice/indexer-shared"
import coreDeployments from "../../contracts/core/deployments/addresses.json"
import deployments from "../../contracts/wallet/deployments/addresses.json"
import policy from "../config/chains.policy.json"
import {
  hasCompleteSliceWalletAdmissionEvidence,
  hasVerifiedCheckoutAuthorityDeployment,
  hasVerifiedGenericAuthorityDeployment
} from "./lib/chainAdmission"

const outputPath = resolve(import.meta.dir, "../src/chains.ts")
const checkOnly = process.argv.includes("--check")

if (
  coreDeployments.version !== 1 ||
  deployments.version !== 1 ||
  policy.version !== 1
) {
  throw new Error("Unsupported Slice wallet chain input version.")
}

const chainIds = Object.keys(policy.chains).sort(
  (first, second) => Number(first) - Number(second)
)

// Runtime helpers still encode these canonical CREATE2 addresses directly.
// Fail generation before a differing chain can ever be admitted silently.
const pinnedAddressContractNames = [
  "callPolicy",
  "ecdsaSigner",
  "entryPoint",
  "erc20AllowanceGuard",
  "kernelFactory",
  "kernelImplementation",
  "kernelMetaFactory",
  "p256Verifier",
  "singleCallPolicy",
  "sudoPolicy",
  "timelockPolicy",
  "webAuthnRootValidator",
  "webAuthnSigner",
  "weightedEcdsaSigner",
  "weightedP256Signer",
  "weightedP256SignerV2"
] as const
const canonicalDeployment = deployments.chains["8453"]

if (canonicalDeployment === undefined) {
  throw new Error("The canonical Base deployment facts are missing.")
}

for (const chainId of chainIds) {
  const deployment =
    deployments.chains[chainId as keyof typeof deployments.chains]
  if (deployment === undefined) continue
  for (const contractName of pinnedAddressContractNames) {
    if (
      deployment.contracts[contractName].address.toLowerCase() !==
      canonicalDeployment.contracts[contractName].address.toLowerCase()
    ) {
      throw new Error(
        `${contractName} on chain ${chainId} differs from the canonical address used by cross-chain account encoding.`
      )
    }
  }
}

const entries = chainIds.map((chainId) => {
  const policyChain = policy.chains[chainId as keyof typeof policy.chains]
  const deployment =
    deployments.chains[chainId as keyof typeof deployments.chains]
  if (deployment === undefined || deployment.chainId !== Number(chainId)) {
    throw new Error(`Missing deployment facts for wallet chain ${chainId}.`)
  }

  const contracts = Object.fromEntries(
    Object.entries(deployment.contracts).map(([name, contract]) => [
      name,
      {
        address: contract.address,
        deployedRuntimeCodeHash: contract.deployedRuntimeCodeHash,
        expectedRuntimeCodeHash: contract.expectedRuntimeCodeHash,
        ...("version" in contract ? { version: contract.version } : {})
      }
    ])
  )
  const admitted = hasCompleteSliceWalletAdmissionEvidence(deployment)
  const coreDeployment =
    coreDeployments.chains[chainId as keyof typeof coreDeployments.chains]
  const productsModule = coreDeployment?.productsModule
  if (
    productsModule !== undefined &&
    productsModule.proxyAddress.toLowerCase() !==
      getProductsModuleAddress(Number(chainId)).toLowerCase()
  ) {
    throw new Error(
      `ProductsModule deployment facts for chain ${chainId} do not reference the canonical proxy.`
    )
  }
  const genericAuthorityAdmitted =
    hasVerifiedGenericAuthorityDeployment(deployment)
  const checkoutAuthorityAdmitted = hasVerifiedCheckoutAuthorityDeployment({
    core: coreDeployment,
    wallet: deployment
  })

  return {
    admitted,
    authorityAdmission: {
      checkout: checkoutAuthorityAdmitted,
      generic: genericAuthorityAdmitted
    },
    chain: {
      blockExplorers: {
        default: {
          name: `${policyChain.chain.name} Explorer`,
          url: policyChain.chain.blockExplorerUrl
        }
      },
      id: deployment.chainId,
      name: policyChain.chain.name,
      nativeCurrency: policyChain.chain.nativeCurrency,
      rpcUrls: {
        default: { http: [policyChain.defaultTransports.rpcUrl] }
      }
    },
    commerce: {
      linkedLibraries: coreDeployment?.linkedLibraries ?? null,
      productsModule: productsModule ?? null
    },
    contracts,
    defaultTransports: policyChain.defaultTransports,
    executionSafety: policyChain.executionSafety,
    funding: policyChain.funding,
    rip7212Available: deployment.verification.rip7212Available
  }
})

const generated = `// Auto-generated from contracts deployment facts and wallet chain policy.
// Run: bun run generate:chains

import type {
  SliceWalletAuthorityKind,
  SliceWalletChainManifest
} from "./types/chains"

const parseBigIntFields = (manifest: Omit<SliceWalletChainManifest, "executionSafety"> & {
  executionSafety: { readonly [Key in keyof SliceWalletChainManifest["executionSafety"]]: string }
}): SliceWalletChainManifest => ({
  ...manifest,
  executionSafety: Object.freeze({
    maxCallGasLimit: BigInt(manifest.executionSafety.maxCallGasLimit),
    maxFeePerGas: BigInt(manifest.executionSafety.maxFeePerGas),
    maxNativeCostWei: BigInt(manifest.executionSafety.maxNativeCostWei),
    maxPaymasterPostOpGasLimit: BigInt(manifest.executionSafety.maxPaymasterPostOpGasLimit),
    maxPaymasterVerificationGasLimit: BigInt(manifest.executionSafety.maxPaymasterVerificationGasLimit),
    maxPrefundWei: BigInt(manifest.executionSafety.maxPrefundWei),
    maxPreVerificationGas: BigInt(manifest.executionSafety.maxPreVerificationGas),
    maxPriorityFeePerGas: BigInt(manifest.executionSafety.maxPriorityFeePerGas),
    maxVerificationGasLimit: BigInt(manifest.executionSafety.maxVerificationGasLimit)
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

const manifests = ${JSON.stringify(entries, null, 2)} as const

export const sliceWalletChainManifests = Object.freeze(
  Object.fromEntries(
    manifests.map((manifest) => [
      manifest.chain.id,
      freezeManifest(parseBigIntFields(manifest))
    ])
  ) as Readonly<Record<number, SliceWalletChainManifest>>
)

export const sliceWalletSupportedChainIds = Object.freeze(
  manifests.filter((manifest) => manifest.admitted).map((manifest) => manifest.chain.id)
)

export const getSliceWalletChainManifest = (chainId: number) => {
  const manifest = sliceWalletChainManifests[chainId]
  if (manifest === undefined || !manifest.admitted) {
    throw new Error(\`Slice Wallet chain \${chainId} is not provisioned.\`)
  }
  return manifest
}

export const getSliceWalletChainPolicy = (chainId: number) => {
  const manifest = sliceWalletChainManifests[chainId]
  if (manifest === undefined) {
    throw new Error(\`Slice Wallet chain \${chainId} is unsupported.\`)
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
      \`Slice Wallet \${authority} authority is not verified on chain \${chainId}.\`
    )
  }
  return manifest
}
`

const formatResult = spawnSync(
  "bunx",
  ["biome", "format", "--stdin-file-path", outputPath],
  {
    cwd: resolve(import.meta.dir, "../../.."),
    encoding: "utf8",
    input: generated
  }
)
if (formatResult.status !== 0) {
  throw new Error(
    `Could not format the generated chain manifest:\n${formatResult.stderr}`
  )
}
const formatted = formatResult.stdout

if (checkOnly) {
  const current = readFileSync(outputPath, "utf8")
  if (current !== formatted) {
    throw new Error(
      "Generated Slice wallet chain manifest is stale. Run bun run generate:chains."
    )
  }
} else {
  writeFileSync(outputPath, formatted)
}
