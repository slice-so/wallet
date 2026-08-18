import { describe, expect, it } from "bun:test"
import {
  type AddProductParams,
  productsModuleAbi,
  sliceCoreAbi,
  slicerAbi
} from "@slicekit/abi"
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
  buildDeviceUninstallCalls,
  buildRecoveryCancelCall,
  buildRecoveryProposalUserOperation,
  buildRecoveryRotationCalls,
  buildRecoveryUserOperation,
  buildSliceWalletDeviceEnableTypedData,
  createDeployedRecoveryPermissionAccount,
  createSliceWalletDeviceKernelAccount,
  createSliceWalletPermissionAccount,
  createSliceWalletRegisteredKernelAccount,
  encodeSliceWalletSyntheticWebAuthnSignature,
  generateSliceWalletP256KeyPair,
  getRecoveryState,
  getSliceWalletCredentialIdHash,
  getSliceWalletRootValidatorPublicKey,
  hashSliceWalletWeightedP256CoSign,
  hashSliceWalletWeightedP256Proposal,
  parseSliceWalletUncompressedPublicKey,
  type SliceWalletSignerFrameClient,
  signSliceWalletP256,
  toSliceWalletDeviceSigner
} from "@slicekit/wallet"
import {
  buildSliceExecutionEnableTypedData,
  buildStoreManagementPermissionUninstallCalls,
  createSliceExecutionAccount
} from "@slicekit/wallet/execution"
import {
  buildRecoveryPermissionInitConfig,
  buildSliceWalletPermissionEnableTypedData,
  buildSliceWalletPermissionRevocationCalls,
  createErc20ApproveCallRule,
  getWalletPermissionId,
  predictSliceWalletKernelAccountAddress,
  type SliceWalletFrameSession,
  sliceKernelConfig,
  sliceWalletKernelAddresses
} from "@slicekit/wallet-primitives"
import {
  type Address,
  bytesToHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hashMessage,
  hashTypedData,
  hexToBytes,
  http,
  parseEther,
  parseEventLogs,
  parseGwei,
  sha256,
  stringToHex,
  zeroAddress
} from "viem"
import {
  createBundlerClient,
  entryPoint09Abi,
  entryPoint09Address,
  formatUserOperationRequest,
  getUserOperationHash,
  toPackedUserOperation,
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

const runForkTests = forkRpcUrl ? describe : describe.skip
const rpcUrl = forkRpcUrl ?? "http://127.0.0.1:8547"
const submitter = privateKeyToAccount(
  forkSubmitterPrivateKey
    ? (forkSubmitterPrivateKey as Hex)
    : generatePrivateKey()
)
const recipient = "0x0000000000000000000000000000000000008128" satisfies Address
const p256Precompile =
  "0x0000000000000000000000000000000000000100" satisfies Address
const soladyP256Verifier =
  "0x000000000000D01eA45F9eFD5c54f037Fa57Ea1a" satisfies Address
let accountSeed = 0
const kernelFactoryGetAddressAbi = [
  {
    inputs: [
      {
        components: [
          { name: "moduleType", type: "uint256" },
          { name: "module", type: "address" },
          { name: "moduleData", type: "bytes" },
          { name: "internalData", type: "bytes" }
        ],
        name: "packages",
        type: "tuple[]"
      },
      { name: "nonce", type: "uint256" }
    ],
    name: "getAddress",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "view",
    type: "function"
  }
] as const
const recoveryGas = {
  callGasLimit: 800_000n,
  maxFeePerGas: parseGwei("1"),
  maxPriorityFeePerGas: parseGwei("0.1"),
  preVerificationGas: 160_000n,
  verificationGasLimit: 2_500_000n
} as const

const createForkPublicClient = () =>
  createPublicClient({ chain: base, transport: http(rpcUrl) })

const createForkWalletClient = () =>
  createWalletClient({
    account: submitter,
    chain: base,
    transport: http(rpcUrl)
  })

const createForkAccount = async () => {
  accountSeed += 1
  const keyPair = await generateSliceWalletP256KeyPair()
  const recovery = await buildRecoveryPermissionInitConfig({
    recoverySignerAddress: submitter.address
  })
  const credential = {
    credentialIdHash: sha256(
      stringToHex(`slice-kernel-v4-fork-root-${accountSeed}`)
    ),
    publicKey: keyPair.publicKeyHex
  }
  const account = await createSliceWalletRegisteredKernelAccount({
    chainId: base.id,
    client: createForkPublicClient(),
    credential,
    initConfig: recovery.initConfig,
    rootSigner: (challenge) =>
      encodeSliceWalletSyntheticWebAuthnSignature({
        chainId: base.id,
        challenge,
        key: keyPair.privateKey,
        origin: "https://id.slice.so",
        rpId: "id.slice.so",
        usePrecompiled: false
      })
  })
  return { account, credential, keyPair }
}

type ForkAccount = Awaited<
  ReturnType<typeof createSliceWalletRegisteredKernelAccount>
>
type ForkCalls = Parameters<ForkAccount["encodeCalls"]>[0]
type OperationAccount = Pick<
  ForkAccount,
  "address" | "encodeCalls" | "getNonce" | "signUserOperation"
>

const depositToEntryPoint = async (account: Address) => {
  const hash = await createForkWalletClient().writeContract({
    abi: entryPoint09Abi,
    address: entryPoint09Address,
    args: [account],
    functionName: "depositTo",
    value: parseEther("0.08")
  })
  await createForkPublicClient().waitForTransactionReceipt({ hash })
}

const installP256PrecompileFallback = async () => {
  const client = createForkPublicClient()
  const currentCode = await client.getCode({ address: p256Precompile })
  if (currentCode !== undefined && currentCode !== "0x") return
  const bytecode = await client.getCode({ address: soladyP256Verifier })
  if (bytecode === undefined || bytecode === "0x") {
    throw new Error("Base P-256 verifier bytecode is unavailable on the fork.")
  }
  await createTestClient({
    chain: base,
    mode: "anvil",
    transport: http(rpcUrl)
  }).setCode({ address: p256Precompile, bytecode })
}

const buildUserOperation = async ({
  account,
  calls,
  factoryArgs = {}
}: {
  account: OperationAccount
  calls: ForkCalls
  factoryArgs?: Awaited<ReturnType<ForkAccount["getFactoryArgs"]>>
}) => {
  const fees = await createForkPublicClient().estimateFeesPerGas()
  const unsigned = {
    callData: await account.encodeCalls(calls),
    callGasLimit: 2_000_000n,
    ...factoryArgs,
    maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
    nonce: await account.getNonce(),
    preVerificationGas: 250_000n,
    sender: account.address,
    signature: "0x" as Hex,
    verificationGasLimit:
      factoryArgs.factory === undefined ? 2_000_000n : 4_000_000n
  } satisfies UserOperation<"0.9">
  return {
    ...unsigned,
    signature: await account.signUserOperation({
      ...unsigned,
      chainId: base.id
    })
  } satisfies UserOperation<"0.9">
}

const submitUserOperation = async (userOperation: UserOperation<"0.9">) => {
  const userOperationHash = getUserOperationHash({
    chainId: base.id,
    entryPointAddress: entryPoint09Address,
    entryPointVersion: "0.9",
    userOperation
  })
  const hash = await createForkWalletClient().writeContract({
    abi: entryPoint09Abi,
    address: entryPoint09Address,
    args: [[toPackedUserOperation(userOperation)], submitter.address],
    functionName: "handleOps",
    gas: 10_000_000n
  })
  const receipt = await createForkPublicClient().waitForTransactionReceipt({
    hash
  })
  const event = parseEventLogs({
    abi: entryPoint09Abi,
    eventName: "UserOperationEvent",
    logs: receipt.logs
  }).find((candidate) => candidate.args.userOpHash === userOperationHash)
  if (event === undefined) {
    throw new Error("Kernel v4 UserOperationEvent was not emitted.")
  }
  return event.args.success
}

const submitBundledUserOperation = async (
  userOperation: UserOperation<"0.9">
) => {
  const bundlerUrl = process.env.KERNEL_PASSKEY_FORK_BUNDLER_URL
  if (bundlerUrl === undefined) {
    throw new Error("KERNEL_PASSKEY_FORK_BUNDLER_URL is required.")
  }
  const bundlerClient = createBundlerClient({
    client: createForkPublicClient(),
    transport: http(bundlerUrl)
  })
  const hash = await bundlerClient.request(
    {
      method: "eth_sendUserOperation",
      params: [formatUserOperationRequest(userOperation), entryPoint09Address]
    },
    { retryCount: 0 }
  )
  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash,
    pollingInterval: 250,
    timeout: 60_000
  })
  return receipt.success
}

