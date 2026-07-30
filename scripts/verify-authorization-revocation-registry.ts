#!/usr/bin/env bun

import { createPublicClient, getAddress, http, keccak256 } from "viem"
import deployments from "../../contracts/wallet/deployments/addresses.json"

const service = deployments.services.authorizationRevocationRegistry
if (service.chainId !== 8453) {
  throw new Error("The authorization revocation registry must be Base-scoped.")
}
const rpcUrl = process.env.RPC_URL_BASE
if (!rpcUrl) throw new Error("RPC_URL_BASE is required.")

const client = createPublicClient({ transport: http(rpcUrl) })
if ((await client.getChainId()) !== service.chainId) {
  throw new Error(`RPC_URL_BASE did not return chain ${service.chainId}.`)
}
const code = await client.getCode({ address: getAddress(service.address) })
if (!code || code === "0x") {
  throw new Error("Authorization revocation registry is not deployed.")
}
const observedHash = keccak256(code)
if (
  observedHash !== service.expectedRuntimeCodeHash ||
  observedHash !== service.deployedRuntimeCodeHash
) {
  throw new Error(
    `Authorization revocation registry runtime hash is ${observedHash}; expected and recorded ${service.expectedRuntimeCodeHash}.`
  )
}
if (service.verifiedAtBlock === null) {
  throw new Error("Registry deployment metadata has no verified block.")
}
console.log(
  `Verified Slice ID authorization revocation registry on Base at ${service.address}.`
)
