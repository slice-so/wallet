import { describe, expect, test } from "bun:test"
import {
  createPublicClient,
  custom,
  decodeAbiParameters,
  decodeFunctionData
} from "viem"
import type { UserOperation } from "viem/account-abstraction"
import { privateKeyToAccount } from "viem/accounts"
import { base } from "viem/chains"
import type {
  SliceKernelPermission,
  SliceKernelValidator,
  SliceWalletKernelTypedDataValue
} from "../protocol/index"
import {
  decodeKernelNonce,
  encodeKernelPermissionUninstallCalls,
  getKernelPermissionInstalls,
  getKernelPermissionNonceKey,
  getKernelValidatorNonceKey,
  kernelAccountAbi,
  kernelEntryPoint,
  kernelModuleType
} from "../protocol/kernel"
import { createKernelV4Account } from "./account"
import { decodeKernelCalls, encodeKernelCalls } from "./execution"
import { signKernelMessage, signKernelTypedData } from "./signatures"

const accountAddress = "0x1111111111111111111111111111111111111111"
const validatorAddress = "0x2222222222222222222222222222222222222222"
const target = "0x3333333333333333333333333333333333333333"

const client = createPublicClient({
  chain: base,
  transport: custom({
    async request({ method }) {
      throw new Error(`Unexpected adapter test RPC request: ${method}`)
    }
  })
})

const createValidator = (
  signHash: SliceKernelValidator["signHash"] = async () => "0x1234"
): SliceKernelValidator => ({
  address: validatorAddress,
  getEnableData: async () => "0x0102",
  getStubSignature: async () => "0x1234",
  signHash
})

