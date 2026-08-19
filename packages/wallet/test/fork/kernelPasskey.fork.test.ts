import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import type { AddProductParams } from "@slicekit/abi"
import { productsModuleAbi, sliceCoreAbi, slicerAbi } from "@slicekit/abi"
import {
  getProductsModuleAddress,
  getSliceCoreAddress
} from "@slicekit/abi/deployments"
import {
  encodeCurrencyPriceBooleans,
  encodeProductBooleans,
  maskToHex,
  rolesToMask,
  USER_ROLE
} from "@slicekit/commerce"
import {
  buildDeviceInstallCalls,
  buildDevicePromotionCalls,
  buildDeviceUninstallCalls,
  buildRecoveryCancelCall,
  buildRecoveryPermissionInitConfig,
  buildRecoveryProposalUserOperation,
  buildRecoveryRotationCalls,
  buildRecoveryUserOperation,
  buildSliceWalletPermissionEnableTypedData,
  buildSliceWalletPermissionInstallCalls,
  createDeployedRecoveryPermissionAccount,
  createSliceWalletDeviceKernelAccount,
  createSliceWalletDeviceValidator,
  createSliceWalletPermissionAccount,
  createSliceWalletRegisteredKernelAccount,
  depositRecoveryEntryPoint,
  deriveSliceWalletRecoveryBootstrap,
  encodeSliceWalletSyntheticWebAuthnSignature,
  formatSliceWalletExistingCredentialAuthorization,
  generateSliceWalletP256KeyPair,
  getRecoveryState,
  getSliceWalletCredentialIdHash,
  getSliceWalletRootValidatorPublicKey,
  parseSliceWalletUncompressedPublicKey,
  predictSliceWalletKernelAccountAddress,
  type RecoveryUserOperationGas,
  type SliceWalletSignerFrameClient,
  signSliceWalletP256,
  submitRecoveryHandleOps,
  toSliceWalletDeviceSigner
} from "@slicekit/wallet"
import {
  buildSliceExecutionEnableTypedData,
  buildStoreManagementPermissionUninstallCalls,
  createSliceExecutionAccount,
  createSliceKernelPasskeyAccount,
  encodeWebAuthnValidatorSignature
} from "@slicekit/wallet/execution"
import {
  sliceKernelBaseV33Addresses,
  sliceKernelBaseV33Config,
  sliceKernelSlicerRegistryPolicyAddress,
  sliceKernelTimelockPolicyAddress,
  sliceKernelWebAuthnValidatorAddress,
  sliceKernelWeightedEcdsaSignerAddress,
  sliceKernelWeightedP256SignerAddress
} from "@slicekit/wallet-primitives/execution"
import {
  buildSliceWalletPermissionRevocationCalls,
  createErc20ApproveCallRule,
  getSliceWalletChainPolicy,
  getWalletPermissionId,
  getWalletPermissionValidAfter,
  hashSliceWalletCoSignRequest,
  hashSliceWalletWeightedP256CoSign,
  hashSliceWalletWeightedP256Proposal,
  type SliceWalletFrameSession,
  sliceWalletKernelVersion,
  verifySliceWalletP256
} from "@slicekit/wallet-primitives/server"
import { Base64, Hex, P256, PublicKey, WebAuthnP256 } from "ox"
import type { Signature } from "ox/Signature"
import {
  type Address,
  BaseError,
  bytesToHex,
  concat,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  hashMessage,
  hashTypedData,
  http,
  isAddressEqual,
  keccak256,
  pad,
  parseAbiParameters,
  parseEther,
  parseEventLogs,
  parseGwei,
  recoverAddress,
  sha256,
  slice,
  toBytes,
  type Hex as ViemHex,
  zeroAddress
} from "viem"
import {
  createBundlerClient,
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  type ToWebAuthnAccountParameters,
  toPackedUserOperation,
  toWebAuthnAccount,
  type UserOperation
} from "viem/account-abstraction"
import {
  generatePrivateKey,
  privateKeyToAccount,
  toAccount
} from "viem/accounts"
import { base } from "viem/chains"

const forkRpcUrl = process.env.KERNEL_PASSKEY_FORK_RPC_URL
const forkSubmitterPrivateKey =
  process.env.KERNEL_PASSKEY_FORK_SUBMITTER_PRIVATE_KEY
if (forkRpcUrl && !/^0x[0-9a-fA-F]{64}$/.test(forkSubmitterPrivateKey ?? "")) {
  throw new Error(
    "KERNEL_PASSKEY_FORK_SUBMITTER_PRIVATE_KEY must be a 32-byte hex private key."
  )
}
const erc6492MagicBytes =
  "0x6492649264926492649264926492649264926492649264926492649264926492" as const
const runForkTests = forkRpcUrl ? describe : describe.skip
const rpcUrl = forkRpcUrl ?? "http://127.0.0.1:8547"
const rpId = "localhost"
const origin = "http://localhost"
const credentialId = Base64.fromBytes(
  Hex.toBytes("0x0102030405060708090a0b0c0d0e0f10"),
  { pad: false, url: true }
)
const secondCredentialId = Base64.fromBytes(
  Hex.toBytes("0x1112131415161718191a1b1c1d1e1f20"),
  { pad: false, url: true }
)
const passkeyPrivateKey =
  "0x0101010101010101010101010101010101010101010101010101010101010101" satisfies ViemHex
const secondPasskeyPrivateKey =
  "0x0202020202020202020202020202020202020202020202020202020202020202" satisfies ViemHex
const recoveryNewPasskeyPrivateKey =
  "0x0707070707070707070707070707070707070707070707070707070707070707" satisfies ViemHex
const bundlerAccount = privateKeyToAccount(
  forkSubmitterPrivateKey
    ? (forkSubmitterPrivateKey as ViemHex)
    : generatePrivateKey()
)
const recoverySignerPrivateKey =
  "0x0808080808080808080808080808080808080808080808080808080808080808" satisfies ViemHex
const recoverySignerAccount = privateKeyToAccount(recoverySignerPrivateKey)
const executionCoSignerAccount = privateKeyToAccount(
  "0x0505050505050505050505050505050505050505050505050505050505050505"
)
const wrongExecutionCoSignerAccount = privateKeyToAccount(
  "0x0606060606060606060606060606060606060606060606060606060606060606"
)
const managementMerchantAccount = privateKeyToAccount(generatePrivateKey())
const offlinePredictionVector = {
  account: "0x614d09f18A013734E56584F157E48c6508d6Db5d" as const,
  credential: {
    credentialIdHash:
      "0x0102030400000000000000000000000000000000000000000000000000000000" as const,
    publicKey:
      "0x04000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000001c8" as const
  },
  recoverySignerAddress: "0x0000000000000000000000000000000000000001" as const
}

const timelockPolicyConfigAbi = [
  {
    inputs: [
      { name: "", type: "bytes32" },
      { name: "", type: "address" }
    ],
    name: "timelockConfig",
    outputs: [
      { name: "delay", type: "uint48" },
      { name: "expirationPeriod", type: "uint48" },
      { name: "guardian", type: "address" },
      { name: "initialized", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const
const create2Deployer =
  "0x4e59b44847b379578588920cA78FbF26c0B4956C" satisfies Address
const p256Precompile =
  "0x0000000000000000000000000000000000000100" satisfies Address
const soladyP256Verifier =
  "0x000000000000D01eA45F9eFD5c54f037Fa57Ea1a" satisfies Address
const weightedEcdsaSignerSalt = keccak256(
  toBytes("slice.kernel.weighted-ecdsa-signer.v1")
)
const weightedP256SignerSalt = keccak256(
  toBytes("slice.kernel.weighted-p256-signer.v1")
)
const timelockPolicySalt = keccak256(toBytes("slice.kernel.timelock-policy.v1"))
const slicerRegistryPolicySalt = keccak256(
  toBytes("slice.kernel.slicer-registry-policy.v1")
)
const recipient = "0x0000000000000000000000000000000000008128" satisfies Address
const ecdsaSignatureByteLength = 65
const ecdsaSignatureHexLength = ecdsaSignatureByteLength * 2
const entryPointFailedOpSelectors = ["0x220266b6", "0x65c8fd4d"] as const
const erc1271Abi = [
  {
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" }
    ],
    name: "isValidSignature",
    outputs: [{ name: "magicValue", type: "bytes4" }],
    stateMutability: "view",
    type: "function"
  }
] as const

type WebAuthnGetFn = NonNullable<ToWebAuthnAccountParameters["getFn"]>
type WebAuthnPublicKeyOptions = NonNullable<
  NonNullable<Parameters<WebAuthnGetFn>[0]>["publicKey"]
>
type WebAuthnChallengeBuffer = WebAuthnPublicKeyOptions["challenge"]
type WeightedEcdsaSignerArtifact = {
  bytecode: {
    object: ViemHex
  }
}
type WeightedP256SignerArtifact = WeightedEcdsaSignerArtifact
type TimelockPolicyArtifact = WeightedEcdsaSignerArtifact
type SlicerRegistryPolicyArtifact = WeightedEcdsaSignerArtifact

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const bufferSourceToBytes = (source: WebAuthnChallengeBuffer) => {
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.byteLength)
    bytes.set(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    )
    return bytes
  }

  return new Uint8Array(source)
}

const textEncoder = new TextEncoder()

const encodeDerInteger = (value: bigint) => {
  const normalizedHex =
    value === 0n
      ? "00"
      : value.toString(16).length % 2 === 0
        ? value.toString(16)
        : `0${value.toString(16)}`
  const valueBytes = Hex.toBytes(`0x${normalizedHex}`)
  const integerBytes =
    valueBytes[0] !== undefined && valueBytes[0] >= 0x80
      ? new Uint8Array([0, ...valueBytes])
      : valueBytes

  return new Uint8Array([0x02, integerBytes.length, ...integerBytes])
}

const encodeDerSignature = ({ r, s }: Pick<Signature, "r" | "s">) => {
  const rBytes = encodeDerInteger(r)
  const sBytes = encodeDerInteger(s)
  return new Uint8Array([
    0x30,
    rBytes.length + sBytes.length,
    ...rBytes,
    ...sBytes
  ])
}

const createSyntheticWebAuthnGetFn =
  (privateKey: ViemHex): WebAuthnGetFn =>
  async (options) => {
    const publicKey = options?.publicKey
    if (publicKey === undefined) {
      throw new Error("Missing WebAuthn public key options.")
    }

    const challengeBuffer = publicKey.challenge
    if (challengeBuffer === undefined) {
      throw new Error("Missing WebAuthn challenge.")
    }

    const challenge = Hex.fromBytes(bufferSourceToBytes(challengeBuffer))
    const userVerification = publicKey.userVerification ?? "required"
    const { metadata, payload } = WebAuthnP256.getSignPayload({
      challenge,
      origin,
      rpId: publicKey.rpId ?? rpId,
      userVerification
    })
    const signature = P256.sign({
      hash: true,
      payload,
      privateKey
    })
    const rawId = Base64.toBytes(credentialId)
    const credential = {
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      id: credentialId,
      rawId: toArrayBuffer(rawId),
      response: {
        authenticatorData: toArrayBuffer(
          Hex.toBytes(metadata.authenticatorData)
        ),
        clientDataJSON: toArrayBuffer(
          textEncoder.encode(metadata.clientDataJSON)
        ),
        signature: toArrayBuffer(encodeDerSignature(signature))
      },
      type: "public-key"
    }

    return credential
  }

const createForkTestClient = () =>
  createTestClient({
    chain: base,
    mode: "anvil",
    transport: http(rpcUrl)
  })

const createForkPublicClient = () =>
  createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  })

const createForkWalletClient = () =>
  createWalletClient({
    account: bundlerAccount,
    chain: base,
    transport: http(rpcUrl)
  })

const weightedEcdsaSignerArtifactUrl = new URL(
  "../../../../contracts/wallet/out/WeightedECDSASigner.sol/WeightedECDSASigner.json",
  import.meta.url
)
const weightedP256SignerArtifactUrl = new URL(
  "../../../../contracts/wallet/out/WeightedP256Signer.sol/WeightedP256Signer.json",
  import.meta.url
)
const timelockPolicyArtifactUrl = new URL(
  "../../../../contracts/wallet/out/TimelockPolicy.sol/TimelockPolicy.json",
  import.meta.url
)
const slicerRegistryPolicyArtifactUrl = new URL(
  "../../../../contracts/wallet/out/SlicerRegistryPolicy.sol/SlicerRegistryPolicy.json",
  import.meta.url
)

const getWeightedEcdsaSignerArtifact = () =>
  JSON.parse(
    readFileSync(weightedEcdsaSignerArtifactUrl, "utf8")
  ) as WeightedEcdsaSignerArtifact

const getWeightedEcdsaSignerCreationBytecode = () => {
  const artifact = getWeightedEcdsaSignerArtifact()
  const bytecode = artifact.bytecode.object

  if (!bytecode.startsWith("0x") || bytecode === "0x") {
    throw new Error("WeightedECDSASigner creation bytecode is missing.")
  }

  return bytecode
}

