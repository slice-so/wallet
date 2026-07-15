#!/usr/bin/env bun

import {
  type Address,
  createPublicClient,
  createWalletClient,
  getAddress,
  type Hex,
  http,
  parseEventLogs,
  parseGwei
} from "viem"
import {
  entryPoint07Abi,
  toPackedUserOperation,
  type UserOperation
} from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { createSliceWalletKernelAccount } from "../src/account"
import { getSliceWalletChainPolicy } from "../src/chains"
import { canaryCredential, canaryGetFn, canaryRpId } from "./lib/canaryWebAuthn"

const canaryRecipient =
  "0x0000000000000000000000000000000000008128" satisfies Address
const minimumEntryPointDeposit = 200_000_000_000_000n
const callGasLimit = 500_000n
const preVerificationGas = 120_000n
const verificationGasLimit = 1_500_000n

const rpcEnvironmentVariables: Readonly<Record<number, string>> = {
  1: "RPC_URL_ETHEREUM",
  10: "RPC_URL_OP",
  8453: "RPC_URL_BASE",
  42161: "RPC_URL_ARBITRUM"
}
const chainId = Number(process.argv[2] ?? 8453)
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error("Pass a positive integer wallet chain id.")
}
const manifest = getSliceWalletChainPolicy(chainId)
const chain = manifest.chain
const rpcEnvironmentVariable = rpcEnvironmentVariables[chainId]
if (rpcEnvironmentVariable === undefined) {
  throw new Error(`No canary RPC is configured for chain ${chainId}.`)
}
const rpcUrl = process.env[rpcEnvironmentVariable]
const privateKey = process.env.PRIVATE_KEY
if (rpcUrl === undefined || rpcUrl.length === 0) {
  throw new Error(`${rpcEnvironmentVariable} is required.`)
}
if (privateKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("PRIVATE_KEY must be a 32-byte hex private key.")
}

const broadcaster = privateKeyToAccount(privateKey as Hex)
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl)
})
const walletClient = createWalletClient({
  account: broadcaster,
  chain,
  transport: http(rpcUrl)
})
let transactionNonce = await publicClient.getTransactionCount({
  address: broadcaster.address,
  blockTag: "pending"
})
const takeTransactionNonce = () => {
  const nonce = transactionNonce
  transactionNonce += 1
  return nonce
}

const account = await createSliceWalletKernelAccount({
  client: publicClient,
  credential: canaryCredential,
  getFn: canaryGetFn,
  rpId: canaryRpId
})
const codeBefore = await publicClient.getCode({ address: account.address })
if (codeBefore !== undefined && codeBefore !== "0x") {
  const latestBlock = await publicClient.getBlockNumber()
  const events = await publicClient.getContractEvents({
    abi: entryPoint07Abi,
    address: manifest.contracts.entryPoint.address,
    args: { sender: account.address },
    eventName: "UserOperationEvent",
    fromBlock: latestBlock > 1_000n ? latestBlock - 1_000n : 0n,
    strict: true,
    toBlock: latestBlock
  })
  const event = events.at(-1)
  const recipientBalance = await publicClient.getBalance({
    address: canaryRecipient
  })
  if (
    event?.args.success !== true ||
    event.transactionHash === null ||
    recipientBalance < 1n
  ) {
    throw new Error(
      "The deployed canary account is missing successful execution evidence."
    )
  }

  console.log(
    JSON.stringify(
      {
        accountAddress: account.address,
        transactionHash: event.transactionHash,
        userOperationHash: event.args.userOpHash
      },
      null,
      2
    )
  )
  process.exit(0)
}

const { factory, factoryData } = await account.getFactoryArgs()
if (factory === undefined || factoryData === undefined) {
  throw new Error("The canary account is missing counterfactual factory data.")
}

const fees = await publicClient.estimateFeesPerGas()
const maxFeePerGas = fees.maxFeePerGas ?? parseGwei("0.1")
const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? parseGwei("0.01")
const calculatedDeposit =
  (callGasLimit + preVerificationGas + verificationGasLimit) * maxFeePerGas * 2n
const entryPointDepositTarget =
  calculatedDeposit > minimumEntryPointDeposit
    ? calculatedDeposit
    : minimumEntryPointDeposit

const existingDeposit = await publicClient.readContract({
  abi: entryPoint07Abi,
  address: manifest.contracts.entryPoint.address,
  args: [account.address],
  functionName: "balanceOf"
})
if (existingDeposit < entryPointDepositTarget) {
  const depositHash = await walletClient.writeContract({
    abi: entryPoint07Abi,
    address: manifest.contracts.entryPoint.address,
    args: [account.address],
    functionName: "depositTo",
    nonce: takeTransactionNonce(),
    value: entryPointDepositTarget - existingDeposit
  })
  await publicClient.waitForTransactionReceipt({ hash: depositHash })
}

const existingAccountBalance = await publicClient.getBalance({
  address: account.address
})
if (existingAccountBalance < 1n) {
  const fundingHash = await walletClient.sendTransaction({
    nonce: takeTransactionNonce(),
    to: account.address,
    value: 1n - existingAccountBalance
  })
  await publicClient.waitForTransactionReceipt({ hash: fundingHash })
}

const recipientBalanceBefore = await publicClient.getBalance({
  address: canaryRecipient
})
const unsignedUserOperation = {
  callData: await account.encodeCalls([
    { data: "0x", to: canaryRecipient, value: 1n }
  ]),
  callGasLimit,
  factory,
  factoryData,
  maxFeePerGas,
  maxPriorityFeePerGas,
  nonce: await account.getNonce(),
  preVerificationGas,
  sender: account.address,
  signature: "0x",
  verificationGasLimit
} satisfies UserOperation<"0.7">
const userOperation = {
  ...unsignedUserOperation,
  signature: await account.signUserOperation({
    ...unsignedUserOperation,
    chainId
  })
} satisfies UserOperation<"0.7">

const simulation = await publicClient.simulateContract({
  account: broadcaster,
  abi: entryPoint07Abi,
  address: manifest.contracts.entryPoint.address,
  args: [[toPackedUserOperation(userOperation)], broadcaster.address],
  functionName: "handleOps",
  gas: 5_000_000n
})
const transactionHash = await walletClient.writeContract({
  ...simulation.request,
  nonce: takeTransactionNonce()
})
const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash
})
if (receipt.status !== "success") {
  throw new Error("The canary handleOps transaction reverted.")
}

const events = parseEventLogs({
  abi: entryPoint07Abi,
  eventName: "UserOperationEvent",
  logs: receipt.logs,
  strict: true
})
const event = events.find(
  (candidate) =>
    getAddress(candidate.args.sender) === getAddress(account.address)
)
if (event === undefined || event.args.success !== true) {
  throw new Error("The canary user operation did not succeed.")
}

const [accountCode, recipientBalanceAfter] = await Promise.all([
  publicClient.getCode({ address: account.address }),
  publicClient.getBalance({ address: canaryRecipient })
])
if (accountCode === undefined || accountCode === "0x") {
  throw new Error("The canary did not deploy its Kernel account.")
}
if (recipientBalanceAfter - recipientBalanceBefore !== 1n) {
  throw new Error("The canary inner call was not executed.")
}

console.log(
  JSON.stringify(
    {
      accountAddress: account.address,
      transactionHash,
      userOperationHash: event.args.userOpHash
    },
    null,
    2
  )
)