describe("internal Kernel v4 adapter", () => {
  test("round-trips exact single and batch execution modes", () => {
    const single = [{ to: target, value: 7n }] as const
    expect(decodeKernelCalls(encodeKernelCalls(single))).toEqual([
      { data: "0x", to: target, value: 7n }
    ])

    const batch = [
      { data: "0x1234", to: target, value: 7n },
      { data: "0xabcd", to: validatorAddress, value: 0n }
    ] as const
    expect(decodeKernelCalls(encodeKernelCalls(batch))).toEqual(batch)
  })

  test("encodes the v4 validator and permission nonce layouts", () => {
    const permissionKey = getKernelPermissionNonceKey({
      customKey: 0xabcdn,
      enable: true,
      permissionId: "0x12345678"
    })
    expect(decodeKernelNonce((permissionKey << 64n) | 7n)).toEqual({
      customKey: 0xabcdn,
      permissionId: "0x12345678",
      sequence: 7n,
      validationMode: 8,
      validationType: 2,
      validator: undefined
    })

    const validatorKey = getKernelValidatorNonceKey({
      customKey: 9n,
      validator: validatorAddress
    })
    expect(decodeKernelNonce((validatorKey << 64n) | 3n)).toEqual({
      customKey: 9n,
      permissionId: undefined,
      sequence: 3n,
      validationMode: 0,
      validationType: 1,
      validator: validatorAddress
    })
  })

  test("installs policies before the signer and uninstalls them LIFO", () => {
    const signerAddress = privateKeyToAccount(`0x${"44".repeat(32)}`).address
    const permission = {
      id: "0x12345678",
      policies: [
        { address: target, data: "0x01", kind: "call" },
        { address: validatorAddress, data: "0x02", kind: "timestamp" }
      ],
      signer: {
        account: privateKeyToAccount(`0x${"44".repeat(32)}`),
        address: signerAddress,
        data: "0x03",
        stubSignature: "0x1234"
      }
    } as const satisfies SliceKernelPermission

    expect(
      getKernelPermissionInstalls(permission).map((install) => ({
        module: install.module,
        moduleType: install.moduleType
      }))
    ).toEqual([
      { module: target, moduleType: kernelModuleType.policy },
      { module: validatorAddress, moduleType: kernelModuleType.policy },
      { module: signerAddress, moduleType: kernelModuleType.signer }
    ])

    const uninstall = encodeKernelPermissionUninstallCalls(
      accountAddress,
      permission
    ).map((call) => {
      const decoded = decodeFunctionData({
        abi: kernelAccountAbi,
        data: call.data
      })
      if (decoded.functionName !== "uninstallModule") {
        throw new Error("Expected a Kernel module uninstall call.")
      }
      const [installData, internalData] = decodeAbiParameters(
        [
          { name: "installData", type: "bytes" },
          { name: "internalData", type: "bytes" }
        ],
        decoded.args[2]
      )
      return {
        installData,
        internalData,
        module: decoded.args[1],
        moduleType: decoded.args[0]
      }
    })
    expect(uninstall).toEqual([
      {
        installData:
          "0x123456780000000000000000000000000000000000000000000000000000000002",
        internalData: "0x12345678",
        module: validatorAddress,
        moduleType: kernelModuleType.policy
      },
      {
        installData:
          "0x123456780000000000000000000000000000000000000000000000000000000001",
        internalData: "0x12345678",
        module: target,
        moduleType: kernelModuleType.policy
      },
      {
        installData:
          "0x123456780000000000000000000000000000000000000000000000000000000003",
        internalData:
          "0x123456780000000000000000000000000000000000000000e9ae5c53",
        module: signerAddress,
        moduleType: kernelModuleType.signer
      }
    ])
  })

  test("rejects permission enable mode without an enable signature", async () => {
    const permissionSigner = privateKeyToAccount(`0x${"55".repeat(32)}`)
    const permission = {
      id: "0x12345678",
      policies: [{ address: target, data: "0x", kind: "sudo" }],
      signer: {
        account: permissionSigner,
        address: permissionSigner.address,
        data: permissionSigner.address,
        stubSignature: "0x1234"
      }
    } as const satisfies SliceKernelPermission
    const undeployedClient = createPublicClient({
      chain: base,
      transport: custom({
        async request({ method }) {
          if (method === "eth_getCode") return "0x"
          throw new Error(`Unexpected adapter test RPC request: ${method}`)
        }
      })
    })
    const account = await createKernelV4Account({
      address: accountAddress,
      client: undeployedClient,
      factory: "0xa299a4efee7bbfb2ea5668b30218c45fff78356c",
      implementation: "0xc842fe2ac44046ae3cef033a16c67a9bc287cbd2",
      permission,
      rootValidator: createValidator()
    })

    await expect(account.getStubSignature()).rejects.toThrow(
      "Kernel permission enable mode requires an enable signature."
    )
  })

  test("signs the pinned EntryPoint v0.9 UserOperation hash", async () => {
    let signedHash = "0x" as `0x${string}`
    const validator = createValidator(async (hash) => {
      signedHash = hash
      return "0x1234"
    })
    const account = await createKernelV4Account({
      address: accountAddress,
      client,
      factory: "0xa299a4efee7bbfb2ea5668b30218c45fff78356c",
      implementation: "0xc842fe2ac44046ae3cef033a16c67a9bc287cbd2",
      rootValidator: validator
    })
    const operation = {
      callData: "0x",
      callGasLimit: 100_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      nonce: 0n,
      preVerificationGas: 30_000n,
      sender: accountAddress,
      signature: "0x",
      verificationGasLimit: 200_000n
    } satisfies UserOperation<"0.9">

    expect(
      await account.signUserOperation({ ...operation, chainId: base.id })
    ).toBe("0x1234")
    expect(signedHash).toBe(
      "0x1bc322d0c27ca2860eb220ef149ef71573a526b9c8d3f945f512398ef65de99f"
    )
    expect(account.entryPoint).toEqual(kernelEntryPoint)
  })

  test("matches Kernel ERC-1271 personal-sign and ERC-7739 vectors", async () => {
    const validator = createValidator()
    expect(
      await signKernelMessage({
        account: accountAddress,
        chainId: base.id,
        message: "hello",
        validator
      })
    ).toBe("0x00001234")
    expect(
      await signKernelTypedData({
        account: accountAddress,
        chainId: base.id,
        source: {
          domain: {
            chainId: base.id,
            name: "Example",
            verifyingContract: target,
            version: "1"
          },
          message: { value: 7n },
          primaryType: "Example",
          types: { Example: [{ name: "value", type: "uint256" }] }
        },
        validator
      })
    ).toBe(
      "0x000012346b5840a7962d8ffb33edb6b3d1b825957db9afda0847f1446173b1c293aedbad533e2bbe16dfdb1a34f01f55af12def73590188bf92bf338ce00e2b30a6607af4578616d706c652875696e743235362076616c7565290016"
    )
  })

  test("wraps application typed data with the account chain", async () => {
    const wrappedChainIds: SliceWalletKernelTypedDataValue[] = []
    const validator = createValidator(async (_hash, context) => {
      if (context.purpose === "typed_data") {
        wrappedChainIds.push(context.typedData.message.chainId)
      }
      return "0x1234"
    })
    const types = {
      Example: [{ name: "value", type: "uint256" }]
    } as const

    for (const domain of [
      { chainId: 1, name: "Example" },
      { name: "Example" }
    ]) {
      await signKernelTypedData({
        account: accountAddress,
        chainId: base.id,
        source: {
          domain,
          message: { value: 7n },
          primaryType: "Example",
          types
        },
        validator
      })
    }

    expect(wrappedChainIds).toEqual([base.id, base.id])
  })
})