const getWeightedP256SignerCreationBytecode = () => {
  const artifact = JSON.parse(
    readFileSync(weightedP256SignerArtifactUrl, "utf8")
  ) as WeightedP256SignerArtifact
  if (
    !artifact.bytecode.object.startsWith("0x") ||
    artifact.bytecode.object === "0x"
  ) {
    throw new Error("WeightedP256Signer creation bytecode is missing.")
  }
  return artifact.bytecode.object
}

const getTimelockPolicyArtifact = () =>
  JSON.parse(
    readFileSync(timelockPolicyArtifactUrl, "utf8")
  ) as TimelockPolicyArtifact

const getTimelockPolicyCreationBytecode = () => {
  const artifact = getTimelockPolicyArtifact()
  const bytecode = artifact.bytecode.object

  if (!bytecode.startsWith("0x") || bytecode === "0x") {
    throw new Error("TimelockPolicy creation bytecode is missing.")
  }

  return bytecode
}

const getSlicerRegistryPolicyCreationBytecode = () => {
  const artifact = JSON.parse(
    readFileSync(slicerRegistryPolicyArtifactUrl, "utf8")
  ) as SlicerRegistryPolicyArtifact
  if (
    !artifact.bytecode.object.startsWith("0x") ||
    artifact.bytecode.object === "0x"
  ) {
    throw new Error("SlicerRegistryPolicy creation bytecode is missing.")
  }
  return artifact.bytecode.object
}

const installWeightedEcdsaSignerCode = async () => {
  const publicClient = createForkPublicClient()
  const walletClient = createForkWalletClient()
  const existingCode = await publicClient.getCode({
    address: sliceKernelWeightedEcdsaSignerAddress
  })
  if (existingCode !== undefined && existingCode !== "0x") return

  const deployHash = await walletClient.sendTransaction({
    data: concat([
      weightedEcdsaSignerSalt,
      getWeightedEcdsaSignerCreationBytecode()
    ]),
    to: create2Deployer
  })
  await publicClient.waitForTransactionReceipt({ hash: deployHash })

  const installedCode = await publicClient.getCode({
    address: sliceKernelWeightedEcdsaSignerAddress
  })
  expect(installedCode).toStartWith("0x")
  expect(installedCode).not.toBe("0x")
}

const installWeightedP256SignerCode = async () => {
  const publicClient = createForkPublicClient()
  const walletClient = createForkWalletClient()
  const existingCode = await publicClient.getCode({
    address: sliceKernelWeightedP256SignerAddress
  })
  if (existingCode !== undefined && existingCode !== "0x") return

  const deployHash = await walletClient.sendTransaction({
    data: concat([
      weightedP256SignerSalt,
      getWeightedP256SignerCreationBytecode()
    ]),
    to: create2Deployer
  })
  await publicClient.waitForTransactionReceipt({ hash: deployHash })
  expect(
    await publicClient.getCode({
      address: sliceKernelWeightedP256SignerAddress
    })
  ).not.toBe("0x")
}

const installP256PrecompileFallback = async () => {
  const publicClient = createForkPublicClient()
  const currentCode = await publicClient.getCode({ address: p256Precompile })
  if (currentCode !== undefined && currentCode !== "0x") return

  const verifierCode = await publicClient.getCode({
    address: soladyP256Verifier
  })
  if (verifierCode === undefined || verifierCode === "0x") {
    throw new Error("Base P-256 verifier bytecode is unavailable on the fork.")
  }

  // Anvil does not import Base's chain-specific RIP-7212 precompile. Running
  // Base's deployed fallback verifier at 0x100 gives the fork the same raw-call
  // interface and cryptographic behavior as the production precompile.
  await createForkTestClient().setCode({
    address: p256Precompile,
    bytecode: verifierCode
  })
}

const expectBaseP256Signature = async ({
  digest,
  publicKey,
  signature
}: {
  digest: ViemHex
  publicKey: ViemHex
  signature: ViemHex
}) => {
  const result = await createForkPublicClient().call({
    data: concat([
      digest,
      signature,
      slice(publicKey, 1, 33),
      slice(publicKey, 33, 65)
    ]),
    to: p256Precompile
  })
  expect(result.data).toBe(pad("0x01", { size: 32 }))
}

const installTimelockPolicyCode = async () => {
  const publicClient = createForkPublicClient()
  const walletClient = createForkWalletClient()
  const existingCode = await publicClient.getCode({
    address: sliceKernelTimelockPolicyAddress
  })
  if (existingCode !== undefined && existingCode !== "0x") return

  const deployHash = await walletClient.sendTransaction({
    data: concat([timelockPolicySalt, getTimelockPolicyCreationBytecode()]),
    to: create2Deployer
  })
  await publicClient.waitForTransactionReceipt({ hash: deployHash })

  const installedCode = await publicClient.getCode({
    address: sliceKernelTimelockPolicyAddress
  })
  expect(installedCode).toStartWith("0x")
  expect(installedCode).not.toBe("0x")
}

const installSlicerRegistryPolicyCode = async () => {
  const publicClient = createForkPublicClient()
  const walletClient = createForkWalletClient()
  const existingCode = await publicClient.getCode({
    address: sliceKernelSlicerRegistryPolicyAddress
  })
  if (existingCode !== undefined && existingCode !== "0x") return

  const deployHash = await walletClient.sendTransaction({
    data: concat([
      slicerRegistryPolicySalt,
      getSlicerRegistryPolicyCreationBytecode()
    ]),
    to: create2Deployer
  })
  await publicClient.waitForTransactionReceipt({ hash: deployHash })

  expect(
    await publicClient.getCode({
      address: sliceKernelSlicerRegistryPolicyAddress
    })
  ).not.toBe("0x")
}

const getPasskeyPublicKey = (privateKey: ViemHex) =>
  PublicKey.toHex(P256.getPublicKey({ privateKey }), { includePrefix: false })

const createForkKernelAccount = async ({
  address,
  id = credentialId,
  privateKey = passkeyPrivateKey
}: {
  address?: Address
  id?: string
  privateKey?: ViemHex
} = {}) =>
  createSliceKernelPasskeyAccount({
    ...(address === undefined ? {} : { address }),
    client: createForkPublicClient(),
    credential: {
      id,
      publicKey: getPasskeyPublicKey(privateKey)
    },
    getFn: createSyntheticWebAuthnGetFn(privateKey),
    rpId
  })

const recoveryGas = {
  callGasLimit: 800_000n,
  verificationGasLimit: 2_500_000n,
  preVerificationGas: 160_000n,
  maxFeePerGas: parseGwei("1"),
  maxPriorityFeePerGas: parseGwei("0.1")
} satisfies RecoveryUserOperationGas

runForkTests("Kernel passkey Base fork", () => {
  it("matches the EntryPoint-derived offline prediction vector", async () => {
    await installTimelockPolicyCode()
    const client = createForkPublicClient()
    const recovery = await buildRecoveryPermissionInitConfig({
      client,
      recoverySignerAddress: offlinePredictionVector.recoverySignerAddress
    })
    const entryPointDerived = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client,
      credential: offlinePredictionVector.credential,
      initConfig: recovery.initConfig
    })

    expect(entryPointDerived.address).toBe(offlinePredictionVector.account)
    expect(
      await predictSliceWalletKernelAccountAddress({
        chainId: base.id,
        credential: offlinePredictionVector.credential,
        recoverySignerAddress: offlinePredictionVector.recoverySignerAddress
      })
    ).toBe(offlinePredictionVector.account)
  })

  it("derives a stable counterfactual address for a fixed P-256 credential", async () => {
    const firstAccount = await createForkKernelAccount()
    const secondAccount = await createForkKernelAccount()
    const { factory, factoryData } = await firstAccount.getFactoryArgs()

    expect(firstAccount.address).toBe(secondAccount.address)
    expect(factory).toBe(sliceKernelBaseV33Addresses.metaFactory)
    expect(factoryData).toStartWith("0x")
    expect(sliceKernelBaseV33Config.addresses).toEqual(
      sliceKernelBaseV33Addresses
    )
    expect(sliceKernelWebAuthnValidatorAddress).toBe(
      "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69"
    )
  })

  it("reconstructs the same counterfactual account from registry metadata", async () => {
    const passkeyAccount = await createForkKernelAccount()
    const registeredAccount = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client: createForkPublicClient(),
      credential: {
        credentialIdHash: getSliceWalletCredentialIdHash(credentialId),
        publicKey: PublicKey.toHex(
          P256.getPublicKey({
            privateKey: passkeyPrivateKey
          })
        )
      }
    })
    const [passkeyFactoryArgs, registeredFactoryArgs] = await Promise.all([
      passkeyAccount.getFactoryArgs(),
      registeredAccount.getFactoryArgs()
    ])

    expect(registeredAccount.address).toBe(passkeyAccount.address)
    expect(registeredFactoryArgs).toEqual(passkeyFactoryArgs)
  })

  it("deploys the counterfactual account and executes a call through EntryPoint 0.7", async () => {
    const publicClient = createForkPublicClient()
    const walletClient = createForkWalletClient()
    const account = await createForkKernelAccount()
    const { factory, factoryData } = await account.getFactoryArgs()
    const recipientBalanceBefore = await publicClient.getBalance({
      address: recipient
    })
    const depositHash = await walletClient.writeContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      functionName: "depositTo",
      args: [account.address],
      value: parseEther("0.05")
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    const fundHash = await walletClient.sendTransaction({
      to: account.address,
      value: parseEther("0.01")
    })
    await publicClient.waitForTransactionReceipt({ hash: fundHash })
    const fees = await publicClient.estimateFeesPerGas()
    const userOperationBase = {
      sender: account.address,
      nonce: await account.getNonce(),
      factory,
      factoryData,
      callData: await account.encodeCalls([
        { to: recipient, value: 1n, data: "0x" }
      ]),
      callGasLimit: 500_000n,
      verificationGasLimit: 1_500_000n,
      preVerificationGas: 120_000n,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      signature: "0x"
    } satisfies UserOperation<"0.7">
    const signature = await account.signUserOperation({
      ...userOperationBase,
      chainId: base.id
    })
    const userOperation = {
      ...userOperationBase,
      signature
    } satisfies UserOperation<"0.7">
    const handleOpsHash = await walletClient.writeContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      functionName: "handleOps",
      args: [[toPackedUserOperation(userOperation)], bundlerAccount.address],
      gas: 5_000_000n
    })
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: handleOpsHash
    })
    const accountCode = await publicClient.getCode({ address: account.address })
    const recipientBalanceAfter = await publicClient.getBalance({
      address: recipient
    })

    expect(receipt.status).toBe("success")
    expect(accountCode).toStartWith("0x")
    expect(accountCode).not.toBe("0x")
    expect(recipientBalanceAfter - recipientBalanceBefore).toBe(1n)
  })

  it("verifies an undeployed passkey account signature through ERC-6492", async () => {
    const publicClient = createForkPublicClient()
    const account = await createForkKernelAccount({
      id: secondCredentialId,
      privateKey: secondPasskeyPrivateKey
    })
    const message = "Slice wallet delegation grant"
    const signature = await account.signMessage({ message })
    expect(signature.endsWith(erc6492MagicBytes.slice(2))).toBe(true)

    await expect(
      publicClient.verifyMessage({
        address: account.address,
        message,
        signature
      })
    ).resolves.toBe(true)
  })
})

