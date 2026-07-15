#!/usr/bin/env bun

import {
  type Address,
  concatHex,
  createPublicClient,
  getAddress,
  type Hex,
  http,
  keccak256,
  padHex,
  parseEventLogs,
  zeroAddress
} from "viem"
import deployments from "../../contracts/core/deployments/addresses.json"

const rpcEnvironmentVariables = {
  1: "RPC_URL_MAINNET",
  10: "RPC_URL_OPTIMISM",
  8453: "RPC_URL_BASE",
  42161: "RPC_URL_ARBITRUM"
} as const

const entryPointNonceAbi = [
  {
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" }
    ],
    name: "getNonce",
    outputs: [{ name: "nonce", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  }
] as const

const factoryStakerAbi = [
  {
    inputs: [{ name: "factory", type: "address" }],
    name: "approved",
    outputs: [{ name: "approved", type: "bool" }],
    stateMutability: "view",
    type: "function"
  }
] as const

const userOperationEventAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "userOpHash", type: "bytes32" },
      { indexed: true, name: "sender", type: "address" },
      { indexed: true, name: "paymaster", type: "address" },
      { indexed: false, name: "nonce", type: "uint256" },
      { indexed: false, name: "success", type: "bool" },
      { indexed: false, name: "actualGasCost", type: "uint256" },
      { indexed: false, name: "actualGasUsed", type: "uint256" }
    ],
    name: "UserOperationEvent",
    type: "event"
  }
] as const

const kernelImplementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const
const rip7212Precompile = "0x0000000000000000000000000000000000000100" as const
const successfulP256Result = padHex("0x1", { size: 32 })

// Solady's Wycheproof-derived valid vector. Both fallback verifier contracts and
// the RIP-7212 precompile accept the same raw 160-byte input.
const p256CanaryInput = concatHex([
  "0x532eaabd9574880dbf76b9b8cc00832c20a6ec113d682299550d7a6e0f345e25",
  padHex("0x5", { size: 32 }),
  padHex("0x1", { size: 32 }),
  "0x4a03ef9f92eb268cafa601072489a56380fa0dc43171d7712813b3a19a1eb5e5",
  "0x3e213e28a608ce9a2f4a17fd830c6654018a79b3e0263d91a8ba90622df6f2f0"
])

type UserOperationCanary = {
  accountAddress: Address
  transactionHash: Hex
  userOperationHash: Hex
}

const requestedChainId = Number(process.argv[2] ?? 8453)
if (!Number.isSafeInteger(requestedChainId) || requestedChainId <= 0) {
  throw new Error("Pass a positive integer wallet chain id.")
}

const chainKey = String(requestedChainId) as keyof typeof deployments.chains
const deployment = deployments.chains[chainKey]
if (deployment === undefined || deployment.chainId !== requestedChainId) {
  throw new Error(
    `No Slice Wallet deployment facts exist for ${requestedChainId}.`
  )
}

const rpcEnvironmentVariable =
  rpcEnvironmentVariables[
    requestedChainId as keyof typeof rpcEnvironmentVariables
  ]
if (rpcEnvironmentVariable === undefined) {
  throw new Error(
    `No verification RPC environment variable is configured for ${requestedChainId}.`
  )
}
const rpcUrl = process.env[rpcEnvironmentVariable]
if (rpcUrl === undefined || rpcUrl.length === 0) {
  throw new Error(`${rpcEnvironmentVariable} is required.`)
}

const client = createPublicClient({ transport: http(rpcUrl) })
const failures: string[] = []
const assert = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

const liveChainId = await client.getChainId()
assert(
  liveChainId === requestedChainId,
  `RPC returned chain ${liveChainId}, expected ${requestedChainId}.`
)
const verifiedAtBlock = await client.getBlockNumber()

const observedRuntimeCodeHashes: Record<string, Hex | null> = {}
for (const [name, contract] of Object.entries(deployment.contracts)) {
  const code = await client.getCode({ address: getAddress(contract.address) })
  const observedHash =
    code === undefined || code === "0x" ? null : keccak256(code)
  observedRuntimeCodeHashes[name] = observedHash
  assert(observedHash !== null, `${name} has no runtime code.`)
  assert(
    observedHash === contract.expectedRuntimeCodeHash,
    `${name} runtime hash is ${observedHash ?? "missing"}; expected ${contract.expectedRuntimeCodeHash}.`
  )
  assert(
    contract.deployedRuntimeCodeHash === observedHash,
    `${name} deployment facts do not record the observed runtime hash.`
  )
}

assert(
  deployment.contracts.entryPoint.version === "0.7",
  "The admitted EntryPoint version must be 0.7."
)
await client.readContract({
  abi: entryPointNonceAbi,
  address: getAddress(deployment.contracts.entryPoint.address),
  args: [zeroAddress, 0n],
  functionName: "getNonce"
})

