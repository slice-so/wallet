#!/usr/bin/env bun

import { Base64, Hex as OxHex, P256, PublicKey, WebAuthnP256 } from "ox"
import type { Signature } from "ox/Signature"
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
import { base } from "viem/chains"
import { createSliceWalletKernelAccount } from "../src/account"
import { sliceWalletEntryPoint } from "../src/constants"
import type { CreateSliceWalletKernelAccountParameters } from "../src/types/account"

const canaryRecipient =
  "0x0000000000000000000000000000000000008128" satisfies Address
const rpId = "id.slice.so"
const origin = "https://id.slice.so"
const entryPointDepositTarget = 200_000_000_000_000n
const canaryPrivateKey =
  "0x0101010101010101010101010101010101010101010101010101010101010101" as const
const canaryCredentialId =
  "0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5" as const

const rpcUrl = process.env.RPC_URL_BASE
const privateKey = process.env.PRIVATE_KEY
if (rpcUrl === undefined || rpcUrl.length === 0) {
  throw new Error("RPC_URL_BASE is required.")
}
if (privateKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("PRIVATE_KEY must be a 32-byte hex private key.")
}

const broadcaster = privateKeyToAccount(privateKey as Hex)
const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl)
})
const walletClient = createWalletClient({
  account: broadcaster,
  chain: base,
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

const toUint8Array = (source: BufferSource) => {
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.byteLength)
    bytes.set(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    )
    return bytes
  }

  return new Uint8Array(source)
}

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

const encodeDerInteger = (value: bigint) => {
  const normalizedHex =
    value === 0n
      ? "00"
      : value.toString(16).length % 2 === 0
        ? value.toString(16)
        : `0${value.toString(16)}`
  const valueBytes = OxHex.toBytes(`0x${normalizedHex}`)
  const integerBytes =
    valueBytes[0] !== undefined && valueBytes[0] >= 0x80
      ? new Uint8Array([0, ...valueBytes])
      : valueBytes

  return new Uint8Array([0x02, integerBytes.length, ...integerBytes])
}

const encodeDerSignature = ({ r, s }: Pick<Signature, "r" | "s">) => {
  const rBytes = encodeDerInteger(r)
  const sBytes = encodeDerInteger(s)
  return Uint8Array.from([
    0x30,
    rBytes.length + sBytes.length,
    ...rBytes,
    ...sBytes
  ])
}

const publicKey = PublicKey.toHex(
  P256.getPublicKey({ privateKey: canaryPrivateKey }),
  { includePrefix: false }
)
const credentialId = Base64.fromBytes(OxHex.toBytes(canaryCredentialId), {
  pad: false,
  url: true
})
const credential = {
  id: credentialId,
  publicKey
}

const getFn: NonNullable<
  CreateSliceWalletKernelAccountParameters["getFn"]
> = async (options) => {
  const publicKey = options?.publicKey
  if (publicKey?.challenge === undefined) {
    throw new Error("The WebAuthn request is missing a challenge.")
  }

  const challenge = OxHex.fromBytes(toUint8Array(publicKey.challenge))
  const { metadata, payload } = WebAuthnP256.getSignPayload({
    challenge,
    origin,
    rpId: publicKey.rpId ?? rpId,
    userVerification: publicKey.userVerification ?? "required"
  })
  const signature = P256.sign({
    hash: true,
    payload,
    privateKey: canaryPrivateKey
  })
  const rawId = Base64.toBytes(credentialId)

  return {
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
    id: credentialId,
    rawId: toArrayBuffer(rawId),
    response: {
      authenticatorData: toArrayBuffer(
        OxHex.toBytes(metadata.authenticatorData)
      ),
      clientDataJSON: toArrayBuffer(
        new TextEncoder().encode(metadata.clientDataJSON)
      ),
      signature: toArrayBuffer(encodeDerSignature(signature)),
      userHandle: null
    },
    type: "public-key"
  }
}

const account = await createSliceWalletKernelAccount({
  client: publicClient,
  credential,
  getFn,
  rpId
})
const codeBefore = await publicClient.getCode({ address: account.address })
if (codeBefore !== undefined && codeBefore !== "0x") {
  const latestBlock = await publicClient.getBlockNumber()
  const events = await publicClient.getContractEvents({
    abi: entryPoint07Abi,
    address: sliceWalletEntryPoint.address,
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

const existingDeposit = await publicClient.readContract({
  abi: entryPoint07Abi,
  address: sliceWalletEntryPoint.address,
  args: [account.address],
  functionName: "balanceOf"
})
if (existingDeposit < entryPointDepositTarget) {
  const depositHash = await walletClient.writeContract({
    abi: entryPoint07Abi,
    address: sliceWalletEntryPoint.address,
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
const fees = await publicClient.estimateFeesPerGas()
const unsignedUserOperation = {
  callData: await account.encodeCalls([
    { data: "0x", to: canaryRecipient, value: 1n }
  ]),
  callGasLimit: 500_000n,
  factory,
  factoryData,
  maxFeePerGas: fees.maxFeePerGas ?? parseGwei("0.1"),
  maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.01"),
  nonce: await account.getNonce(),
  preVerificationGas: 120_000n,
  sender: account.address,
  signature: "0x",
  verificationGasLimit: 1_500_000n
} satisfies UserOperation<"0.7">
const userOperation = {
  ...unsignedUserOperation,
  signature: await account.signUserOperation({
    ...unsignedUserOperation,
    chainId: base.id
  })
} satisfies UserOperation<"0.7">

const simulation = await publicClient.simulateContract({
  account: broadcaster,
  abi: entryPoint07Abi,
  address: sliceWalletEntryPoint.address,
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
  publicClient.getCode({
    address: account.address,
    blockNumber: receipt.blockNumber
  }),
  publicClient.getBalance({
    address: canaryRecipient,
    blockNumber: receipt.blockNumber
  })
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