runForkTests("Root-equivalent device Base fork", () => {
  it("rejects device enable mode and proves the SudoPolicy lifecycle", async () => {
    const publicClient = createForkPublicClient()
    const walletClient = createForkWalletClient()
    const rootPrivateKey =
      "0x1212121212121212121212121212121212121212121212121212121212121212" satisfies ViemHex
    const devicePrivateKey =
      "0x1313131313131313131313131313131313131313131313131313131313131313" satisfies ViemHex
    const promotedRootPrivateKey =
      "0x1414141414141414141414141414141414141414141414141414141414141414" satisfies ViemHex
    const removableDevicePrivateKey =
      "0x1515151515151515151515151515151515151515151515151515151515151515" satisfies ViemHex
    const rootCredential = {
      id: Base64.fromBytes(Hex.toBytes("0x5152535455565758595a5b5c5d5e5f60"), {
        pad: false,
        url: true
      }),
      publicKey: getPasskeyPublicKey(rootPrivateKey)
    }
    const deviceCredential = {
      id: Base64.fromBytes(Hex.toBytes("0x6162636465666768696a6b6c6d6e6f70"), {
        pad: false,
        url: true
      }),
      publicKey: getPasskeyPublicKey(devicePrivateKey)
    }
    const registeredRootCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(rootCredential.id),
      publicKey: concat(["0x04", rootCredential.publicKey])
    }
    const registeredDeviceCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(deviceCredential.id),
      publicKey: concat(["0x04", deviceCredential.publicKey])
    }
    const removableDeviceCredential = {
      id: Base64.fromBytes(Hex.toBytes("0x8182838485868788898a8b8c8d8e8f90"), {
        pad: false,
        url: true
      }),
      publicKey: getPasskeyPublicKey(removableDevicePrivateKey)
    }
    const registeredRemovableDeviceCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(
        removableDeviceCredential.id
      ),
      publicKey: concat(["0x04", removableDeviceCredential.publicKey])
    }
    const promotedRootCredentialId = Base64.fromBytes(
      Hex.toBytes("0x7172737475767778797a7b7c7d7e7f80"),
      { pad: false, url: true }
    )
    const promotedRootCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(
        promotedRootCredentialId
      ),
      publicKey: concat(["0x04", getPasskeyPublicKey(promotedRootPrivateKey)])
    }
    const rootAccount = await createSliceKernelPasskeyAccount({
      client: publicClient,
      credential: rootCredential,
      getFn: createSyntheticWebAuthnGetFn(rootPrivateKey),
      rpId
    })
    const deviceWebAuthnAccount = toWebAuthnAccount({
      credential: deviceCredential,
      getFn: createSyntheticWebAuthnGetFn(devicePrivateKey),
      rpId
    })
    const deviceLocalAccount = toAccount({
      address: zeroAddress,
      signMessage: async ({ message }) => {
        const challenge =
          typeof message === "string"
            ? hashMessage(message)
            : typeof message.raw === "string"
              ? message.raw
              : bytesToHex(message.raw)
        return encodeWebAuthnValidatorSignature(
          await deviceWebAuthnAccount.sign({ hash: challenge })
        )
      },
      signTransaction: async () => {
        throw new Error("Device permissions cannot sign transactions.")
      },
      signTypedData: async (typedData) =>
        encodeWebAuthnValidatorSignature(
          await deviceWebAuthnAccount.sign({ hash: hashTypedData(typedData) })
        )
    })
    const deviceSigner = toSliceWalletDeviceSigner({
      account: deviceLocalAccount,
      credential: registeredDeviceCredential
    })
    const deviceAccount = await createSliceWalletDeviceKernelAccount({
      account: rootAccount.address,
      accountIndex: 0n,
      chainId: base.id,
      client: publicClient,
      credential: registeredDeviceCredential,
      rootCredential: registeredRootCredential,
      signer: deviceSigner
    })
    const deviceValidator = await createSliceWalletDeviceValidator({
      chainId: base.id,
      client: publicClient,
      credential: registeredDeviceCredential,
      signer: deviceSigner
    })
    const removableDeviceWebAuthnAccount = toWebAuthnAccount({
      credential: removableDeviceCredential,
      getFn: createSyntheticWebAuthnGetFn(removableDevicePrivateKey),
      rpId
    })
    const removableDeviceLocalAccount = toAccount({
      address: zeroAddress,
      signMessage: async ({ message }) => {
        const challenge =
          typeof message === "string"
            ? hashMessage(message)
            : typeof message.raw === "string"
              ? message.raw
              : bytesToHex(message.raw)
        return encodeWebAuthnValidatorSignature(
          await removableDeviceWebAuthnAccount.sign({ hash: challenge })
        )
      },
      signTransaction: async () => {
        throw new Error("Device permissions cannot sign transactions.")
      },
      signTypedData: async (typedData) =>
        encodeWebAuthnValidatorSignature(
          await removableDeviceWebAuthnAccount.sign({
            hash: hashTypedData(typedData)
          })
        )
    })
    const removableDeviceSigner = toSliceWalletDeviceSigner({
      account: removableDeviceLocalAccount,
      credential: registeredRemovableDeviceCredential
    })
    const removableDeviceAccount = await createSliceWalletDeviceKernelAccount({
      account: rootAccount.address,
      accountIndex: 0n,
      chainId: base.id,
      client: publicClient,
      credential: registeredRemovableDeviceCredential,
      rootCredential: registeredRootCredential,
      signer: removableDeviceSigner
    })
    const depositHash = await walletClient.writeContract({
      abi: entryPoint07Abi,
      address: entryPoint07Address,
      args: [rootAccount.address],
      functionName: "depositTo",
      value: parseEther("0.08")
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    const fees = await publicClient.estimateFeesPerGas()

    const buildUserOperation = async ({
      account,
      calls,
      includeFactory
    }: {
      account: Awaited<ReturnType<typeof createSliceWalletDeviceKernelAccount>>
      calls: Parameters<typeof account.encodeCalls>[0]
      includeFactory: boolean
    }) => {
      const factoryArgs = includeFactory ? await account.getFactoryArgs() : {}
      const unsigned = {
        callData: await account.encodeCalls(calls),
        callGasLimit: 2_000_000n,
        ...factoryArgs,
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
        nonce: await account.getNonce(),
        preVerificationGas: 250_000n,
        sender: account.address,
        signature: "0x" as ViemHex,
        verificationGasLimit: includeFactory ? 4_000_000n : 2_000_000n
      } satisfies UserOperation<"0.7">
      return {
        ...unsigned,
        signature: await account.signUserOperation({
          ...unsigned,
          chainId: base.id
        })
      } satisfies UserOperation<"0.7">
    }
    const submit = async (userOperation: UserOperation<"0.7">) => {
      const hash = await walletClient.writeContract({
        abi: entryPoint07Abi,
        address: entryPoint07Address,
        args: [[toPackedUserOperation(userOperation)], bundlerAccount.address],
        functionName: "handleOps",
        gas: 10_000_000n
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const userOperationHash = getUserOperationHash({
        chainId: base.id,
        entryPointAddress: entryPoint07Address,
        entryPointVersion: "0.7",
        userOperation
      })
      const event = parseEventLogs({
        abi: entryPoint07Abi,
        eventName: "UserOperationEvent",
        logs: receipt.logs
      }).find((candidate) => candidate.args.userOpHash === userOperationHash)
      if (event === undefined) {
        throw new Error("Device UserOperationEvent was not emitted.")
      }
      return event.args.success
    }
    const expectValidationFailure = async (
      userOperation: UserOperation<"0.7">
    ) => {
      const error = await publicClient
        .simulateContract({
          account: bundlerAccount.address,
          abi: entryPoint07Abi,
          address: entryPoint07Address,
          args: [
            [toPackedUserOperation(userOperation)],
            bundlerAccount.address
          ],
          functionName: "handleOps",
          gas: 10_000_000n
        })
        .then(
          () => null,
          (reason: BaseError) => reason
        )
      expect(error).toBeInstanceOf(BaseError)
      if (!(error instanceof BaseError)) {
        throw new Error("Expected EntryPoint handleOps validation to fail.")
      }
      const errorText = [error.shortMessage, error.details, error.message].join(
        "\n"
      )
      expect(
        entryPointFailedOpSelectors.some((selector) =>
          errorText.includes(selector)
        )
      ).toBe(true)
      return errorText
    }

    const arbitraryCalls = [
      { data: "0x1234" as ViemHex, to: recipient, value: 0n }
    ] satisfies Parameters<typeof deviceAccount.encodeCalls>[0]
    const deviceEnableOperationBase = {
      callData: await deviceAccount.encodeCalls(arbitraryCalls),
      callGasLimit: 2_000_000n,
      ...(await rootAccount.getFactoryArgs()),
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await deviceAccount.getNonce(),
      preVerificationGas: 250_000n,
      sender: deviceAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 4_000_000n
    } satisfies UserOperation<"0.7">
    const action = deviceAccount.kernelPluginManager.getAction()
    const selectorData = concat([
      action.selector,
      action.address,
      action.hook?.address ?? zeroAddress,
      encodeAbiParameters(
        parseAbiParameters("bytes selectorInitData, bytes hookInitData"),
        ["0xFF", "0x0000"]
      )
    ])
    const enableTypedData =
      await deviceAccount.kernelPluginManager.getPluginsEnableTypedData(
        deviceAccount.address,
        deviceValidator
      )
    const malformedDeviceEnableSignature =
      await deviceValidator.signTypedData(enableTypedData)
    const deviceUserOperationSignature =
      await deviceAccount.kernelPluginManager.signUserOperationWithActiveValidator(
        deviceEnableOperationBase
      )
    const malformedEnableOperation = {
      ...deviceEnableOperationBase,
      signature: concat([
        deviceAccount.kernelPluginManager.hook?.getIdentifier() ?? zeroAddress,
        encodeAbiParameters(
          parseAbiParameters(
            "bytes validatorData, bytes hookData, bytes selectorData, bytes enableSig, bytes userOpSig"
          ),
          [
            await deviceValidator.getEnableData(deviceAccount.address),
            (await deviceAccount.kernelPluginManager.hook?.getEnableData(
              deviceAccount.address
            )) ?? "0x",
            selectorData,
            malformedDeviceEnableSignature,
            deviceUserOperationSignature
          ]
        )
      ])
    } satisfies UserOperation<"0.7">
    expect(await expectValidationFailure(malformedEnableOperation)).toContain(
      "AA23"
    )

    const rootDeploymentBase = {
      callData: await rootAccount.encodeCalls([
        { data: "0x", to: recipient, value: 0n }
      ]),
      callGasLimit: 1_000_000n,
      ...(await rootAccount.getFactoryArgs()),
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await rootAccount.getNonce(),
      preVerificationGas: 180_000n,
      sender: rootAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 3_000_000n
    } satisfies UserOperation<"0.7">
    expect(
      await submit({
        ...rootDeploymentBase,
        signature: await rootAccount.signUserOperation({
          ...rootDeploymentBase,
          chainId: base.id
        })
      })
    ).toBe(true)

    const install = await buildDeviceInstallCalls({
      account: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: registeredDeviceCredential,
      signer: deviceSigner
    })
    const installBase = {
      callData: await rootAccount.encodeCalls(install.calls),
      callGasLimit: 2_000_000n,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await rootAccount.getNonce(),
      preVerificationGas: 200_000n,
      sender: rootAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 2_000_000n
    } satisfies UserOperation<"0.7">
    expect(
      await submit({
        ...installBase,
        signature: await rootAccount.signUserOperation({
          ...installBase,
          chainId: base.id
        })
      })
    ).toBe(true)
    await expect(
      buildDeviceInstallCalls({
        account: rootAccount.address,
        chainId: base.id,
        client: publicClient,
        credential: registeredDeviceCredential,
        signer: deviceSigner
      })
    ).rejects.toThrow(
      "Device permission id is already occupied; create a new credential."
    )
    expect(
      await submit(
        await buildUserOperation({
          account: deviceAccount,
          calls: arbitraryCalls,
          includeFactory: false
        })
      )
    ).toBe(true)

    const signedMessage = await deviceAccount.signMessage({
      message: "Slice wallet device ERC-1271 fork proof"
    })
    await expect(
      publicClient.verifyMessage({
        address: rootAccount.address,
        message: "Slice wallet device ERC-1271 fork proof",
        signature: signedMessage
      })
    ).resolves.toBe(true)

    const registryAuthorization =
      formatSliceWalletExistingCredentialAuthorization({
        accountAddress: rootAccount.address,
        accountIndex: 0,
        challenge: `0x${"ab".repeat(32)}`,
        chainId: base.id,
        credentialIdHash: promotedRootCredential.credentialIdHash,
        factoryVersion: sliceWalletKernelVersion,
        publicKey: promotedRootCredential.publicKey,
        registrationKind: "device"
      })
    const registrySignature = await deviceAccount.signMessage({
      message: registryAuthorization
    })
    await expect(
      publicClient.verifyMessage({
        address: rootAccount.address,
        message: registryAuthorization,
        signature: registrySignature
      })
    ).resolves.toBe(true)

    const sessionKey = await generateSliceWalletP256KeyPair()
    const sessionValidUntil = Math.floor(Date.now() / 1_000) + 3_600
    const sessionPolicy = {
      account: rootAccount.address,
      calls: [
        {
          parameterRules: [],
          selector: "0x00000000" as ViemHex,
          target: recipient,
          valueLimit: 1n
        }
      ],
      chainId: base.id,
      grantKind: "generic",
      rateLimit: { count: 1, intervalSec: 3_600 },
      validAfter: getWalletPermissionValidAfter(),
      validUntil: sessionValidUntil,
      version: 1
    } as const
    const session = {
      account: rootAccount.address,
      chainId: base.id,
      expiresAt: sessionPolicy.validUntil,
      grantKind: "generic",
      permissionId: getWalletPermissionId(sessionPolicy, sessionKey.signerId),
      policy: sessionPolicy,
      publicKey: sessionKey.publicKeyHex,
      signerId: sessionKey.signerId
    } satisfies SliceWalletFrameSession
    const sessionInstall = await buildSliceWalletPermissionInstallCalls({
      account: rootAccount.address,
      client: publicClient,
      session
    })
    expect(
      await submit(
        await buildUserOperation({
          account: deviceAccount,
          calls: sessionInstall.calls,
          includeFactory: false
        })
      )
    ).toBe(true)
    const sessionFrameClient: SliceWalletSignerFrameClient = {
      destroy: () => {},
      request: async (request) => {
        if (request.method !== "signScopedUserOperation") {
          throw new Error("Unexpected session fork frame request.")
        }
        const userOperationHash = getUserOperationHash({
          chainId: base.id,
          entryPointAddress: entryPoint07Address,
          entryPointVersion: "0.7",
          userOperation: {
            ...request.params.userOperation,
            signature: "0x"
          }
        })
        return {
          proposalHash: `0x${"00".repeat(32)}`,
          signature: await encodeSliceWalletSyntheticWebAuthnSignature({
            chainId: base.id,
            challenge: userOperationHash,
            key: sessionKey.privateKey,
            origin,
            rpId,
            usePrecompiled: false
          }),
          userOperationHash
        }
      }
    }
    const sessionAccount = await createSliceWalletPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: registeredRootCredential,
      enableSignature: "0x",
      frameClient: sessionFrameClient,
      mode: "generic",
      session
    })
    const sessionOperationBase = {
      callData: await sessionAccount.encodeCalls([
        { data: "0x", to: recipient, value: 0n }
      ]),
      callGasLimit: 2_000_000n,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await sessionAccount.getNonce(),
      preVerificationGas: 250_000n,
      sender: rootAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 2_000_000n
    } satisfies UserOperation<"0.7">
    expect(
      await submit({
        ...sessionOperationBase,
        signature: await sessionAccount.signUserOperation({
          ...sessionOperationBase,
          chainId: base.id
        })
      })
    ).toBe(true)

    const removableInstall = await buildDeviceInstallCalls({
      account: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: registeredRemovableDeviceCredential,
      signer: removableDeviceSigner
    })
    const removableInstallBase = {
      ...installBase,
      callData: await rootAccount.encodeCalls(removableInstall.calls),
      nonce: await rootAccount.getNonce(),
      signature: "0x" as ViemHex
    } satisfies UserOperation<"0.7">
    expect(
      await submit({
        ...removableInstallBase,
        signature: await rootAccount.signUserOperation({
          ...removableInstallBase,
          chainId: base.id
        })
      })
    ).toBe(true)
    const removableDeviceNonce = await removableDeviceAccount.getNonce()

    const promotion = await buildDevicePromotionCalls({
      account: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: registeredDeviceCredential,
      newRootCredential: promotedRootCredential,
      signer: deviceSigner
    })
    expect(
      await submit(
        await buildUserOperation({
          account: deviceAccount,
          calls: promotion.calls,
          includeFactory: false
        })
      )
    ).toBe(true)
    expect(
      await getSliceWalletRootValidatorPublicKey({
        account: rootAccount.address,
        client: publicClient
      })
    ).toEqual(
      parseSliceWalletUncompressedPublicKey(promotedRootCredential.publicKey)
    )
    const promotedRootWebAuthnAccount = toWebAuthnAccount({
      credential: {
        id: promotedRootCredentialId,
        publicKey: getPasskeyPublicKey(promotedRootPrivateKey)
      },
      getFn: createSyntheticWebAuthnGetFn(promotedRootPrivateKey),
      rpId
    })
    const promotedRootAccount = await createSliceWalletRegisteredKernelAccount({
      address: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: promotedRootCredential,
      rootSigner: async (hash) =>
        encodeWebAuthnValidatorSignature(
          await promotedRootWebAuthnAccount.sign({ hash })
        )
    })
    const standaloneUninstall = await buildDeviceUninstallCalls({
      account: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: registeredRemovableDeviceCredential,
      signer: removableDeviceSigner
    })
    const uninstallBase = {
      callData: await promotedRootAccount.encodeCalls(
        standaloneUninstall.calls
      ),
      callGasLimit: 2_000_000n,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await promotedRootAccount.getNonce(),
      preVerificationGas: 200_000n,
      sender: promotedRootAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 2_000_000n
    } satisfies UserOperation<"0.7">
    expect(
      await submit({
        ...uninstallBase,
        signature: await promotedRootAccount.signUserOperation({
          ...uninstallBase,
          chainId: base.id
        })
      })
    ).toBe(true)
    const removedDeviceOperationBase = {
      callData: await removableDeviceAccount.encodeCalls(arbitraryCalls),
      callGasLimit: 2_000_000n,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: removableDeviceNonce,
      preVerificationGas: 250_000n,
      sender: removableDeviceAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 2_000_000n
    } satisfies UserOperation<"0.7">
    await expectValidationFailure({
      ...removedDeviceOperationBase,
      signature:
        await removableDeviceAccount.kernelPluginManager.signUserOperationWithActiveValidator(
          removedDeviceOperationBase
        )
    })
    await expectValidationFailure(
      await buildUserOperation({
        account: deviceAccount,
        calls: arbitraryCalls,
        includeFactory: false
      })
    )
  }, 240_000)
})

