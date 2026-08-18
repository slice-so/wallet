#!/usr/bin/env bun

import {
  buildRecoveryPermissionInitConfig,
  predictSliceWalletKernelAccountAddress
} from "@slicekit/wallet-primitives"
import {
  kernelFactoryAbi,
  kernelModuleType
} from "@slicekit/wallet-primitives/kernel"
import {
  type Address,
  concatHex,
  createPublicClient,
  getAddress,
  type Hex,
  http,
  isAddressEqual,
  keccak256,
  padHex,
  zeroAddress
} from "viem"
import { getAlchemyRpcUrl } from "../../../scripts/lib/alchemyRpc"
import deployments from "../../contracts/wallet/deployments/addresses.json"
import policy from "../../wallet-primitives/config/chains.policy.json"
import { encodeSliceWalletRootValidatorData } from "../src/rootValidator"
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
  !deployments.supportedChainIds.includes(
    requestedChainId as (typeof deployments.supportedChainIds)[number]
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
  deployments.contracts.entryPoint.version === "0.9",
  "The admitted EntryPoint version must be 0.9."
)
await client.readContract({
  abi: entryPointNonceAbi,
  address: getAddress(deployments.contracts.entryPoint.address),
  args: [zeroAddress, 0n],
  functionName: "getNonce"
})

const predictionCredential = {
  credentialIdHash:
    "0x0102030400000000000000000000000000000000000000000000000000000000" as const,
  publicKey: `0x04${"01".repeat(32)}${"02".repeat(32)}` as const
}
const predictionRecoverySigner =
  "0x1111111111111111111111111111111111111111" as const
const predictionNonce = 0n
const predictionRecovery = await buildRecoveryPermissionInitConfig({
  recoverySignerAddress: predictionRecoverySigner
})
const predictionPackages = [
  {
    internalData: "0x" as const,
    module: getAddress(deployments.contracts.webAuthnRootValidator.address),
    moduleData: encodeSliceWalletRootValidatorData(predictionCredential),
    moduleType: kernelModuleType.validator
  },
  ...predictionRecovery.initConfig
]
const predictedAccount = await predictSliceWalletKernelAccountAddress({
  chainId: requestedChainId,
  credential: predictionCredential,
  index: predictionNonce,
  recoverySignerAddress: predictionRecoverySigner
})
if (observedRuntimeCodeHashes.kernelFactory !== null) {
  const factoryAccount = await client.readContract({
    abi: kernelFactoryAbi,
    address: getAddress(deployments.contracts.kernelFactory.address),
    args: [predictionPackages, predictionNonce],
    functionName: "getAddress"
  })
  assert(
    isAddressEqual(factoryAccount, predictedAccount),
    `KernelFactory predicted ${factoryAccount}, but the SDK predicted ${predictedAccount}.`
  )
}

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
        kernelReleaseCommit: deployment.verification.kernelReleaseCommit,
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