runForkTests("KernelUUPS v4 Base fork", () => {
  it("seeds the exact v4 release and EntryPoint v0.9 artifacts", async () => {
    const client = createForkPublicClient()
    expect(sliceKernelConfig).toMatchObject({
      entryPoint: entryPoint09Address,
      entryPointVersion: "0.9",
      version: "4.0"
    })
    for (const address of [
      entryPoint09Address,
      sliceWalletKernelAddresses.factory,
      sliceWalletKernelAddresses.implementation,
      sliceWalletKernelAddresses.staker,
      sliceWalletKernelAddresses.webAuthnRootValidator
    ]) {
      expect(await client.getCode({ address })).not.toBe("0x")
    }
  })

  it("derives the same official KernelFactory deployment from both APIs", async () => {
    const { account, credential } = await createForkAccount()
    const factoryAccount = await createForkPublicClient().readContract({
      abi: kernelFactoryGetAddressAbi,
      address: sliceWalletKernelAddresses.factory,
      args: [account.initialPackages, 0n],
      functionName: "getAddress"
    })
    const factoryArgs = await account.getFactoryArgs()
    expect(factoryArgs.factory?.toLowerCase()).toBe(
      sliceWalletKernelAddresses.factory.toLowerCase()
    )
    expect(factoryArgs.factoryData).toStartWith("0x")
    const predicted = await predictSliceWalletKernelAccountAddress({
      chainId: base.id,
      credential,
      recoverySignerAddress: submitter.address
    })
    expect(predicted).toBe(account.address)
    expect(factoryAccount).toBe(account.address)
  })

  it("deploys and executes a passkey-root operation through EntryPoint v0.9", async () => {
    const publicClient = createForkPublicClient()
    const walletClient = createForkWalletClient()
    const { account } = await createForkAccount()
    const { factory, factoryData } = await account.getFactoryArgs()
    const recipientBalanceBefore = await publicClient.getBalance({
      address: recipient
    })

    const depositHash = await walletClient.writeContract({
      abi: entryPoint09Abi,
      address: entryPoint09Address,
      args: [account.address],
      functionName: "depositTo",
      value: parseEther("0.05")
    })
    await publicClient.waitForTransactionReceipt({ hash: depositHash })
    const fundingHash = await walletClient.sendTransaction({
      to: account.address,
      value: parseEther("0.01")
    })
    await publicClient.waitForTransactionReceipt({ hash: fundingHash })

    const fees = await publicClient.estimateFeesPerGas()
    const unsigned = {
      callData: await account.encodeCalls([
        { data: "0x", to: recipient, value: 1n }
      ]),
      callGasLimit: 500_000n,
      factory,
      factoryData,
      maxFeePerGas: fees.maxFeePerGas ?? parseGwei("1"),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? parseGwei("0.1"),
      nonce: await account.getNonce(),
      preVerificationGas: 160_000n,
      sender: account.address,
      signature: "0x" as Hex,
      verificationGasLimit: 2_500_000n
    } satisfies UserOperation<"0.9">
    const userOperation = {
      ...unsigned,
      signature: await account.signUserOperation(unsigned)
    } satisfies UserOperation<"0.9">
    const adapterHash = getUserOperationHash({
      chainId: base.id,
      entryPointAddress: entryPoint09Address,
      entryPointVersion: "0.9",
      userOperation
    })
    const entryPointHash = await publicClient.readContract({
      abi: entryPoint09Abi,
      address: entryPoint09Address,
      args: [toPackedUserOperation(userOperation)],
      functionName: "getUserOpHash"
    })
    expect(adapterHash).toBe(entryPointHash)
    const transactionHash = await walletClient.writeContract({
      abi: entryPoint09Abi,
      address: entryPoint09Address,
      args: [[toPackedUserOperation(userOperation)], submitter.address],
      functionName: "handleOps",
      gas: 6_000_000n
    })
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash
    })

    expect(receipt.status).toBe("success")
    expect(await publicClient.getCode({ address: account.address })).not.toBe(
      "0x"
    )
    expect(
      (await publicClient.getBalance({ address: recipient })) -
        recipientBalanceBefore
    ).toBe(1n)
  })

  it("verifies an undeployed account message through ERC-6492", async () => {
    const publicClient = createForkPublicClient()
    const { account } = await createForkAccount()
    const message = "Slice Kernel v4 delegation"
    await expect(
      publicClient.verifyMessage({
        address: account.address,
        message,
        signature: await account.signMessage({ message })
      })
    ).resolves.toBe(true)
  })

  it("enables and uninstalls a SudoPolicy device permission", async () => {
    const publicClient = createForkPublicClient()
    const {
      account: rootAccount,
      credential: rootCredential,
      keyPair
    } = await createForkAccount()
    const deviceKey = await generateSliceWalletP256KeyPair()
    const deviceCredential = {
      credentialIdHash: sha256(
        stringToHex(`slice-kernel-v4-device-${accountSeed}`)
      ),
      publicKey: deviceKey.publicKeyHex
    }
    const signDeviceChallenge = (challenge: Hex) =>
      encodeSliceWalletSyntheticWebAuthnSignature({
        chainId: base.id,
        challenge,
        key: deviceKey.privateKey,
        origin: "https://id.slice.so",
        rpId: "id.slice.so",
        usePrecompiled: false
      })
    const deviceSigner = toSliceWalletDeviceSigner({
      account: toAccount({
        address: zeroAddress,
        signMessage: ({ message }) =>
          signDeviceChallenge(
            typeof message === "string"
              ? hashMessage(message)
              : typeof message.raw === "string"
                ? message.raw
                : bytesToHex(message.raw)
          ),
        signTransaction: async () => {
          throw new Error("Device permissions cannot sign transactions.")
        },
        signTypedData: (typedData) =>
          signDeviceChallenge(hashTypedData(typedData))
      }),
      credential: deviceCredential
    })
    const enableTypedData = await buildSliceWalletDeviceEnableTypedData({
      account: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: deviceCredential,
      signer: deviceSigner
    })
    const enableSignature = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId: base.id,
      challenge: hashTypedData(enableTypedData),
      key: keyPair.privateKey,
      origin: "https://id.slice.so",
      rpId: "id.slice.so",
      usePrecompiled: false
    })
    const deviceAccount = await createSliceWalletDeviceKernelAccount({
      account: rootAccount.address,
      accountIndex: 0n,
      chainId: base.id,
      client: publicClient,
      credential: deviceCredential,
      enableSignature,
      rootCredential,
      signer: deviceSigner
    })

    await depositToEntryPoint(rootAccount.address)
    const enableOperation = await buildUserOperation({
      account: deviceAccount,
      calls: [{ data: "0x", to: recipient, value: 0n }],
      factoryArgs: await rootAccount.getFactoryArgs()
    })
    expect(enableOperation.nonce >> 248n).toBe(8n)
    expect(await submitUserOperation(enableOperation)).toBe(true)

    const uninstall = await buildDeviceUninstallCalls({
      account: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      credential: deviceCredential,
      signer: deviceSigner
    })
    expect(uninstall.calls).toHaveLength(2)
    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: rootAccount,
          calls: uninstall.calls
        })
      )
    ).toBe(true)
    await expect(
      buildDeviceUninstallCalls({
        account: rootAccount.address,
        chainId: base.id,
        client: publicClient,
        credential: deviceCredential,
        signer: deviceSigner
      })
    ).resolves.toMatchObject({ calls: [] })
  }, 240_000)

  it("cancels and executes root rotation through the recovery timelock", async () => {
    const publicClient = createForkPublicClient()
    const testClient = createTestClient({
      chain: base,
      mode: "anvil",
      transport: http(rpcUrl)
    })
    const rootKey = await generateSliceWalletP256KeyPair()
    const recoveryKey = generatePrivateKey()
    const recoverySigner = privateKeyToAccount(recoveryKey)
    const rootCredential = {
      credentialIdHash: sha256(
        stringToHex(`slice-kernel-v4-recovery-root-${accountSeed}`)
      ),
      publicKey: rootKey.publicKeyHex
    }
    const recoveryTimelock = { delaySec: 2, expirationSec: 120 }
    const recoveryInit = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: recoverySigner.address,
      recoveryTimelock
    })
    const rootAccount = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client: publicClient,
      credential: rootCredential,
      initConfig: recoveryInit.initConfig,
      rootSigner: (challenge) =>
        encodeSliceWalletSyntheticWebAuthnSignature({
          chainId: base.id,
          challenge,
          key: rootKey.privateKey,
          origin: "https://id.slice.so",
          rpId: "id.slice.so",
          usePrecompiled: false
        })
    })
    await depositToEntryPoint(rootAccount.address)
    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: rootAccount,
          calls: [{ data: "0x", to: recipient, value: 0n }],
          factoryArgs: await rootAccount.getFactoryArgs()
        })
      )
    ).toBe(true)

    const recoveryAccount = await createDeployedRecoveryPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      chainId: base.id,
      client: publicClient,
      recoveryPrivateKey: recoveryKey,
      recoverySignerAddress: recoverySigner.address,
      recoveryTimelock
    })
    expect(recoveryAccount.recoveryPermissionId).toBe(recoveryInit.permissionId)
    const newRootKey = await generateSliceWalletP256KeyPair()
    const newCredential = {
      credentialIdHash: sha256(
        stringToHex(`slice-kernel-v4-recovery-new-${accountSeed}`)
      ),
      publicKey: newRootKey.publicKeyHex
    }
    const calls = buildRecoveryRotationCalls(newCredential)
    const callData = await recoveryAccount.encodeCalls(calls)
    const firstNonce = (await recoveryAccount.getNonce()) + 1n
    expect(
      await submitUserOperation(
        await buildRecoveryProposalUserOperation({
          account: recoveryAccount,
          callData,
          chainId: base.id,
          gas: recoveryGas,
          nonce: firstNonce
        })
      )
    ).toBe(true)
    await expect(
      getRecoveryState({
        account: rootAccount.address,
        callData,
        client: publicClient,
        nonce: firstNonce,
        permissionId: recoveryAccount.recoveryPermissionId
      })
    ).resolves.toMatchObject({ status: "pending" })

    await expect(
      submitUserOperation(
        await buildRecoveryUserOperation({
          account: recoveryAccount,
          calls,
          chainId: base.id,
          gas: recoveryGas
        })
      )
    ).rejects.toThrow()
    expect(
      await submitUserOperation(
        await buildRecoveryUserOperation({
          account: rootAccount,
          calls: [
            buildRecoveryCancelCall({
              account: rootAccount.address,
              callData,
              nonce: firstNonce,
              permissionId: recoveryAccount.recoveryPermissionId
            })
          ],
          chainId: base.id,
          gas: recoveryGas
        })
      )
    ).toBe(true)
    await expect(
      getRecoveryState({
        account: rootAccount.address,
        callData,
        client: publicClient,
        nonce: firstNonce,
        permissionId: recoveryAccount.recoveryPermissionId
      })
    ).resolves.toMatchObject({ status: "cancelled" })

    const secondNonce = (await recoveryAccount.getNonce()) + 1n
    expect(
      await submitUserOperation(
        await buildRecoveryProposalUserOperation({
          account: recoveryAccount,
          callData,
          chainId: base.id,
          gas: recoveryGas,
          nonce: secondNonce
        })
      )
    ).toBe(true)
    await testClient.increaseTime({ seconds: recoveryTimelock.delaySec + 1 })
    await testClient.mine({ blocks: 1 })
    expect(
      await submitUserOperation(
        await buildRecoveryUserOperation({
          account: recoveryAccount,
          calls,
          chainId: base.id,
          gas: recoveryGas
        })
      )
    ).toBe(true)
    await expect(
      getRecoveryState({
        account: rootAccount.address,
        callData,
        client: publicClient,
        nonce: secondNonce,
        permissionId: recoveryAccount.recoveryPermissionId
      })
    ).resolves.toMatchObject({ status: "executed" })
    expect(
      await getSliceWalletRootValidatorPublicKey({
        account: rootAccount.address,
        chainId: base.id,
        client: publicClient
      })
    ).toEqual(parseSliceWalletUncompressedPublicKey(newCredential.publicKey))
  }, 300_000)

  it("estimates WeightedP256Signer operations and enforces their call policy", async () => {
    const publicClient = createForkPublicClient()
    await installP256PrecompileFallback()
    const {
      account: rootAccount,
      credential: rootCredential,
      keyPair
    } = await createForkAccount()
    const sessionKey = await generateSliceWalletP256KeyPair()
    const coSigner = privateKeyToAccount(generatePrivateKey())
    const productsModule = getProductsModuleAddress(base.id)
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" satisfies Address
    const validUntil =
      Number((await publicClient.getBlock()).timestamp) + 86_400
    const policy = {
      account: rootAccount.address,
      calls: [
        createErc20ApproveCallRule({
          maximumAmount: 123n,
          spender: productsModule,
          token: usdc
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
        allowanceUsdMicros: "1000000",
        coSignerAddress: coSigner.address
      },
      expiresAt: validUntil,
      grantKind: "checkout",
      permissionId: getWalletPermissionId(policy, sessionKey.signerId),
      policy,
      publicKey: sessionKey.publicKeyHex,
      signerId: sessionKey.signerId
    } satisfies SliceWalletFrameSession
    const enableTypedData = await buildSliceWalletPermissionEnableTypedData({
      address: rootAccount.address,
      client: publicClient,
      session
    })
    const enableSignature = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId: base.id,
      challenge: hashTypedData(enableTypedData),
      key: keyPair.privateKey,
      origin: "https://id.slice.so",
      rpId: "id.slice.so",
      usePrecompiled: false
    })
    const getProposal = ({
      callData,
      nonce,
      sender
    }: {
      callData: Hex
      nonce: bigint
      sender: Address
    }) =>
      hashSliceWalletWeightedP256Proposal({
        account: sender,
        callData,
        chainId: base.id,
        nonce,
        permissionId: session.permissionId,
        validUntil
      })
    const frameClient: SliceWalletSignerFrameClient = {
      destroy: () => {},
      request: async (request) => {
        if (request.method === "signCheckoutProposal") {
          const proposalHash = getProposal(request.params)
          return {
            proposalHash,
            signature: await signSliceWalletP256({
              key: sessionKey.privateKey,
              message: hexToBytes(proposalHash)
            })
          }
        }
        if (request.method === "signCoSignRequest") {
          const userOperationHash = getUserOperationHash({
            chainId: base.id,
            entryPointAddress: entryPoint09Address,
            entryPointVersion: "0.9",
            userOperation: { ...request.params.userOperation, signature: "0x" }
          })
          const proposalHash = getProposal(request.params.userOperation)
          const signature = await signSliceWalletP256({
            key: sessionKey.privateKey,
            message: hexToBytes(proposalHash)
          })
          return {
            proofSignature: signature,
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
            entryPointAddress: entryPoint09Address,
            entryPointVersion: "0.9",
            userOperation: { ...input.userOperation, signature: "0x" }
          })
          const proposalHash = getProposal(input.userOperation)
          return {
            coSignature: await coSigner.sign({
              hash: hashSliceWalletWeightedP256CoSign({
                chainId: base.id,
                userOperationHash,
                validUntil: input.validUntil
              })
            }),
            proposalHash,
            remainingUsdMicros: "999877",
            userOperationHash,
            validUntil: input.validUntil
          }
        },
        createChallenge: async () => ({
          challenge: sha256(stringToHex("slice-weighted-p256-fork")),
          challengeExpiresAt: validUntil,
          challengeIssuedAt: validUntil - 120,
          validUntil,
          windowEndExclusive: validUntil + 1,
          windowId: "lifetime",
          windowStart: 0
        })
      },
      client: publicClient,
      credential: rootCredential,
      delegationId: "kernel-v4-weighted-p256",
      enableSignature,
      frameClient,
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "checkout",
      session
    })
    const approveCall = (spender: Address): ForkCalls[number] => ({
      data: encodeFunctionData({
        abi: erc20Abi,
        args: [spender, 123n],
        functionName: "approve"
      }),
      to: usdc,
      value: 0n
    })

    await depositToEntryPoint(rootAccount.address)
    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: rootAccount,
          calls: [{ data: "0x", to: recipient, value: 0n }],
          factoryArgs: await rootAccount.getFactoryArgs()
        })
      )
    ).toBe(true)
    const bundlerUrl = process.env.KERNEL_PASSKEY_FORK_BUNDLER_URL
    if (bundlerUrl === undefined) {
      throw new Error("KERNEL_PASSKEY_FORK_BUNDLER_URL is required.")
    }
    const estimate = await createBundlerClient({
      client: publicClient,
      transport: http(bundlerUrl)
    }).estimateUserOperationGas({
      account: executionAccount,
      calls: [approveCall(productsModule)]
    })
    expect(estimate.verificationGasLimit).toBeGreaterThan(0n)
    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: executionAccount,
          calls: [approveCall(productsModule)],
          factoryArgs: await executionAccount.getFactoryArgs()
        })
      )
    ).toBe(true)
    await expect(
      publicClient.readContract({
        abi: erc20Abi,
        address: usdc,
        args: [rootAccount.address, productsModule],
        functionName: "allowance"
      })
    ).resolves.toBe(123n)
    await expect(
      submitUserOperation(
        await buildUserOperation({
          account: executionAccount,
          calls: [approveCall(recipient)]
        })
      )
    ).rejects.toThrow()
  }, 300_000)

  it("permanently revokes a never-used lazy permission", async () => {
    const publicClient = createForkPublicClient()
    await installP256PrecompileFallback()
    const {
      account: rootAccount,
      credential: rootCredential,
      keyPair
    } = await createForkAccount()
    const sessionKey = await generateSliceWalletP256KeyPair()
    const productsModule = getProductsModuleAddress(base.id)
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" satisfies Address
    const blockTimestamp = Number((await publicClient.getBlock()).timestamp)
    const policy = {
      account: rootAccount.address,
      calls: [
        createErc20ApproveCallRule({
          maximumAmount: 321n,
          spender: productsModule,
          token: usdc
        })
      ],
      chainId: base.id,
      grantKind: "generic",
      rateLimit: { count: 10, intervalSec: 60 },
      validAfter: blockTimestamp - 60,
      validUntil: blockTimestamp + 86_400,
      version: 1
    } as const
    const session = {
      account: rootAccount.address,
      chainId: base.id,
      expiresAt: policy.validUntil,
      grantKind: "generic",
      permissionId: getWalletPermissionId(policy, sessionKey.signerId),
      policy,
      publicKey: sessionKey.publicKeyHex,
      signerId: sessionKey.signerId
    } satisfies SliceWalletFrameSession
    const enableTypedData = await buildSliceWalletPermissionEnableTypedData({
      address: rootAccount.address,
      client: publicClient,
      session
    })
    const enableSignature = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId: base.id,
      challenge: hashTypedData(enableTypedData),
      key: keyPair.privateKey,
      origin: "https://id.slice.so",
      rpId: "id.slice.so",
      usePrecompiled: false
    })
    const frameClient: SliceWalletSignerFrameClient = {
      destroy: () => {},
      request: async (request) => {
        if (request.method !== "signScopedUserOperation") {
          throw new Error("Unexpected signer-frame request in fork test.")
        }
        const userOperationHash = getUserOperationHash({
          chainId: base.id,
          entryPointAddress: entryPoint09Address,
          entryPointVersion: "0.9",
          userOperation: { ...request.params.userOperation, signature: "0x" }
        })
        return {
          proposalHash: `0x${"00".repeat(32)}` as Hex,
          signature: await encodeSliceWalletSyntheticWebAuthnSignature({
            chainId: base.id,
            challenge: userOperationHash,
            key: sessionKey.privateKey,
            origin: "https://id.slice.so",
            rpId: "id.slice.so",
            usePrecompiled: false
          }),
          userOperationHash
        }
      }
    }
    const permissionAccount = await createSliceWalletPermissionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: rootCredential,
      enableSignature,
      frameClient,
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "generic",
      session
    })
    const revocation = await buildSliceWalletPermissionRevocationCalls({
      account: rootAccount.address,
      client: publicClient,
      enableNonce: enableTypedData.message.nonce,
      session
    })
    expect(revocation.revoked).toBe(false)
    expect(revocation.calls).toHaveLength(1)
    await createTestClient({
      chain: base,
      mode: "anvil",
      transport: http(rpcUrl)
    }).setBalance({
      address: rootAccount.address,
      value: parseEther("10")
    })
    expect(
      await submitBundledUserOperation(
        await buildUserOperation({
          account: rootAccount,
          calls: revocation.calls,
          factoryArgs: await rootAccount.getFactoryArgs()
        })
      )
    ).toBe(true)
    await expect(
      buildSliceWalletPermissionRevocationCalls({
        account: rootAccount.address,
        client: publicClient,
        enableNonce: enableTypedData.message.nonce,
        session
      })
    ).resolves.toMatchObject({ calls: [], revoked: true })

    const secondSessionKey = await generateSliceWalletP256KeyPair()
    const secondSession = {
      ...session,
      permissionId: getWalletPermissionId(policy, secondSessionKey.signerId),
      publicKey: secondSessionKey.publicKeyHex,
      signerId: secondSessionKey.signerId
    } satisfies SliceWalletFrameSession
    const secondEnableTypedData =
      await buildSliceWalletPermissionEnableTypedData({
        address: rootAccount.address,
        client: publicClient,
        session: secondSession
      })
    expect(secondEnableTypedData.message.nonce).toBe(1n)
    const secondRevocation = await buildSliceWalletPermissionRevocationCalls({
      account: rootAccount.address,
      client: publicClient,
      enableNonce: secondEnableTypedData.message.nonce,
      session: secondSession
    })
    expect(secondRevocation).toMatchObject({ revoked: false })
    expect(secondRevocation.calls).toHaveLength(1)
    expect(
      await submitBundledUserOperation(
        await buildUserOperation({
          account: rootAccount,
          calls: secondRevocation.calls
        })
      )
    ).toBe(true)
    await expect(
      buildSliceWalletPermissionRevocationCalls({
        account: rootAccount.address,
        client: publicClient,
        enableNonce: secondEnableTypedData.message.nonce,
        session: secondSession
      })
    ).resolves.toMatchObject({ calls: [], revoked: true })
    await expect(
      submitUserOperation(
        await buildUserOperation({
          account: permissionAccount,
          calls: [
            {
              data: encodeFunctionData({
                abi: erc20Abi,
                args: [productsModule, 321n],
                functionName: "approve"
              }),
              to: usdc,
              value: 0n
            }
          ]
        })
      )
    ).rejects.toThrow()
  }, 240_000)

  it("executes store management only while the session holds its role", async () => {
    const publicClient = createForkPublicClient()
    const walletClient = createForkWalletClient()
    const sliceCore = getSliceCoreAddress(base.id)
    const productsModule = getProductsModuleAddress(base.id)
    const createSlicerHash = await walletClient.writeContract({
      abi: sliceCoreAbi,
      address: sliceCore,
      args: [
        {
          controller: submitter.address,
          currencies: [],
          minimumShares: 1n,
          payees: [
            {
              account: submitter.address,
              shares: 1_000_000,
              transfersAllowedWhileLocked: false
            }
          ],
          releaseTimelock: 0n,
          sliceCoreFlags: 0,
          slicerFlags: 0,
          transferTimelock: 0
        }
      ],
      functionName: "slice"
    })
    const createSlicerReceipt = await publicClient.waitForTransactionReceipt({
      hash: createSlicerHash
    })
    const tokenSliced = parseEventLogs({
      abi: sliceCoreAbi,
      eventName: "TokenSliced",
      logs: createSlicerReceipt.logs
    })[0]
    if (tokenSliced === undefined) {
      throw new Error("TokenSliced event was not emitted.")
    }
    const { slicerAddress, tokenId: slicerId } = tokenSliced.args
    const rootKey = await generateSliceWalletP256KeyPair()
    const credentialId = "ERITFBUWFxgZGhscHQ"
    const browserCredential = {
      id: credentialId,
      publicKey: rootKey.publicKeyHex
    }
    const registeredCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(credentialId),
      publicKey: rootKey.publicKeyHex
    }
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: submitter.address
    })
    const rootAccount = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client: publicClient,
      credential: registeredCredential,
      initConfig: recovery.initConfig,
      rootSigner: (challenge) =>
        encodeSliceWalletSyntheticWebAuthnSignature({
          chainId: base.id,
          challenge,
          key: rootKey.privateKey,
          origin: "https://id.slice.so",
          rpId: "id.slice.so",
          usePrecompiled: false
        })
    })
    const sessionPrivateKey = generatePrivateKey()
    const sessionSignerAddress = privateKeyToAccount(sessionPrivateKey).address
    const timestamp = Number((await publicClient.getBlock()).timestamp)
    const startsAt = timestamp - 60
    const validUntil = timestamp + 86_400
    const enableTypedData = await buildSliceExecutionEnableTypedData({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: browserCredential,
      mode: "store_management",
      sessionSignerAddress,
      startsAt,
      validUntil
    })
    const executionAccount = await createSliceExecutionAccount({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      credential: browserCredential,
      enableSignature: await encodeSliceWalletSyntheticWebAuthnSignature({
        chainId: base.id,
        challenge: hashTypedData(enableTypedData),
        key: rootKey.privateKey,
        origin: "https://id.slice.so",
        rpId: "id.slice.so",
        usePrecompiled: false
      }),
      getFactoryArgs: () => rootAccount.getFactoryArgs(),
      mode: "store_management",
      sessionPrivateKey,
      sessionSignerAddress,
      startsAt,
      validUntil
    })
    const productManagerMask = maskToHex(
      rolesToMask([USER_ROLE.ProductManager])
    )
    const setRole = async (enabled: boolean) => {
      const hash = await walletClient.writeContract({
        abi: slicerAbi,
        address: slicerAddress,
        args: [
          enabled ? productManagerMask : (`0x${"00".repeat(32)}` as Hex),
          rootAccount.address
        ],
        functionName: "setRoles"
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }
    const productParams: AddProductParams["params"] = {
      actions: [],
      categoryId: 0,
      currencyPrices: [
        {
          currency: zeroAddress,
          packedBooleans: encodeCurrencyPriceBooleans(),
          value: 0n
        }
      ],
      maxUnitsPerBuyer: 10,
      packedBooleans: encodeProductBooleans(),
      pricingStrategies: [],
      productMetadata: "0x",
      productTypeId: 0,
      purchaseData: "0x",
      referralFeeProduct: 0n,
      stockUnits: 100,
      subSlicerProducts: []
    }
    const addProductCall = {
      data: encodeFunctionData({
        abi: productsModuleAbi,
        args: [slicerId, productParams, []],
        functionName: "addProduct"
      }),
      to: productsModule,
      value: 0n
    } satisfies ForkCalls[number]

    await setRole(true)
    await depositToEntryPoint(rootAccount.address)
    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: executionAccount,
          calls: [addProductCall],
          factoryArgs: await executionAccount.getFactoryArgs()
        })
      )
    ).toBe(true)
    await setRole(false)
    const unauthorized = await submitUserOperation(
      await buildUserOperation({
        account: executionAccount,
        calls: [addProductCall]
      })
    ).catch(() => false)
    expect(unauthorized).toBe(false)

    await setRole(true)
    const uninstall = await buildStoreManagementPermissionUninstallCalls({
      account: rootAccount.address,
      client: publicClient,
      sessionSignerAddress,
      startsAt,
      validUntil
    })
    expect(uninstall.calls.length).toBeGreaterThan(1)
    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: rootAccount,
          calls: uninstall.calls
        })
      )
    ).toBe(true)
    await expect(
      submitUserOperation(
        await buildUserOperation({
          account: executionAccount,
          calls: [addProductCall]
        })
      )
    ).rejects.toThrow()
  }, 300_000)

  it("requires both checkout session and policy co-signatures", async () => {
    const publicClient = createForkPublicClient()
    const rootKey = await generateSliceWalletP256KeyPair()
    const credentialId = "AQIDBAUGBwgJCgsMDQ"
    const credential = {
      id: credentialId,
      publicKey: rootKey.publicKeyHex
    }
    const registeredCredential = {
      credentialIdHash: getSliceWalletCredentialIdHash(credentialId),
      publicKey: rootKey.publicKeyHex
    }
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: submitter.address
    })
    const rootAccount = await createSliceWalletRegisteredKernelAccount({
      chainId: base.id,
      client: publicClient,
      credential: registeredCredential,
      initConfig: recovery.initConfig,
      rootSigner: (challenge) =>
        encodeSliceWalletSyntheticWebAuthnSignature({
          chainId: base.id,
          challenge,
          key: rootKey.privateKey,
          origin: "https://id.slice.so",
          rpId: "id.slice.so",
          usePrecompiled: false
        })
    })
    const sessionPrivateKey = generatePrivateKey()
    const sessionSignerAddress = privateKeyToAccount(sessionPrivateKey).address
    const policyCoSigner = privateKeyToAccount(generatePrivateKey())
    const wrongCoSigner = privateKeyToAccount(generatePrivateKey())
    const validUntil = Math.floor(Date.now() / 1_000) + 86_400
    const enableTypedData = await buildSliceExecutionEnableTypedData({
      accountIndex: 0n,
      address: rootAccount.address,
      client: publicClient,
      coSignerAddress: policyCoSigner.address,
      credential,
      mode: "checkout",
      sessionSignerAddress,
      validUntil
    })
    const enableSignature = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId: base.id,
      challenge: hashTypedData(enableTypedData),
      key: rootKey.privateKey,
      origin: "https://id.slice.so",
      rpId: "id.slice.so",
      usePrecompiled: false
    })
    const createExecution = (
      coSign: typeof policyCoSigner | undefined,
      configuredCoSigner: Address = policyCoSigner.address
    ) =>
      createSliceExecutionAccount({
        accountIndex: 0n,
        address: rootAccount.address,
        client: publicClient,
        coSignerAddress: configuredCoSigner,
        credential,
        enableSignature,
        getFactoryArgs: () => rootAccount.getFactoryArgs(),
        ...(coSign === undefined
          ? {}
          : {
              getCoSignature: ({ userOperation }) =>
                coSign.sign({
                  hash: getUserOperationHash({
                    chainId: base.id,
                    entryPointAddress: entryPoint09Address,
                    entryPointVersion: "0.9",
                    userOperation: { ...userOperation, signature: "0x" }
                  })
                })
            }),
        mode: "checkout",
        sessionPrivateKey,
        sessionSignerAddress,
        validUntil
      })
    const executionAccount = await createExecution(policyCoSigner)
    const productsModule = getProductsModuleAddress(base.id)
    const paymentValue = 1n
    const calls = [
      {
        data: encodeFunctionData({
          abi: productsModuleAbi,
          args: [
            rootAccount.address,
            [
              {
                amount: paymentValue,
                currency: zeroAddress,
                data: [],
                recipient,
                slicerId: 0n
              }
            ],
            []
          ],
          functionName: "pay"
        }),
        to: productsModule,
        value: paymentValue
      }
    ] as const
    await depositToEntryPoint(rootAccount.address)
    const fundHash = await createForkWalletClient().sendTransaction({
      to: rootAccount.address,
      value: parseEther("0.01")
    })
    await publicClient.waitForTransactionReceipt({ hash: fundHash })

    const missingCoSignerAccount = await createExecution(undefined)
    await expect(
      buildUserOperation({
        account: missingCoSignerAccount,
        calls,
        factoryArgs: await missingCoSignerAccount.getFactoryArgs()
      })
    ).rejects.toThrow("missing its policy co-signer")

    const wrongCoSignerAccount = await createExecution(
      wrongCoSigner,
      policyCoSigner.address
    )
    await expect(
      submitUserOperation(
        await buildUserOperation({
          account: wrongCoSignerAccount,
          calls,
          factoryArgs: await wrongCoSignerAccount.getFactoryArgs()
        })
      )
    ).rejects.toThrow()

    expect(
      await submitUserOperation(
        await buildUserOperation({
          account: executionAccount,
          calls,
          factoryArgs: await executionAccount.getFactoryArgs()
        })
      )
    ).toBe(true)
  }, 240_000)
})