runForkTests("Kernel passkey recovery Base fork", () => {
  it("rotates the root passkey only after the recovery timelock window", async () => {
    const publicClient = createForkPublicClient()
    const testClient = createForkTestClient()
    const walletClient = createForkWalletClient()
    await installTimelockPolicyCode()

    const rootCredential = {
      id: credentialId,
      publicKey: getPasskeyPublicKey(passkeyPrivateKey)
    }
    const newCredential = {
      id: secondCredentialId,
      publicKey: getPasskeyPublicKey(recoveryNewPasskeyPrivateKey)
    }
    const registeredRootCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(rootCredential.id),
      publicKey: PublicKey.toHex(
        P256.getPublicKey({ privateKey: passkeyPrivateKey })
      )
    }
    const registeredNewCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(newCredential.id),
      publicKey: PublicKey.toHex(
        P256.getPublicKey({ privateKey: recoveryNewPasskeyPrivateKey })
      )
    }
    const recoveryTimelock = {
      delaySec: 60,
      expirationSec: 120
    }
    const recoveryInit = await buildRecoveryPermissionInitConfig({
      client: publicClient,
      recoverySignerAddress: recoverySignerAccount.address,
      recoveryTimelock
    })
    const rootWebAuthnAccount = toWebAuthnAccount({
      credential: rootCredential,
      getFn: createSyntheticWebAuthnGetFn(passkeyPrivateKey),
      rpId
    })
    const rootAccount = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client: publicClient,
      credential: registeredRootCredential,
      initConfig: recoveryInit.initConfig,
      rootSigner: async (hash) =>
        encodeWebAuthnValidatorSignature(
          await rootWebAuthnAccount.sign({ hash })
        )
    })
    await depositRecoveryEntryPoint({
      account: rootAccount.address,
      value: parseEther("0.08"),
      walletClient
    })
    const fundHash = await walletClient.sendTransaction({
      to: rootAccount.address,
      value: parseEther("0.02")
    })
    await publicClient.waitForTransactionReceipt({ hash: fundHash })

    const submit = async (userOperation: UserOperation<"0.7">) => {
      const hash = await submitRecoveryHandleOps({
        beneficiary: bundlerAccount.address,
        gas: 7_000_000n,
        userOperation,
        walletClient
      })

      return publicClient.waitForTransactionReceipt({ hash })
    }
    const { factory, factoryData } = await rootAccount.getFactoryArgs()
    if (factory === undefined || factoryData === undefined) {
      throw new Error(
        "Counterfactual recovery account factory data is missing."
      )
    }
    const deploymentOperationBase = {
      sender: rootAccount.address,
      nonce: await rootAccount.getNonce(),
      factory,
      factoryData,
      callData: await rootAccount.encodeCalls([
        { data: "0x", to: recipient, value: 1n }
      ]),
      ...recoveryGas,
      signature: "0x"
    } satisfies UserOperation<"0.7">
    const deploymentReceipt = await submit({
      ...deploymentOperationBase,
      signature: await rootAccount.signUserOperation({
        ...deploymentOperationBase,
        chainId: base.id
      })
    })
    expect(deploymentReceipt.status).toBe("success")
    expect(
      await publicClient.getCode({ address: rootAccount.address })
    ).not.toBe("0x")

    const expectRecoveryHandleOpsFailure = async ({
      expectedText,
      userOperation
    }: {
      expectedText: string
      userOperation: UserOperation<"0.7">
    }) => {
      const simulationError = await publicClient
        .simulateContract({
          account: bundlerAccount.address,
          address: entryPoint07Address,
          abi: entryPoint07Abi,
          functionName: "handleOps",
          args: [
            [toPackedUserOperation(userOperation)],
            bundlerAccount.address
          ],
          gas: 7_000_000n
        })
        .then(
          () => null,
          (error: BaseError) => error
        )

      if (!(simulationError instanceof BaseError)) {
        throw new Error("Expected EntryPoint handleOps simulation to fail.")
      }

      const errorText = [
        simulationError.shortMessage,
        simulationError.details,
        simulationError.message
      ].join("\n")
      expect(
        entryPointFailedOpSelectors.some((selector) =>
          errorText.includes(selector)
        )
      ).toBe(true)
      expect(errorText).toContain(expectedText)
    }

    const recoveryAccount = await createDeployedRecoveryPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      recoveryPrivateKey: recoverySignerPrivateKey,
      recoverySignerAddress: recoverySignerAccount.address,
      recoveryTimelock
    })
    const permissionId = recoveryAccount.recoveryPermissionId
    expect(permissionId).toBe(recoveryInit.permissionId)
    const rotationCalls = buildRecoveryRotationCalls(registeredNewCredential)
    const rotationCallData = await recoveryAccount.encodeCalls(rotationCalls)
    const firstProposalNonce = (await recoveryAccount.getNonce()) + 1n
    const firstProposalOperation = await buildRecoveryProposalUserOperation({
      account: recoveryAccount,
      callData: rotationCallData,
      chainId: base.id,
      gas: recoveryGas,
      nonce: firstProposalNonce
    })
    const firstProposalReceipt = await submit(firstProposalOperation)
    expect(firstProposalReceipt.status).toBe("success")
    const [accountCode, recoveryConfig] = await Promise.all([
      publicClient.getCode({ address: rootAccount.address }),
      publicClient.readContract({
        abi: timelockPolicyConfigAbi,
        address: sliceKernelTimelockPolicyAddress,
        args: [
          pad(permissionId, { dir: "right", size: 32 }),
          rootAccount.address
        ],
        functionName: "timelockConfig"
      })
    ])
    expect(accountCode).toStartWith("0x")
    expect(accountCode).not.toBe("0x")
    expect(recoveryConfig[0]).toBe(recoveryTimelock.delaySec)
    expect(recoveryConfig[1]).toBe(recoveryTimelock.expirationSec)
    expect(recoveryConfig[3]).toBe(true)

    await expect(
      getRecoveryState({
        account: recoveryAccount.address,
        callData: rotationCallData,
        client: publicClient,
        nonce: firstProposalNonce,
        permissionId
      })
    ).resolves.toMatchObject({ status: "pending" })

    const prematureExecutionOperation = await buildRecoveryUserOperation({
      account: recoveryAccount,
      calls: rotationCalls,
      chainId: base.id,
      gas: recoveryGas
    })
    await expectRecoveryHandleOpsFailure({
      expectedText: "AA22",
      userOperation: prematureExecutionOperation
    })

    const cancelOperation = await buildRecoveryUserOperation({
      account: rootAccount,
      calls: [
        buildRecoveryCancelCall({
          account: recoveryAccount.address,
          callData: rotationCallData,
          nonce: firstProposalNonce,
          permissionId
        })
      ],
      chainId: base.id,
      gas: recoveryGas
    })
    const cancelReceipt = await submit(cancelOperation)
    expect(cancelReceipt.status).toBe("success")
    await expect(
      getRecoveryState({
        account: recoveryAccount.address,
        callData: rotationCallData,
        client: publicClient,
        nonce: firstProposalNonce,
        permissionId
      })
    ).resolves.toMatchObject({ status: "cancelled" })

    await expectRecoveryHandleOpsFailure({
      expectedText: "AA23",
      userOperation: prematureExecutionOperation
    })

    const secondProposalNonce = (await recoveryAccount.getNonce()) + 1n
    const secondProposalOperation = await buildRecoveryProposalUserOperation({
      account: recoveryAccount,
      callData: rotationCallData,
      chainId: base.id,
      gas: recoveryGas,
      nonce: secondProposalNonce
    })
    const secondProposalReceipt = await submit(secondProposalOperation)
    expect(secondProposalReceipt.status).toBe("success")

    await testClient.increaseTime({
      seconds: recoveryTimelock.delaySec + 1
    })
    await testClient.mine({ blocks: 1 })

    const recoveryExecutionOperation = await buildRecoveryUserOperation({
      account: recoveryAccount,
      calls: rotationCalls,
      chainId: base.id,
      gas: recoveryGas
    })
    const recoveryExecutionReceipt = await submit(recoveryExecutionOperation)
    expect(recoveryExecutionReceipt.status).toBe("success")
    await expect(
      getRecoveryState({
        account: recoveryAccount.address,
        callData: rotationCallData,
        client: publicClient,
        nonce: secondProposalNonce,
        permissionId
      })
    ).resolves.toMatchObject({ status: "executed" })

    const oldPasskeyOperation = await buildRecoveryUserOperation({
      account: rootAccount,
      calls: [{ to: recipient, value: 0n, data: "0x" }],
      chainId: base.id,
      gas: recoveryGas
    })
    await expectRecoveryHandleOpsFailure({
      expectedText: "AA24",
      userOperation: oldPasskeyOperation
    })

    const rotatedRootAccount = await createForkKernelAccount({
      address: rootAccount.address,
      id: newCredential.id,
      privateKey: recoveryNewPasskeyPrivateKey
    })
    const recoveredTransferValue = parseEther("0.001")
    const [accountBalanceBefore, recipientBalanceBefore] = await Promise.all([
      publicClient.getBalance({ address: rootAccount.address }),
      publicClient.getBalance({ address: recipient })
    ])
    const newPasskeyOperation = await buildRecoveryUserOperation({
      account: rotatedRootAccount,
      calls: [{ to: recipient, value: recoveredTransferValue, data: "0x" }],
      chainId: base.id,
      gas: recoveryGas
    })
    const newPasskeyReceipt = await submit(newPasskeyOperation)
    expect(newPasskeyReceipt.status).toBe("success")
    const [accountBalanceAfter, recipientBalanceAfter] = await Promise.all([
      publicClient.getBalance({ address: rootAccount.address }),
      publicClient.getBalance({ address: recipient })
    ])
    expect(accountBalanceBefore - accountBalanceAfter).toBe(
      recoveredTransferValue
    )
    expect(recipientBalanceAfter - recipientBalanceBefore).toBe(
      recoveredTransferValue
    )

    const staleRotationCalls = buildRecoveryRotationCalls(
      registeredRootCredential
    )
    const staleRotationCallData =
      await recoveryAccount.encodeCalls(staleRotationCalls)
    const expiredProposalNonce = (await recoveryAccount.getNonce()) + 1n
    const expiredProposalOperation = await buildRecoveryProposalUserOperation({
      account: recoveryAccount,
      callData: staleRotationCallData,
      chainId: base.id,
      gas: recoveryGas,
      nonce: expiredProposalNonce
    })
    const expiredProposalReceipt = await submit(expiredProposalOperation)
    expect(expiredProposalReceipt.status).toBe("success")

    await testClient.increaseTime({
      seconds: recoveryTimelock.delaySec + recoveryTimelock.expirationSec + 1
    })
    await testClient.mine({ blocks: 1 })

    const expiredExecutionOperation = await buildRecoveryUserOperation({
      account: recoveryAccount,
      calls: staleRotationCalls,
      chainId: base.id,
      gas: recoveryGas
    })
    await expectRecoveryHandleOpsFailure({
      expectedText: "AA22",
      userOperation: expiredExecutionOperation
    })
  }, 300_000)
})

