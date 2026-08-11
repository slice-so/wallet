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
import { getAlchemyRpcUrl } from "../../../scripts/lib/alchemyRpc"
import deployments from "../../contracts/wallet/deployments/addresses.json"
import policy from "../config/chains.policy.json"
import { sliceWalletSupportedChainIds } from "../src/chains"
import { installSanitizedScriptFailureHandlers } from "./lib/scriptFailure"

installSanitizedScriptFailureHandlers()

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
const invalidP256CanaryInput = concatHex([
  p256CanaryInput.slice(0, -2) as Hex,
  p256CanaryInput.endsWith("00") ? "0x01" : "0x00"
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
const chainPolicy = policy.chains[chainKey]
if (chainPolicy === undefined) {
  throw new Error(
    `No Slice Wallet security policy exists for ${requestedChainId}.`
  )
}

if (
  !sliceWalletSupportedChainIds.includes(
    requestedChainId as (typeof sliceWalletSupportedChainIds)[number]
  )
) {
  throw new Error(`No verification RPC is configured for ${requestedChainId}.`)
}
const alchemyId = process.env.SLICEGLOBAL_INTERNAL_ALCHEMY_ID
if (alchemyId === undefined || alchemyId.length === 0) {
  throw new Error("SLICEGLOBAL_INTERNAL_ALCHEMY_ID is required.")
}
const rpcUrl = getAlchemyRpcUrl(requestedChainId, alchemyId)

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
for (const [name, contract] of Object.entries(deployments.contracts)) {
  const code = await client.getCode({ address: getAddress(contract.address) })
  const observedHash =
    code === undefined || code === "0x" ? null : keccak256(code)
  observedRuntimeCodeHashes[name] = observedHash
  assert(
    observedHash ===
      deployment.runtimeCodeHashes[
        name as keyof typeof deployment.runtimeCodeHashes
      ],
    `${name} runtime hash is ${observedHash ?? "missing"}; the chain facts record ${deployment.runtimeCodeHashes[name as keyof typeof deployment.runtimeCodeHashes] ?? "missing"}.`
  )
}

assert(
  deployments.contracts.entryPoint.version === "0.7",
  "The admitted EntryPoint version must be 0.7."
)
await client.readContract({
  abi: entryPointNonceAbi,
  address: getAddress(deployments.contracts.entryPoint.address),
  args: [zeroAddress, 0n],
  functionName: "getNonce"
})

const factoryStakerApproved = await client.readContract({
  abi: factoryStakerAbi,
  address: getAddress(deployments.contracts.kernelMetaFactory.address),
  args: [getAddress(deployments.contracts.kernelFactory.address)],
  functionName: "approved"
})
assert(factoryStakerApproved, "Kernel FactoryStaker approval is missing.")
assert(
  deployment.verification.factoryStakerApproved === factoryStakerApproved,
  "FactoryStaker deployment facts do not match live state."
)

const callP256Verifier = async (
  address: Address,
  input: Hex = p256CanaryInput
) => (await client.call({ data: input, to: address })).data

const isSuccessfulP256Result = (result: Hex | undefined) =>
  result === successfulP256Result

const isRejectedP256Result = (result: Hex | undefined) =>
  result === undefined || /^0x0*$/.test(result)

const rip7212Available =
  isSuccessfulP256Result(await callP256Verifier(rip7212Precompile)) &&
  isRejectedP256Result(
    await callP256Verifier(rip7212Precompile, invalidP256CanaryInput)
  )
const daimoVerifierPassed =
  isSuccessfulP256Result(
    await callP256Verifier(
      getAddress(deployments.contracts.p256Verifier.address)
    )
  ) &&
  isRejectedP256Result(
    await callP256Verifier(
      getAddress(deployments.contracts.p256Verifier.address),
      invalidP256CanaryInput
    )
  )
const soladyVerifierPassed =
  isSuccessfulP256Result(
    await callP256Verifier(
      getAddress(deployments.contracts.soladyP256Verifier.address)
    )
  ) &&
  isRejectedP256Result(
    await callP256Verifier(
      getAddress(deployments.contracts.soladyP256Verifier.address),
      invalidP256CanaryInput
    )
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
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({
      hash: userOperationCanary.transactionHash
    }),
    client.getTransaction({
      hash: userOperationCanary.transactionHash
    })
  ])
  assert(receipt.status === "success", "The canary transaction reverted.")
  assert(
    transaction.to?.toLowerCase() ===
      deployments.contracts.entryPoint.address.toLowerCase(),
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
  if (canaryEvent !== undefined) {
    const executionSafety = chainPolicy.executionSafety
    const maximumEnvelopeGas =
      BigInt(executionSafety.maxCallGasLimit) +
      BigInt(executionSafety.maxVerificationGasLimit) +
      BigInt(executionSafety.maxPreVerificationGas) +
      BigInt(executionSafety.maxPaymasterVerificationGasLimit) +
      BigInt(executionSafety.maxPaymasterPostOpGasLimit)
    assert(
      canaryEvent.args.actualGasUsed <= maximumEnvelopeGas,
      "The execution-safety gas envelope is below the admitted canary usage."
    )
    assert(
      canaryEvent.args.actualGasCost <= BigInt(executionSafety.maxPrefundWei),
      "The execution-safety prefund cap is below the admitted canary cost."
    )
  }

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
      deployments.contracts.kernelImplementation.address.toLowerCase(),
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