const factoryStakerApproved = await client.readContract({
  abi: factoryStakerAbi,
  address: getAddress(deployment.contracts.kernelMetaFactory.address),
  args: [getAddress(deployment.contracts.kernelFactory.address)],
  functionName: "approved"
})
assert(factoryStakerApproved, "Kernel FactoryStaker approval is missing.")
assert(
  deployment.verification.factoryStakerApproved === factoryStakerApproved,
  "FactoryStaker deployment facts do not match live state."
)

const callP256Verifier = async (address: Address) =>
  (await client.call({ data: p256CanaryInput, to: address })).data ===
  successfulP256Result

const rip7212Available = await callP256Verifier(rip7212Precompile)
const daimoVerifierPassed = await callP256Verifier(
  getAddress(deployment.contracts.p256Verifier.address)
)
const soladyVerifierPassed = await callP256Verifier(
  getAddress(deployment.contracts.soladyP256Verifier.address)
)
const p256CanaryPassed =
  daimoVerifierPassed &&
  soladyVerifierPassed &&
  (!deployment.verification.rip7212Available || rip7212Available)

assert(
  deployment.verification.rip7212Available === rip7212Available,
  "RIP-7212 deployment facts do not match the empirical precompile probe."
)
assert(
  p256CanaryPassed,
  "A required P-256 verification path rejected the canary."
)
assert(
  deployment.verification.p256CanaryPassed === p256CanaryPassed,
  "P-256 canary deployment facts do not match live verification."
)

const userOperationCanary = deployment.verification
  .userOperationCanary as UserOperationCanary | null
assert(
  userOperationCanary !== null,
  "A successful deploy-and-call user operation canary is required."
)

if (userOperationCanary !== null) {
  const receipt = await client.getTransactionReceipt({
    hash: userOperationCanary.transactionHash
  })
  const transaction = await client.getTransaction({
    hash: userOperationCanary.transactionHash
  })
  assert(receipt.status === "success", "The canary transaction reverted.")
  assert(
    transaction.to?.toLowerCase() ===
      deployment.contracts.entryPoint.address.toLowerCase(),
    "The canary transaction was not submitted through the pinned EntryPoint."
  )

  const events = parseEventLogs({
    abi: userOperationEventAbi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
    strict: true
  })
  const canaryEvent = events.find(
    (event) =>
      event.args.userOpHash.toLowerCase() ===
        userOperationCanary.userOperationHash.toLowerCase() &&
      event.args.sender.toLowerCase() ===
        userOperationCanary.accountAddress.toLowerCase()
  )
  assert(canaryEvent !== undefined, "The canary UserOperationEvent is missing.")
  assert(
    canaryEvent?.args.success === true,
    "The canary user operation failed."
  )

  const accountCode = await client.getCode({
    address: userOperationCanary.accountAddress
  })
  assert(
    accountCode !== undefined && accountCode !== "0x",
    "The canary did not deploy its Kernel account."
  )
  const implementationWord = await client.getStorageAt({
    address: userOperationCanary.accountAddress,
    slot: kernelImplementationSlot
  })
  const implementation =
    implementationWord === undefined
      ? null
      : getAddress(`0x${implementationWord.slice(-40)}`)
  assert(
    implementation?.toLowerCase() ===
      deployment.contracts.kernelImplementation.address.toLowerCase(),
    "The canary account does not point at the pinned Kernel implementation."
  )
}

const recordedBlock = deployment.verification.verifiedAtBlock as number | null
assert(
  recordedBlock !== null,
  "verifiedAtBlock must be recorded before admission."
)
assert(
  recordedBlock === null ||
    (Number.isSafeInteger(recordedBlock) &&
      recordedBlock > 0 &&
      BigInt(recordedBlock) <= verifiedAtBlock),
  "verifiedAtBlock is invalid or ahead of the verification RPC."
)
assert(
  (deployment.status as string) === "admitted",
  "The deployment status must be admitted before the SDK exposes this chain."
)

console.log(
  JSON.stringify(
    {
      chainId: requestedChainId,
      observedRuntimeCodeHashes,
      verification: {
        factoryStakerApproved,
        p256CanaryPassed,
        rip7212Available,
        verifiedAtBlock: Number(verifiedAtBlock)
      }
    },
    null,
    2
  )
)

if (failures.length > 0) {
  throw new Error(
    `Slice Wallet chain ${requestedChainId} is not admissible:\n- ${failures.join("\n- ")}`
  )
}

console.log(
  `Slice Wallet chain ${requestedChainId} passed admission verification.`
)