runForkTests("Buyer execution session Base fork", () => {
  it("requires browser and policy co-signatures for checkout-scoped execution", async () => {
    const publicClient = createForkPublicClient()
    const walletClient = createForkWalletClient()
    await installWeightedEcdsaSignerCode()
    await installTimelockPolicyCode()

    const executionPasskeyPrivateKey =
      "0x0303030303030303030303030303030303030303030303030303030303030303" satisfies ViemHex
    const executionCredentialId = Base64.fromBytes(
      Hex.toBytes("0x2122232425262728292a2b2c2d2e2f30"),
      { pad: false, url: true }
    )
    const credential = {
      id: executionCredentialId,
      publicKey: getPasskeyPublicKey(executionPasskeyPrivateKey)
    }
    const registeredCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(credential.id),
      publicKey: PublicKey.toHex(
        P256.getPublicKey({ privateKey: executionPasskeyPrivateKey })
      )
    }
    const recoveryInit = await buildRecoveryPermissionInitConfig({
      client: publicClient,
      recoverySignerAddress: recoverySignerAccount.address
    })
    const rootAccount = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client: publicClient,
      credential: registeredCredential,
      initConfig: recoveryInit.initConfig
    })
    const offlineRecovery = await deriveSliceWalletRecoveryBootstrap({
      chainId: base.id,
      credential: registeredCredential,
      recoverySignerAddress: recoverySignerAccount.address
    })
    expect(rootAccount.address).toBe(
      await predictSliceWalletKernelAccountAddress({
        chainId: base.id,
        credential: registeredCredential,
        recoverySignerAddress: recoverySignerAccount.address
      })
    )
    expect(offlineRecovery.account).toBe(rootAccount.address)
    expect(offlineRecovery.permissionId).toBe(recoveryInit.permissionId)

    const sessionPrivateKey =
      "0x0404040404040404040404040404040404040404040404040404040404040404" satisfies ViemHex
    const sessionSignerAddress = privateKeyToAccount(sessionPrivateKey).address
    const validUntil = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60

    const enableTypedData = await buildSliceExecutionEnableTypedData({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      coSignerAddress: executionCoSignerAccount.address,
      credential,
      mode: "checkout",
      sessionSignerAddress,
      validUntil
    })
    const webAuthnAccount = toWebAuthnAccount({
      credential: { id: credential.id, publicKey: credential.publicKey },
      getFn: createSyntheticWebAuthnGetFn(executionPasskeyPrivateKey),
      rpId
    })
    const assertion = await webAuthnAccount.sign({
      hash: hashTypedData(
        enableTypedData as Parameters<typeof hashTypedData>[0]
      )
    })
    const enableSignature = encodeWebAuthnValidatorSignature(assertion)

    const executionAccount = await createSliceExecutionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      coSignerAddress: executionCoSignerAccount.address,
      credential,
      enableSignature,
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      getCoSignature: async ({ userOperation }) => {
        const userOperationHash = getUserOperationHash({
          chainId: base.id,
          entryPointAddress: sliceKernelBaseV33Config.entryPoint,
          entryPointVersion: sliceKernelBaseV33Config.entryPointVersion,
          userOperation: {
            ...userOperation,
            signature: "0x"
          }
        })

        return executionCoSignerAccount.sign({ hash: userOperationHash })
      },
      mode: "checkout",
      sessionPrivateKey,
      sessionSignerAddress,
      validUntil
    })
    expect(executionAccount.address).toBe(rootAccount.address)

    const depositHash = await walletClient.writeContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      functionName: "depositTo",
      args: [rootAccount.address],
      value: parseEther("0.05")
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })

    const productsModuleAddress = getProductsModuleAddress(base.id)
    const usdcAddress =
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" satisfies Address
    const fees = await publicClient.estimateFeesPerGas()

    const forkBundlerUrl = process.env.KERNEL_PASSKEY_FORK_BUNDLER_URL
    const estimatePromptlessGas = async () => {
      if (!forkBundlerUrl) return null

      const bundlerClient = createBundlerClient({
        client: publicClient,
        transport: http(forkBundlerUrl)
      })
      return bundlerClient.estimateUserOperationGas({
        account: executionAccount,
        calls: [
          {
            to: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [productsModuleAddress, 123n]
            })
          }
        ],
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1")
      })
    }

    // 0. eth_estimateUserOperationGas must survive the stub signature on the
    //    enable-mode (undeployed) path: the stub carries a REAL proposal
    //    signature so the weighted signer soft-fails on the dummy co-signature
    //    instead of reverting with ZeroWeightSigner (AA23).
    const enableModeEstimate = await estimatePromptlessGas()
    if (forkBundlerUrl) {
      expect(enableModeEstimate).not.toBeNull()
      expect((enableModeEstimate?.callGasLimit ?? 0n) > 0n).toBe(true)
      expect((enableModeEstimate?.verificationGasLimit ?? 0n) > 0n).toBe(true)
    }

    const buildUserOperation = async (spender: Address) => {
      const { factory, factoryData } = await executionAccount.getFactoryArgs()
      const userOperationBase = {
        sender: executionAccount.address,
        nonce: await executionAccount.getNonce(),
        ...(factory === undefined ? {} : { factory }),
        ...(factoryData === undefined ? {} : { factoryData }),
        callData: await executionAccount.encodeCalls([
          {
            to: usdcAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [spender, 123n]
            })
          }
        ]),
        callGasLimit: 500_000n,
        verificationGasLimit: 2_000_000n,
        preVerificationGas: 120_000n,
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
        signature: "0x"
      } satisfies UserOperation<"0.7">
      const signature = await executionAccount.signUserOperation({
        ...userOperationBase,
        chainId: base.id
      })

      return { ...userOperationBase, signature } satisfies UserOperation<"0.7">
    }
    const stripPolicyCoSignature = (
      userOperation: UserOperation<"0.7">
    ): UserOperation<"0.7"> => {
      if (userOperation.signature.length <= ecdsaSignatureHexLength + 2) {
        throw new Error("UserOperation signature is missing a co-signature.")
      }

      return {
        ...userOperation,
        signature: slice(userOperation.signature, 0, -ecdsaSignatureByteLength)
      }
    }
    const replacePolicyCoSignature = async (
      userOperation: UserOperation<"0.7">
    ): Promise<UserOperation<"0.7">> => {
      const userOperationHash = getUserOperationHash({
        chainId: base.id,
        entryPointAddress: sliceKernelBaseV33Config.entryPoint,
        entryPointVersion: sliceKernelBaseV33Config.entryPointVersion,
        userOperation: {
          ...userOperation,
          signature: "0x"
        }
      })
      const wrongCoSignature = await wrongExecutionCoSignerAccount.sign({
        hash: userOperationHash
      })

      return {
        ...userOperation,
        signature: `${userOperation.signature.slice(
          0,
          -ecdsaSignatureHexLength
        )}${wrongCoSignature.slice(2)}` as ViemHex
      }
    }
    const executeHandleOps = async (userOperation: UserOperation<"0.7">) => {
      const args = [
        [toPackedUserOperation(userOperation)],
        bundlerAccount.address
      ] as const
      const hash = await walletClient.writeContract({
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args,
        gas: 6_000_000n
      })

      return publicClient.waitForTransactionReceipt({ hash })
    }
    const expectHandleOpsFailure = async (
      userOperation: UserOperation<"0.7">,
      expectedReason: string
    ) => {
      const args = [
        [toPackedUserOperation(userOperation)],
        bundlerAccount.address
      ] as const
      const simulationError = await publicClient
        .simulateContract({
          account: bundlerAccount.address,
          address: entryPoint07Address,
          abi: entryPoint07Abi,
          functionName: "handleOps",
          args,
          gas: 6_000_000n
        })
        .then(
          () => null,
          (error: BaseError) => error
        )

      if (!(simulationError instanceof BaseError)) {
        throw new Error("Expected EntryPoint handleOps simulation to fail.")
      }
      const errorText = [
        simulationError.shortMessage,
        simulationError.details,
        simulationError.message
      ].join("\n")
      expect(
        entryPointFailedOpSelectors.some((selector) =>
          errorText.includes(selector)
        )
      ).toBe(true)
      expect(errorText).toContain(expectedReason)

      const receipt = await executeHandleOps(userOperation)
      expect(receipt.status).toBe("reverted")
    }

    // 1. A stolen browser session key alone cannot validate the permission.
    const sessionOnlyOperation = stripPolicyCoSignature(
      await buildUserOperation(productsModuleAddress)
    )
    await expectHandleOpsFailure(sessionOnlyOperation, "AA23 reverted")

    // 2. A co-signature from the wrong Slice key also fails validation.
    const wrongCoSignerOperation = await replacePolicyCoSignature(
      await buildUserOperation(productsModuleAddress)
    )
    await expectHandleOpsFailure(wrongCoSignerOperation, "AA24 signature error")

    // 3. Undeployed account, enable-mode userop with both signatures and an
    //    allowlisted call (ERC-20 approve to the ProductsModule) succeeds.
    const allowedOperation = await buildUserOperation(productsModuleAddress)
    const allowedReceipt = await executeHandleOps(allowedOperation)
    expect(allowedReceipt.status).toBe("success")

    const [allowance, recoveryConfig] = await Promise.all([
      publicClient.readContract({
        abi: erc20Abi,
        address: usdcAddress,
        functionName: "allowance",
        args: [executionAccount.address, productsModuleAddress]
      }),
      publicClient.readContract({
        abi: timelockPolicyConfigAbi,
        address: sliceKernelTimelockPolicyAddress,
        args: [
          pad(recoveryInit.permissionId, { dir: "right", size: 32 }),
          executionAccount.address
        ],
        functionName: "timelockConfig"
      })
    ])
    expect(allowance).toBe(123n)
    expect(recoveryConfig[3]).toBe(true)

    // 4. Deployed account, default-mode session userop with a call outside
    //    the policy (approve to an arbitrary spender) — validation must fail.
    await expectHandleOpsFailure(await buildUserOperation(recipient), "AA23")

    // 5. Deployed account, second allowlisted call without any new enable
    //    payload — the permission validator persists across operations.
    const repeatOperation = await buildUserOperation(productsModuleAddress)
    const repeatReceipt = await executeHandleOps(repeatOperation)
    expect(repeatReceipt.status).toBe("success")

    // 6. Estimation also works against the deployed, permission-enabled
    //    account (default-mode stub, no enable envelope).
    const defaultModeEstimate = await estimatePromptlessGas()
    if (forkBundlerUrl) {
      expect(defaultModeEstimate).not.toBeNull()
      expect((defaultModeEstimate?.callGasLimit ?? 0n) > 0n).toBe(true)
    }

    const signatureHash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" satisfies ViemHex
    const sessionAccount = privateKeyToAccount(sessionPrivateKey)
    const sortedSignatures = [
      {
        address: sessionAccount.address,
        signature: await sessionAccount.sign({ hash: signatureHash })
      },
      {
        address: executionCoSignerAccount.address,
        signature: await executionCoSignerAccount.sign({ hash: signatureHash })
      }
    ].sort((left, right) =>
      BigInt(left.address) < BigInt(right.address) ? -1 : 1
    )
    const permission1271Signature = concat([
      executionAccount.kernelPluginManager.getIdentifier(),
      "0xff",
      ...sortedSignatures.map(({ signature }) => signature)
    ])

    try {
      const signatureResult = await publicClient.readContract({
        abi: erc1271Abi,
        address: executionAccount.address,
        functionName: "isValidSignature",
        args: [signatureHash, permission1271Signature]
      })
      expect(signatureResult).not.toBe("0x1626ba7e")
    } catch (error) {
      expect(error).toBeDefined()
    }
  }, 240_000)
})

