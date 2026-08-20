#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import deployments from "../../contracts/wallet/deployments/addresses.json"
import policy from "../config/chains.policy.json"
import {
  hasAdmittedManagementAuthority,
  hasCompleteSliceWalletAdmissionEvidence,
  hasVerifiedCheckoutAuthorityDeployment,
  hasVerifiedGenericAuthorityDeployment
} from "./lib/chainAdmission"

const outputPath = resolve(import.meta.dir, "../src/protocol/chains.ts")
const checkOnly = process.argv.includes("--check")

if (deployments.version !== 3 || policy.version !== 1) {
  throw new Error("Unsupported Slice wallet chain input version.")
}

const chainIds = deployments.supportedChainIds
  .map(String)
  .sort((first, second) => Number(first) - Number(second))
const policyChainIds = Object.keys(policy.chains).sort(
  (first, second) => Number(first) - Number(second)
)
if (chainIds.join(",") !== policyChainIds.join(",")) {
  throw new Error(
    "Wallet deployment supportedChainIds and chain policy must match."
  )
}

const entries = chainIds.map((chainId) => {
  const policyChain = policy.chains[chainId as keyof typeof policy.chains]
  const deployment =
    deployments.chains[chainId as keyof typeof deployments.chains]
  if (deployment === undefined || deployment.chainId !== Number(chainId)) {
    throw new Error(`Missing deployment facts for wallet chain ${chainId}.`)
  }

  const admitted = hasCompleteSliceWalletAdmissionEvidence(deployment)
  const genericAuthorityAdmitted =
    hasVerifiedGenericAuthorityDeployment(deployment)
  const checkoutAuthorityAdmitted =
    hasVerifiedCheckoutAuthorityDeployment(deployment)
  const managementAuthorityAdmitted = hasAdmittedManagementAuthority(
    deployment,
    policyChain.managementValidationStorageReadsAllowed
  )

  return {
    admitted,
    authorityAdmission: {
      checkout: checkoutAuthorityAdmitted,
      generic: genericAuthorityAdmitted,
      management: managementAuthorityAdmitted
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
    defaultTransports: policyChain.defaultTransports,
    executionSafety: policyChain.executionSafety,
    funding: policyChain.funding,
    rip7212Available: deployment.verification.rip7212Available,
    runtimeCodeHashes: deployment.runtimeCodeHashes
  }
})

const contractNames = Object.keys(deployments.contracts)
if (contractNames.some((name) => !/^[A-Za-z_$][\w$]*$/.test(name))) {
  throw new Error("Wallet deployment contract names must be identifiers.")
}
const contractEntries = contractNames
  .map(
    (name) => `  ${name}: {
    ...canonicalContracts.${name},
    runtimeCodeHash: runtimeCodeHashes.${name} ?? null
  }`
  )
  .join(",\n")

const generated = `// Auto-generated from contracts deployment facts and wallet chain policy.
// Run: bun run generate:chains

import type { Hex } from "viem"
import type {
  SliceWalletChainManifest,
  SliceWalletContractDeployments
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
  for (const contract of Object.values(manifest.contracts)) {
    Object.freeze(contract)
  }
  Object.freeze(manifest.contracts)
  Object.freeze(manifest.defaultTransports)
  Object.freeze(manifest.funding.sponsoredSecurityOperations)
  Object.freeze(manifest.funding)
  return Object.freeze(manifest)
}

const canonicalContracts = ${JSON.stringify(deployments.contracts, null, 2)} as const
const deployments = ${JSON.stringify(entries, null, 2)} as const

const buildContracts = (
  runtimeCodeHashes: Readonly<Record<keyof typeof canonicalContracts, Hex | null>>
) => ({
${contractEntries}
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
      ([name, contract]) => [
        name,
        {
          ...contract,
          runtimeCodeHash:
            name === "weightedP256Signer" ? null : contract.runtimeCodeHash
        }
      ]
    )
  ) as SliceWalletChainManifest["contracts"],
  defaultTransports: {
    bundlerUrl: "http://127.0.0.1:4337",
    paymasterUrl: "http://127.0.0.1:4338",
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

export const sliceWalletDevelopmentChainIds = Object.freeze(
  [developmentManifest.chain.id]
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
  authority: keyof SliceWalletChainManifest["authorityAdmission"]
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