runForkTests("Portable P-256 execution session Base fork", () => {
  it("estimates and executes with WeightedP256Signer while enforcing the call policy", async () => {
    const publicClient = createForkPublicClient()
    const testClient = createForkTestClient()
    const walletClient = createForkWalletClient()
    await installP256PrecompileFallback()
    await installWeightedP256SignerCode()
    const forkTimestamp = (await publicClient.getBlock()).timestamp
    await testClient.setNextBlockTimestamp({
      timestamp: forkTimestamp + 1n
    })
    await testClient.mine({ blocks: 1 })
    await testClient.setBlockTimestampInterval({ interval: 1 })
    const testTimestamp = Number((await publicClient.getBlock()).timestamp)

    const rootPrivateKey =
      "0x0909090909090909090909090909090909090909090909090909090909090909" satisfies ViemHex
    const rootCredentialId = Base64.fromBytes(
      Hex.toBytes("0x3132333435363738393a3b3c3d3e3f40"),
      { pad: false, url: true }
    )
    const rootCredential = {
      id: rootCredentialId,
      publicKey: getPasskeyPublicKey(rootPrivateKey)
    }
    const rootAccount = await createSliceKernelPasskeyAccount({
      client: publicClient,
      credential: rootCredential,
      getFn: createSyntheticWebAuthnGetFn(rootPrivateKey),
      rpId
    })
    const registeredRootCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(rootCredentialId),
      publicKey: PublicKey.toHex(
        P256.getPublicKey({
          privateKey: rootPrivateKey
        })
      )
    }
    const sessionKey = await generateSliceWalletP256KeyPair()
    const productsModuleAddress = getProductsModuleAddress(base.id)
    const usdcAddress =
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" satisfies Address
    const validUntil = testTimestamp + 7 * 24 * 60 * 60
    const policy = {
      account: rootAccount.address,
      calls: [
        createErc20ApproveCallRule({
          maximumAmount: 123n,
          spender: productsModuleAddress,
          token: usdcAddress
        })
      ],
      chainId: base.id,
      grantKind: "checkout",
      validAfter: 0,
      validUntil,
      version: 1
    } as const
    const session = {
      account: rootAccount.address,
      chainId: base.id,
      checkout: {
        allowanceUsdMicros: "100000000",
        coSignerAddress: executionCoSignerAccount.address
      },
      expiresAt: validUntil,
      grantKind: "checkout",
      permissionId: getWalletPermissionId(policy, sessionKey.signerId),
      policy,
      publicKey: sessionKey.publicKeyHex,
      signerId: sessionKey.signerId
    } satisfies SliceWalletFrameSession

    const enableTypedData = await buildSliceWalletPermissionEnableTypedData({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: registeredRootCredential,
      session
    })
    const rootWebAuthnAccount = toWebAuthnAccount({
      credential: rootCredential,
      getFn: createSyntheticWebAuthnGetFn(rootPrivateKey),
      rpId
    })
    const rootAssertion = await rootWebAuthnAccount.sign({
      hash: hashTypedData(
        enableTypedData as Parameters<typeof hashTypedData>[0]
      )
    })
    const enableSignature = encodeWebAuthnValidatorSignature(rootAssertion)
    const appOrigin = "http://localhost"
    const coSignChallenge =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" satisfies ViemHex
    const challengeIssuedAt = testTimestamp
    const challengeExpiresAt = challengeIssuedAt + 120
    const coSignValidUntil = challengeExpiresAt
    const spendWindowId = "lifetime"
    const windowStart = session.policy.validAfter
    const windowEndExclusive = session.policy.validUntil + 1

    const frameClient: SliceWalletSignerFrameClient = {
      destroy: () => {},
      request: async (request) => {
        if (request.method === "signCheckoutProposal") {
          const proposalHash = hashSliceWalletWeightedP256Proposal({
            account: request.params.sender,
            callData: request.params.callData,
            chainId: base.id,
            nonce: request.params.nonce,
            permissionId: session.permissionId,
            validUntil: request.params.validUntil
          })
          const signature = await signSliceWalletP256({
            key: sessionKey.privateKey,
            message: toBytes(proposalHash)
          })
          await expectBaseP256Signature({
            digest: sha256(proposalHash),
            publicKey: session.publicKey,
            signature
          })
          return {
            proposalHash,
            signature
          }
        }
        if (request.method === "signCoSignRequest") {
          const userOperationHash = getUserOperationHash({
            chainId: base.id,
            entryPointAddress: entryPoint07Address,
            entryPointVersion: "0.7",
            userOperation: {
              ...request.params.userOperation,
              signature: "0x"
            }
          })
          const proposalHash = hashSliceWalletWeightedP256Proposal({
            account: request.params.userOperation.sender,
            callData: request.params.userOperation.callData,
            chainId: base.id,
            nonce: request.params.userOperation.nonce,
            permissionId: session.permissionId,
            validUntil: request.params.validUntil
          })
          const proofHash = hashSliceWalletCoSignRequest({
            accountNonce: request.params.userOperation.nonce,
            appOrigin,
            challenge: request.params.challenge,
            challengeExpiresAt: request.params.challengeExpiresAt,
            challengeIssuedAt: request.params.challengeIssuedAt,
            delegationId: request.params.delegationId,
            proposalHash,
            session,
            validUntil: request.params.validUntil,
            windowEndExclusive: request.params.windowEndExclusive,
            windowId: request.params.windowId,
            windowStart: request.params.windowStart,
            userOperationHash
          })
          const [proofSignature, signature] = await Promise.all([
            signSliceWalletP256({
              key: sessionKey.privateKey,
              message: toBytes(proofHash)
            }),
            signSliceWalletP256({
              key: sessionKey.privateKey,
              message: toBytes(proposalHash)
            })
          ])
          await expectBaseP256Signature({
            digest: sha256(proposalHash),
            publicKey: session.publicKey,
            signature
          })
          return {
            proofSignature,
            proposalHash,
            signature,
            userOperationHash
          }
        }
        throw new Error("Unexpected signer-frame request in fork test.")
      }
    }
    const executionAccount = await createSliceWalletPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      checkoutCoSigner: {
        coSign: async (input) => {
          const userOperationHash = getUserOperationHash({
            chainId: base.id,
            entryPointAddress: entryPoint07Address,
            entryPointVersion: "0.7",
            userOperation: { ...input.userOperation, signature: "0x" }
          })
          const proposalHash = hashSliceWalletWeightedP256Proposal({
            account: input.userOperation.sender,
            callData: input.userOperation.callData,
            chainId: base.id,
            nonce: input.userOperation.nonce,
            permissionId: session.permissionId,
            validUntil: input.validUntil
          })
          const proofHash = hashSliceWalletCoSignRequest({
            accountNonce: input.userOperation.nonce,
            appOrigin,
            challenge: input.challenge,
            challengeExpiresAt: input.challengeExpiresAt,
            challengeIssuedAt: input.challengeIssuedAt,
            delegationId: input.delegationId,
            proposalHash,
            session,
            validUntil: input.validUntil,
            windowEndExclusive: input.windowEndExclusive,
            windowId: input.windowId,
            windowStart: input.windowStart,
            userOperationHash
          })
          expect(
            await verifySliceWalletP256({
              message: toBytes(proofHash),
              publicKey: session.publicKey,
              signature: input.proofSignature
            })
          ).toBe(true)
          const coSignDigest = hashSliceWalletWeightedP256CoSign({
            chainId: base.id,
            userOperationHash,
            validUntil: input.validUntil
          })
          const coSignature = await executionCoSignerAccount.sign({
            hash: coSignDigest
          })
          expect(
            await recoverAddress({
              hash: coSignDigest,
              signature: coSignature
            })
          ).toBe(executionCoSignerAccount.address)
          return {
            coSignature,
            proposalHash,
            remainingUsdMicros: "99000000",
            userOperationHash,
            validUntil: input.validUntil
          }
        },
        createChallenge: async () => ({
          challenge: coSignChallenge,
          challengeExpiresAt,
          challengeIssuedAt,
          validUntil: coSignValidUntil,
          windowEndExclusive,
          windowId: spendWindowId,
          windowStart
        })
      },
      client: publicClient,
      credential: registeredRootCredential,
      delegationId: "fork-checkout",
      enableSignature,
      frameClient,
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "checkout",
      session
    })
    expect(executionAccount.address).toBe(rootAccount.address)

    const depositHash = await walletClient.writeContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      args: [rootAccount.address],
      functionName: "depositTo",
      value: parseEther("0.05")
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    const fees = await publicClient.estimateFeesPerGas()
    const buildUserOperation = async (spender: Address) => {
      const { factory, factoryData } = await executionAccount.getFactoryArgs()
      const unsigned = {
        callData: await executionAccount.encodeCalls([
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [spender, 123n],
              functionName: "approve"
            }),
            to: usdcAddress,
            value: 0n
          }
        ]),
        callGasLimit: 500_000n,
        ...(factory === undefined ? {} : { factory }),
        ...(factoryData === undefined ? {} : { factoryData }),
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
        nonce: await executionAccount.getNonce(),
        preVerificationGas: 120_000n,
        sender: executionAccount.address,
        signature: "0x" as ViemHex,
        verificationGasLimit: 2_500_000n
      } satisfies UserOperation<"0.7">
      return {
        ...unsigned,
        signature: await executionAccount.signUserOperation({
          ...unsigned,
          chainId: base.id
        })
      } satisfies UserOperation<"0.7">
    }
    const submit = async (userOperation: UserOperation<"0.7">) => {
      const hash = await walletClient.writeContract({
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        args: [[toPackedUserOperation(userOperation)], bundlerAccount.address],
        functionName: "handleOps",
        gas: 7_000_000n
      })
      return publicClient.waitForTransactionReceipt({ hash })
    }

    const forkBundlerUrl = process.env.KERNEL_PASSKEY_FORK_BUNDLER_URL
    if (forkBundlerUrl) {
      const estimate = await createBundlerClient({
        client: publicClient,
        transport: http(forkBundlerUrl)
      }).estimateUserOperationGas({
        account: executionAccount,
        calls: [
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [productsModuleAddress, 123n],
              functionName: "approve"
            }),
            to: usdcAddress,
            value: 0n
          }
        ],
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1")
      })
      expect(estimate.verificationGasLimit > 0n).toBe(true)
    }

    expect(
      (await submit(await buildUserOperation(productsModuleAddress))).status
    ).toBe("success")
    expect(
      await publicClient.readContract({
        abi: erc20Abi,
        address: usdcAddress,
        args: [executionAccount.address, productsModuleAddress],
        functionName: "allowance"
      })
    ).toBe(123n)

    const excludedOperation = await buildUserOperation(recipient)
    const excludedReceipt = await submit(excludedOperation)
    expect(excludedReceipt.status).toBe("reverted")

    // The checkout signer deadline is shorter than the installed timestamp
    // policy. Kernel must propagate it into EntryPoint validation data.
    const expiredOperation = await buildUserOperation(productsModuleAddress)
    await testClient.removeBlockTimestampInterval()
    const latestBlock = await publicClient.getBlock()
    const expiredTimestamp = BigInt(coSignValidUntil) + 1n
    if (latestBlock.timestamp < expiredTimestamp) {
      await testClient.setNextBlockTimestamp({
        timestamp: expiredTimestamp
      })
      await testClient.mine({ blocks: 1 })
    }
    expect((await publicClient.getBlock()).timestamp).toBeGreaterThanOrEqual(
      expiredTimestamp
    )
    const expiredArgs = [
      [toPackedUserOperation(expiredOperation)],
      bundlerAccount.address
    ] as const
    const expiredSimulationError = await publicClient
      .simulateContract({
        account: bundlerAccount.address,
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: expiredArgs,
        gas: 7_000_000n
      })
      .then(
        () => null,
        (error: BaseError) => error
      )
    if (!(expiredSimulationError instanceof BaseError)) {
      throw new Error("Expected expired checkout validation to fail.")
    }
    const expiredErrorText = [
      expiredSimulationError.shortMessage,
      expiredSimulationError.details,
      expiredSimulationError.message
    ].join("\n")
    expect(
      entryPointFailedOpSelectors.some((selector) =>
        expiredErrorText.includes(selector)
      )
    ).toBe(true)
    expect(expiredErrorText).toContain("AA22")
    expect((await submit(expiredOperation)).status).toBe("reverted")
  }, 240_000)
})

runForkTests("Portable WebAuthn permission session Base fork", () => {
  it("executes policy batches and permanently revokes a never-used lazy permission", async () => {
    const publicClient = createForkPublicClient()
    const walletClient = createForkWalletClient()
    await installP256PrecompileFallback()
    expect(
      await publicClient.getCode({
        address: "0x65DEeC8fEe717dc044D0CFD63cCf55F02cCaC2b3"
      })
    ).not.toBe("0x")

    const rootPrivateKey =
      "0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a" satisfies ViemHex
    const rootCredentialId = Base64.fromBytes(
      Hex.toBytes("0x4142434445464748494a4b4c4d4e4f50"),
      { pad: false, url: true }
    )
    const rootCredential = {
      id: rootCredentialId,
      publicKey: getPasskeyPublicKey(rootPrivateKey)
    }
    const rootAccount = await createSliceKernelPasskeyAccount({
      client: publicClient,
      credential: rootCredential,
      getFn: createSyntheticWebAuthnGetFn(rootPrivateKey),
      rpId
    })
    const registeredRootCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(rootCredentialId),
      publicKey: PublicKey.toHex(
        P256.getPublicKey({ privateKey: rootPrivateKey })
      )
    }
    const sessionKey = await generateSliceWalletP256KeyPair()
    const productsModuleAddress = getProductsModuleAddress(base.id)
    const usdcAddress =
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" satisfies Address
    const now = Math.floor(Date.now() / 1000)
    const validAfter = now - 300
    const validUntil = now + 7 * 24 * 60 * 60
    const policy = {
      account: rootAccount.address,
      calls: [
        createErc20ApproveCallRule({
          maximumAmount: 321n,
          spender: productsModuleAddress,
          token: usdcAddress
        })
      ],
      chainId: base.id,
      grantKind: "generic",
      rateLimit: { count: 10, intervalSec: 60 },
      validAfter,
      validUntil,
      version: 1
    } as const
    const session = {
      account: rootAccount.address,
      chainId: base.id,
      expiresAt: validUntil,
      grantKind: "generic",
      permissionId: getWalletPermissionId(policy, sessionKey.signerId),
      policy,
      publicKey: sessionKey.publicKeyHex,
      signerId: sessionKey.signerId
    } satisfies SliceWalletFrameSession
    const enableTypedData = await buildSliceWalletPermissionEnableTypedData({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: registeredRootCredential,
      session
    })
    const rootWebAuthnAccount = toWebAuthnAccount({
      credential: rootCredential,
      getFn: createSyntheticWebAuthnGetFn(rootPrivateKey),
      rpId
    })
    const rootAssertion = await rootWebAuthnAccount.sign({
      hash: hashTypedData(
        enableTypedData as Parameters<typeof hashTypedData>[0]
      )
    })
    const enableSignature = encodeWebAuthnValidatorSignature(rootAssertion)
    const createSessionFrameClient = (
      key: Awaited<ReturnType<typeof generateSliceWalletP256KeyPair>>
    ): SliceWalletSignerFrameClient => ({
      destroy: () => {},
      request: async (request) => {
        if (request.method !== "signScopedUserOperation") {
          throw new Error(
            "Unexpected signer-frame request in WebAuthn fork test."
          )
        }
        const userOperationHash = getUserOperationHash({
          chainId: base.id,
          entryPointAddress: entryPoint07Address,
          entryPointVersion: "0.7",
          userOperation: {
            ...request.params.userOperation,
            signature: "0x"
          }
        })
        return {
          proposalHash: pad("0x", { size: 32 }),
          signature: await encodeSliceWalletSyntheticWebAuthnSignature({
            chainId: base.id,
            challenge: userOperationHash,
            key: key.privateKey,
            origin,
            rpId
          }),
          userOperationHash
        }
      }
    })
    const frameClient = createSessionFrameClient(sessionKey)
    const executionAccount = await createSliceWalletPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: registeredRootCredential,
      enableSignature,
      frameClient,
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "generic",
      session
    })

    const revokedSessionKey = await generateSliceWalletP256KeyPair()
    const revokedSession = {
      ...session,
      permissionId: getWalletPermissionId(policy, revokedSessionKey.signerId),
      publicKey: revokedSessionKey.publicKeyHex,
      signerId: revokedSessionKey.signerId
    } satisfies SliceWalletFrameSession
    const revokedEnableTypedData =
      await buildSliceWalletPermissionEnableTypedData({
        accountIndex: 0n,
        address: rootAccount.address,
        client: publicClient,
        credential: registeredRootCredential,
        session: revokedSession
      })
    const revokedEnableSignature = encodeWebAuthnValidatorSignature(
      await rootWebAuthnAccount.sign({
        hash: hashTypedData(
          revokedEnableTypedData as Parameters<typeof hashTypedData>[0]
        )
      })
    )
    const revokedExecutionAccount = await createSliceWalletPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: registeredRootCredential,
      enableSignature: revokedEnableSignature,
      frameClient: createSessionFrameClient(revokedSessionKey),
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "generic",
      session: revokedSession
    })

    const depositHash = await walletClient.writeContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      args: [rootAccount.address],
      functionName: "depositTo",
      value: parseEther("0.05")
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    const fees = await publicClient.estimateFeesPerGas()
    const buildUserOperation = async (
      calls: readonly { amount: bigint; spender: Address }[],
      account = executionAccount
    ) => {
      const { factory, factoryData } = await account.getFactoryArgs()
      const unsigned = {
        callData: await account.encodeCalls(
          calls.map(({ amount, spender }) => ({
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [spender, amount],
              functionName: "approve"
            }),
            to: usdcAddress,
            value: 0n
          }))
        ),
        callGasLimit: 500_000n,
        ...(factory === undefined ? {} : { factory }),
        ...(factoryData === undefined ? {} : { factoryData }),
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
        nonce: await account.getNonce(),
        preVerificationGas: 120_000n,
        sender: account.address,
        signature: "0x" as ViemHex,
        verificationGasLimit: 2_500_000n
      } satisfies UserOperation<"0.7">
      return {
        ...unsigned,
        signature: await account.signUserOperation({
          ...unsigned,
          chainId: base.id
        })
      } satisfies UserOperation<"0.7">
    }
    const submit = async (userOperation: UserOperation<"0.7">) => {
      const hash = await walletClient.writeContract({
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        args: [[toPackedUserOperation(userOperation)], bundlerAccount.address],
        functionName: "handleOps",
        gas: 7_000_000n
      })
      return publicClient.waitForTransactionReceipt({ hash })
    }

    const revocation = await buildSliceWalletPermissionRevocationCalls({
      account: rootAccount.address,
      client: publicClient,
      session: revokedSession
    })
    expect(revocation.revoked).toBe(false)
    expect(revocation.calls).toHaveLength(3)
    const rootFactory = await rootAccount.getFactoryArgs()
    const rootRevocationBase = {
      callData: await rootAccount.encodeCalls(revocation.calls),
      callGasLimit: 3_000_000n,
      ...rootFactory,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await rootAccount.getNonce(),
      preVerificationGas: 300_000n,
      sender: rootAccount.address,
      signature: "0x" as ViemHex,
      verificationGasLimit: 4_000_000n
    } satisfies UserOperation<"0.7">
    expect(
      (
        await submit({
          ...rootRevocationBase,
          signature: await rootAccount.signUserOperation({
            ...rootRevocationBase,
            chainId: base.id
          })
        })
      ).status
    ).toBe("success")
    await expect(
      buildSliceWalletPermissionRevocationCalls({
        account: rootAccount.address,
        client: publicClient,
        session: revokedSession
      })
    ).resolves.toMatchObject({ revoked: true })

    const revokedOperation = await buildUserOperation(
      [{ amount: 1n, spender: productsModuleAddress }],
      revokedExecutionAccount
    )
    const revokedError = await publicClient
      .simulateContract({
        account: bundlerAccount.address,
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: [
          [toPackedUserOperation(revokedOperation)],
          bundlerAccount.address
        ],
        gas: 7_000_000n
      })
      .then(
        () => null,
        (error: BaseError) => error
      )
    if (!(revokedError instanceof BaseError)) {
      throw new Error("Expected the burned permission enable proof to fail.")
    }
    const revokedErrorText = [
      revokedError.shortMessage,
      revokedError.details,
      revokedError.message
    ].join("\n")
    expect(
      entryPointFailedOpSelectors.some((selector) =>
        revokedErrorText.includes(selector)
      )
    ).toBe(true)
    expect(revokedErrorText).toContain("AA23")

    const forkBundlerUrl = process.env.KERNEL_PASSKEY_FORK_BUNDLER_URL
    if (forkBundlerUrl) {
      const estimate = await createBundlerClient({
        client: publicClient,
        transport: http(forkBundlerUrl)
      }).estimateUserOperationGas({
        account: executionAccount,
        calls: [
          {
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [productsModuleAddress, 321n],
              functionName: "approve"
            }),
            to: usdcAddress,
            value: 0n
          }
        ],
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1")
      })
      expect(estimate.verificationGasLimit > 0n).toBe(true)
    }

    expect(
      (
        await submit(
          await buildUserOperation([
            { amount: 320n, spender: productsModuleAddress },
            { amount: 321n, spender: productsModuleAddress }
          ])
        )
      ).status
    ).toBe("success")
    expect(
      await publicClient.readContract({
        abi: erc20Abi,
        address: usdcAddress,
        args: [executionAccount.address, productsModuleAddress],
        functionName: "allowance"
      })
    ).toBe(321n)
    const [, remainingRateLimit] = await publicClient.readContract({
      abi: [
        {
          inputs: [
            { name: "id", type: "bytes32" },
            { name: "account", type: "address" }
          ],
          name: "rateLimitConfigs",
          outputs: [
            { name: "interval", type: "uint48" },
            { name: "count", type: "uint48" },
            { name: "startAt", type: "uint48" }
          ],
          stateMutability: "view",
          type: "function"
        }
      ],
      address: getSliceWalletChainPolicy(base.id).contracts.rateLimitPolicy
        .address,
      args: [
        pad(session.permissionId, { dir: "right", size: 32 }),
        executionAccount.address
      ],
      functionName: "rateLimitConfigs"
    })
    expect(remainingRateLimit).toBe(9)
    expect(
      (
        await submit(
          await buildUserOperation([
            { amount: 1n, spender: productsModuleAddress },
            { amount: 1n, spender: recipient }
          ])
        )
      ).status
    ).toBe("reverted")
  }, 240_000)
})

runForkTests("Store management execution session Base fork", () => {
  it("executes only allowlisted calls while the member holds the required role", async () => {
    await installSlicerRegistryPolicyCode()
    const publicClient = createForkPublicClient()
    const testClient = createForkTestClient()
    const bundlerWalletClient = createForkWalletClient()
    const merchantWalletClient = createWalletClient({
      account: managementMerchantAccount,
      chain: base,
      transport: http(rpcUrl)
    })
    await testClient.setBalance({
      address: managementMerchantAccount.address,
      value: parseEther("10")
    })

    const sliceCoreAddress = getSliceCoreAddress(base.id)
    const productsModuleAddress = getProductsModuleAddress(base.id)
    const createSlicerHash = await merchantWalletClient.writeContract({
      address: sliceCoreAddress,
      abi: sliceCoreAbi,
      functionName: "slice",
      args: [
        {
          payees: [
            {
              account: managementMerchantAccount.address,
              shares: 1_000_000,
              transfersAllowedWhileLocked: false
            }
          ],
          minimumShares: 1n,
          currencies: [],
          releaseTimelock: 0n,
          transferTimelock: 0,
          controller: managementMerchantAccount.address,
          slicerFlags: 0,
          sliceCoreFlags: 0
        }
      ]
    })
    const createSlicerReceipt = await publicClient.waitForTransactionReceipt({
      hash: createSlicerHash
    })
    expect(createSlicerReceipt.status).toBe("success")
    const tokenSliced = parseEventLogs({
      abi: sliceCoreAbi,
      eventName: "TokenSliced",
      logs: createSlicerReceipt.logs
    })[0]
    if (!tokenSliced) throw new Error("TokenSliced event not found.")
    const slicerAddress = tokenSliced.args.slicerAddress
    const slicerId = tokenSliced.args.tokenId

    const managementPasskeyPrivateKey =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" satisfies ViemHex
    const managementCredentialId = Base64.fromBytes(
      Hex.toBytes("0x3132333435363738393a3b3c3d3e3f40"),
      { pad: false, url: true }
    )
    const credential = {
      id: managementCredentialId,
      publicKey: getPasskeyPublicKey(managementPasskeyPrivateKey)
    }
    const rootAccount = await createSliceKernelPasskeyAccount({
      client: publicClient,
      credential,
      getFn: createSyntheticWebAuthnGetFn(managementPasskeyPrivateKey),
      rpId
    })
    const sessionPrivateKey =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" satisfies ViemHex
    const sessionSignerAddress = privateKeyToAccount(sessionPrivateKey).address
    const startsAt = Math.floor(Date.now() / 1000) - 300
    const validUntil = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const enableTypedData = await buildSliceExecutionEnableTypedData({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential,
      mode: "store_management",
      sessionSignerAddress,
      startsAt,
      validUntil
    })
    const assertion = await toWebAuthnAccount({
      credential,
      getFn: createSyntheticWebAuthnGetFn(managementPasskeyPrivateKey),
      rpId
    }).sign({
      hash: hashTypedData(
        enableTypedData as Parameters<typeof hashTypedData>[0]
      )
    })
    const executionAccount = await createSliceExecutionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential,
      enableSignature: encodeWebAuthnValidatorSignature(assertion),
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "store_management",
      sessionPrivateKey,
      sessionSignerAddress,
      startsAt,
      validUntil
    })

    const createSecondSlicerHash = await merchantWalletClient.writeContract({
      address: sliceCoreAddress,
      abi: sliceCoreAbi,
      functionName: "slice",
      args: [
        {
          payees: [
            {
              account: executionAccount.address,
              shares: 1_000_000,
              transfersAllowedWhileLocked: false
            }
          ],
          minimumShares: 1n,
          currencies: [],
          releaseTimelock: 0n,
          transferTimelock: 0,
          controller: managementMerchantAccount.address,
          slicerFlags: 0,
          sliceCoreFlags: 0
        }
      ]
    })
    const createSecondSlicerReceipt =
      await publicClient.waitForTransactionReceipt({
        hash: createSecondSlicerHash
      })
    expect(createSecondSlicerReceipt.status).toBe("success")
    const secondTokenSliced = parseEventLogs({
      abi: sliceCoreAbi,
      eventName: "TokenSliced",
      logs: createSecondSlicerReceipt.logs
    })[0]
    if (!secondTokenSliced) throw new Error("TokenSliced event not found.")
    const secondSlicerAddress = secondTokenSliced.args.slicerAddress

    const depositHash = await bundlerWalletClient.writeContract({
      address: entryPoint07Address,
      abi: entryPoint07Abi,
      functionName: "depositTo",
      args: [executionAccount.address],
      value: parseEther("0.05")
    })
    expect(
      (await publicClient.waitForTransactionReceipt({ hash: depositHash }))
        .status
    ).toBe("success")

    const setExecutionRoles = async (
      target: Address,
      roles: Parameters<typeof rolesToMask>[0]
    ) => {
      const hash = await merchantWalletClient.writeContract({
        address: target,
        abi: slicerAbi,
        functionName: "setRoles",
        args: [maskToHex(rolesToMask(roles)), executionAccount.address]
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      expect(receipt.status).toBe("success")
    }
    const setProductManagerRole = (enabled: boolean) =>
      setExecutionRoles(
        slicerAddress,
        enabled ? [USER_ROLE.ProductManager] : []
      )

    type ManagementCalls = Parameters<typeof executionAccount.encodeCalls>[0]
    const productParams: AddProductParams["params"] = {
      subSlicerProducts: [],
      currencyPrices: [
        {
          value: 0n,
          packedBooleans: encodeCurrencyPriceBooleans(),
          currency: zeroAddress
        }
      ],
      pricingStrategies: [],
      actions: [],
      productMetadata: "0x",
      purchaseData: "0x",
      stockUnits: 100,
      categoryId: 0,
      productTypeId: 0,
      maxUnitsPerBuyer: 10,
      packedBooleans: encodeProductBooleans(),
      referralFeeProduct: 0n
    }
    const addProductCall = {
      to: productsModuleAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: productsModuleAbi,
        functionName: "addProduct",
        args: [slicerId, productParams, []]
      })
    } satisfies ManagementCalls[number]
    const buyCall = {
      to: productsModuleAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: productsModuleAbi,
        functionName: "buy",
        args: [executionAccount.address, [], [], zeroAddress, zeroAddress, []]
      })
    } satisfies ManagementCalls[number]
    const nestedBuyCall = {
      to: productsModuleAddress,
      value: 0n,
      data: encodeFunctionData({
        abi: productsModuleAbi,
        functionName: "multicall",
        args: [[buyCall.data]]
      })
    } satisfies ManagementCalls[number]
    const fees = await publicClient.estimateFeesPerGas()

    const buildUserOperation = async (
      calls: ManagementCalls,
      includeFactory: boolean
    ) => {
      const factoryArgs = includeFactory
        ? await executionAccount.getFactoryArgs()
        : {}
      const userOperationBase = {
        sender: executionAccount.address,
        nonce: await executionAccount.getNonce(),
        ...factoryArgs,
        callData: await executionAccount.encodeCalls(calls),
        callGasLimit: 2_000_000n,
        verificationGasLimit: includeFactory ? 4_000_000n : 2_000_000n,
        preVerificationGas: 250_000n,
        maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
        signature: "0x"
      } satisfies UserOperation<"0.7">

      return {
        ...userOperationBase,
        signature: await executionAccount.signUserOperation({
          ...userOperationBase,
          chainId: base.id
        })
      } satisfies UserOperation<"0.7">
    }
    const submitUserOperation = async (userOperation: UserOperation<"0.7">) => {
      const userOperationHash = getUserOperationHash({
        chainId: base.id,
        entryPointAddress: entryPoint07Address,
        entryPointVersion: "0.7",
        userOperation
      })
      const hash = await bundlerWalletClient.writeContract({
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: [[toPackedUserOperation(userOperation)], bundlerAccount.address],
        gas: 12_000_000n
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const event = parseEventLogs({
        abi: entryPoint07Abi,
        eventName: "UserOperationEvent",
        logs: receipt.logs
      }).find((candidate) => candidate.args.userOpHash === userOperationHash)
      if (!event) throw new Error("UserOperationEvent not found.")

      return { receipt, success: event.args.success, userOperationHash }
    }

    const expectPolicyRejected = async (calls: ManagementCalls) => {
      const operation = await buildUserOperation(calls, false)
      const error = await publicClient
        .simulateContract({
          account: bundlerAccount.address,
          address: entryPoint07Address,
          abi: entryPoint07Abi,
          functionName: "handleOps",
          args: [[toPackedUserOperation(operation)], bundlerAccount.address],
          gas: 12_000_000n
        })
        .then(
          () => null,
          (cause: BaseError) => cause
        )
      if (!(error instanceof BaseError)) {
        throw new Error("Expected the management policy to reject the call.")
      }
      const errorText = [error.shortMessage, error.details, error.message].join(
        "\n"
      )
      expect(
        entryPointFailedOpSelectors.some((selector) =>
          errorText.includes(selector)
        )
      ).toBe(true)
      expect(errorText).toContain("AA23")
    }
    const roleMutationCalls = (
      target: Address,
      account: Address
    ): ManagementCalls => {
      const rolesMask = maskToHex(rolesToMask([USER_ROLE.ProductManager]))
      return [
        {
          to: target,
          value: 0n,
          data: encodeFunctionData({
            abi: slicerAbi,
            functionName: "grantRoles",
            args: [rolesMask, account]
          })
        },
        {
          to: target,
          value: 0n,
          data: encodeFunctionData({
            abi: slicerAbi,
            functionName: "revokeRoles",
            args: [rolesMask, account]
          })
        },
        {
          to: target,
          value: 0n,
          data: encodeFunctionData({
            abi: slicerAbi,
            functionName: "setRoles",
            args: [rolesMask, account]
          })
        },
        {
          to: target,
          value: 0n,
          data: encodeFunctionData({
            abi: slicerAbi,
            functionName: "renounceRoles",
            args: [rolesMask]
          })
        }
      ]
    }
    const releaseCall = ({
      account,
      target,
      withdraw
    }: {
      account: Address
      target: Address
      withdraw: boolean
    }): ManagementCalls[number] => ({
      to: target,
      value: 0n,
      data: encodeFunctionData({
        abi: slicerAbi,
        functionName: "release",
        args: [account, zeroAddress, withdraw]
      })
    })
    const wildcardRelease = await submitUserOperation(
      await buildUserOperation(
        [
          releaseCall({
            account: executionAccount.address,
            target: secondSlicerAddress,
            withdraw: true
          })
        ],
        true
      )
    )
    expect(wildcardRelease.success).toBe(true)
    for (const roleMutation of roleMutationCalls(
      secondSlicerAddress,
      "0x1111111111111111111111111111111111111111"
    )) {
      await expectPolicyRejected([roleMutation])
    }
    await expectPolicyRejected([nestedBuyCall])
    await expectPolicyRejected([
      releaseCall({
        account: managementMerchantAccount.address,
        target: secondSlicerAddress,
        withdraw: true
      })
    ])
    await expectPolicyRejected([
      releaseCall({
        account: executionAccount.address,
        target: secondSlicerAddress,
        withdraw: false
      })
    ])

    await setProductManagerRole(true)
    const allowed = await submitUserOperation(
      await buildUserOperation([addProductCall], false)
    )
    expect(allowed.receipt.status).toBe("success")
    expect(allowed.success).toBe(true)
    expect(
      parseEventLogs({
        abi: productsModuleAbi,
        eventName: "ProductAdded",
        logs: allowed.receipt.logs
      }).some((event) => isAddressEqual(event.address, productsModuleAddress))
    ).toBe(true)

    await setProductManagerRole(false)
    const unauthorized = await submitUserOperation(
      await buildUserOperation([addProductCall], false)
    )
    expect(unauthorized.receipt.status).toBe("success")
    expect(unauthorized.success).toBe(false)
    const unauthorizedReason = parseEventLogs({
      abi: entryPoint07Abi,
      eventName: "UserOperationRevertReason",
      logs: unauthorized.receipt.logs
    }).find((event) => event.args.userOpHash === unauthorized.userOperationHash)
      ?.args.revertReason
    expect(unauthorizedReason).toStartWith("0x")

    const directAuthorizationError = await publicClient
      .call({
        account: executionAccount.address,
        data: addProductCall.data,
        to: productsModuleAddress
      })
      .then(
        () => null,
        (error: BaseError) => error
      )
    if (!(directAuthorizationError instanceof BaseError)) {
      throw new Error("Expected addProduct to reject the role-less member.")
    }
    expect(directAuthorizationError.message).toContain(
      keccak256(toBytes("NotAuthorized(bytes32)")).slice(2, 10)
    )

    const rejectedBuyOperation = await buildUserOperation([buyCall], false)
    const simulationError = await publicClient
      .simulateContract({
        account: bundlerAccount.address,
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: [
          [toPackedUserOperation(rejectedBuyOperation)],
          bundlerAccount.address
        ],
        gas: 12_000_000n
      })
      .then(
        () => null,
        (error: BaseError) => error
      )
    if (!(simulationError instanceof BaseError)) {
      throw new Error("Expected the management policy to reject buy.")
    }
    const simulationText = [
      simulationError.shortMessage,
      simulationError.details,
      simulationError.message
    ].join("\n")
    expect(
      entryPointFailedOpSelectors.some((selector) =>
        simulationText.includes(selector)
      )
    ).toBe(true)
    expect(simulationText).toContain("AA23")

    await setProductManagerRole(true)
    const { calls: uninstallCalls } =
      await buildStoreManagementPermissionUninstallCalls({
        account: rootAccount.address,
        client: publicClient,
        sessionSignerAddress,
        startsAt,
        validUntil
      })
    expect(uninstallCalls).toHaveLength(2)
    const rootUserOperationBase = {
      sender: rootAccount.address,
      nonce: await rootAccount.getNonce(),
      callData: await rootAccount.encodeCalls(uninstallCalls),
      callGasLimit: 2_000_000n,
      verificationGasLimit: 2_000_000n,
      preVerificationGas: 250_000n,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      signature: "0x"
    } satisfies UserOperation<"0.7">
    const uninstallOperation = {
      ...rootUserOperationBase,
      signature: await rootAccount.signUserOperation({
        ...rootUserOperationBase,
        chainId: base.id
      })
    } satisfies UserOperation<"0.7">
    const uninstalled = await submitUserOperation(uninstallOperation)
    expect(uninstalled.success).toBe(true)

    const disabledSession = await buildUserOperation([addProductCall], false)
    const disabledError = await publicClient
      .simulateContract({
        account: bundlerAccount.address,
        address: entryPoint07Address,
        abi: entryPoint07Abi,
        functionName: "handleOps",
        args: [
          [toPackedUserOperation(disabledSession)],
          bundlerAccount.address
        ],
        gas: 12_000_000n
      })
      .then(
        () => null,
        (error: BaseError) => error
      )
    if (!(disabledError instanceof BaseError)) {
      throw new Error("Expected the uninstalled management key to fail.")
    }
    const disabledErrorText = [
      disabledError.shortMessage,
      disabledError.details,
      disabledError.message
    ].join("\n")
    expect(
      entryPointFailedOpSelectors.some((selector) =>
        disabledErrorText.includes(selector)
      )
    ).toBe(true)
    expect(disabledErrorText).toContain("AA23")
  }, 240_000)
})
