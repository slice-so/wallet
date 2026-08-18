import { describe, expect, test } from "bun:test"
import {
  assertRecoveryPermissionInitConfig,
  buildRecoveryPermissionInitConfig,
  createRecoveryCallPolicy,
  sliceRecoveryTimelockDelaySec,
  sliceRecoveryTimelockExpirationSec,
  sliceWalletKernelAddresses,
  toSliceTimelockPolicy
} from "@slicekit/wallet-primitives"
import {
  kernelWebAuthnValidatorLifecycleAbi,
  resolveSliceWalletDeployment
} from "@slicekit/wallet-primitives/kernel"
import {
  type Address,
  concat,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  hexToBigInt,
  size,
  slice,
  toFunctionSelector,
  zeroAddress
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  buildDevicePromotionCalls,
  toSliceWalletDeviceSigner
} from "./deviceValidator"
import {
  buildRecoveryCancelCall,
  buildRecoveryNoOpCallData,
  buildRecoveryRotationCalls,
  encodeRecoveryProposalSignature,
  encodeRecoveryProposalUserOperationSignature
} from "./recovery"
import { encodeSliceWalletRootValidatorData } from "./rootValidator"

const account = "0x1111111111111111111111111111111111111111"
const credential = {
  credentialIdHash:
    "0x0102030400000000000000000000000000000000000000000000000000000000",
  publicKey:
    "0x04000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000001c8"
} as const
const lifecycleAbi = [
  {
    inputs: [{ name: "data", type: "bytes" }],
    name: "onInstall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ name: "data", type: "bytes" }],
    name: "onUninstall",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const
const executeAbi = [
  {
    inputs: [
      { name: "mode", type: "bytes32" },
      { name: "executionData", type: "bytes" }
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const
const timelockAbi = [
  {
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "account", type: "address" },
      { name: "callData", type: "bytes" },
      { name: "nonce", type: "uint256" }
    ],
    name: "cancelProposal",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  }
] as const
const recoveryCallPolicyParameter = {
  components: [
    { name: "callType", type: "bytes1" },
    { name: "target", type: "address" },
    { name: "selector", type: "bytes4" },
    { name: "valueLimit", type: "uint256" },
    {
      components: [
        { name: "condition", type: "uint8" },
        { name: "offset", type: "uint64" },
        { name: "params", type: "bytes32[]" }
      ],
      name: "rules",
      type: "tuple[]"
    }
  ],
  name: "permissions",
  type: "tuple[]"
} as const

describe("Kernel v4 recovery permission", () => {
  test("round-trips the canonical policy and signer packages", async () => {
    const recoverySignerAddress = "0x0000000000000000000000000000000000000001"
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress
    })
    expect(recovery.initConfig.map((install) => install.moduleType)).toEqual([
      5n,
      5n,
      6n
    ])
    await expect(
      assertRecoveryPermissionInitConfig({
        initConfig: recovery.initConfig
      })
    ).resolves.toEqual({
      permissionId: recovery.permissionId,
      recoverySignerAddress
    })
    await expect(
      assertRecoveryPermissionInitConfig({ initConfig: [] })
    ).rejects.toThrow("canonical")
  })

  test("encodes canonical timelock parameters", () => {
    const policy = toSliceTimelockPolicy()
    expect(policy.address).toBe(sliceWalletKernelAddresses.timelockPolicy)
    expect(policy.kind).toBe("timelock")
    expect(policy.data).toBe(
      encodeAbiParameters(
        [
          { name: "delay", type: "uint48" },
          { name: "expirationPeriod", type: "uint48" },
          { name: "guardian", type: "address" }
        ],
        [
          sliceRecoveryTimelockDelaySec,
          sliceRecoveryTimelockExpirationSec,
          zeroAddress
        ]
      )
    )
  })

  test("limits recovery authority to the no-op and exact root rotation selectors", () => {
    const policy = createRecoveryCallPolicy()
    const [permissions] = decodeAbiParameters(
      [recoveryCallPolicyParameter],
      policy.data
    )
    expect(permissions).toHaveLength(3)
    expect(permissions[0]).toMatchObject({
      selector: "0x00000000",
      target: zeroAddress,
      valueLimit: 0n
    })
    expect(permissions.slice(1)).toEqual([
      {
        callType: "0x00",
        rules: [],
        selector: toFunctionSelector(kernelWebAuthnValidatorLifecycleAbi[1]),
        target: sliceWalletKernelAddresses.webAuthnRootValidator,
        valueLimit: 0n
      },
      {
        callType: "0x00",
        rules: [],
        selector: toFunctionSelector(kernelWebAuthnValidatorLifecycleAbi[0]),
        target: sliceWalletKernelAddresses.webAuthnRootValidator,
        valueLimit: 0n
      }
    ])
    expect(permissions.some(({ target }) => target === account)).toBe(false)
  })
})

describe("Kernel v4 recovery calldata", () => {
  test("rotates the WebAuthn root validator", () => {
    const calls = buildRecoveryRotationCalls(credential)
    expect(calls.map((call) => call.to)).toEqual([
      sliceWalletKernelAddresses.webAuthnRootValidator,
      sliceWalletKernelAddresses.webAuthnRootValidator
    ])
    const uninstall = decodeFunctionData({
      abi: lifecycleAbi,
      data: calls[0]?.data ?? "0x"
    })
    const install = decodeFunctionData({
      abi: lifecycleAbi,
      data: calls[1]?.data ?? "0x"
    })
    expect(uninstall.functionName).toBe("onUninstall")
    expect(install.functionName).toBe("onInstall")
    expect(install.args[0]).toBe(encodeSliceWalletRootValidatorData(credential))
  })

  test("device promotion targets the selected profile's root validator", async () => {
    const deployment = resolveSliceWalletDeployment({
      chainId: 8453,
      factoryVersion: "0.4.0"
    })
    const calls = await buildDevicePromotionCalls({
      account: account as Address,
      chainId: 8453,
      client: {
        getCode: async () => "0x1234",
        multicall: async () => [true, true]
      } as never,
      credential,
      factoryVersion: "0.4.0",
      newRootCredential: credential,
      signer: toSliceWalletDeviceSigner({
        account: privateKeyToAccount(`0x${"11".repeat(32)}`),
        credential
      })
    })

    expect(calls.calls.slice(0, 2).map((call) => call.to)).toEqual([
      deployment.rootValidator,
      deployment.rootValidator
    ])
  })

  test("encodes the exact v4 single-call no-op", () => {
    const decoded = decodeFunctionData({
      abi: executeAbi,
      data: buildRecoveryNoOpCallData()
    })
    expect(decoded.args[0]).toBe(`0x${"00".repeat(32)}`)
    expect(size(decoded.args[1])).toBe(52)
    expect(slice(decoded.args[1], 0, 20)).toBe(zeroAddress)
    expect(hexToBigInt(slice(decoded.args[1], 20, 52))).toBe(0n)
  })

  test("encodes cancellation against the configured timelock", () => {
    const call = buildRecoveryCancelCall({
      account,
      callData: "0x12345678",
      nonce: 42n,
      permissionId: "0x11223344"
    })
    expect(call.to).toBe(sliceWalletKernelAddresses.timelockPolicy)
    const decoded = decodeFunctionData({
      abi: timelockAbi,
      data: call.data ?? "0x"
    })
    expect(decoded.args).toEqual([
      `0x11223344${"00".repeat(28)}`,
      account,
      "0x12345678",
      42n
    ])
  })
})

describe("Kernel v4 recovery proposal signatures", () => {
  test("places the proposal in the timelock policy signature slot", () => {
    const ecdsaSignature = `0x${"aa".repeat(65)}` as const
    const baseSignature = encodeAbiParameters(
      [{ name: "signatures", type: "bytes[]" }],
      [["0x", "0x", ecdsaSignature]]
    )
    const signature = encodeRecoveryProposalUserOperationSignature({
      callData: "0x12345678",
      nonce: 42n,
      signature: baseSignature
    })
    const [signatures] = decodeAbiParameters(
      [{ name: "signatures", type: "bytes[]" }],
      signature
    )
    expect(signatures).toEqual([
      "0x",
      encodeRecoveryProposalSignature({ callData: "0x12345678", nonce: 42n }),
      ecdsaSignature
    ])
  })

  test("rejects signatures outside permission mode", () => {
    expect(() =>
      encodeRecoveryProposalUserOperationSignature({
        callData: "0x12345678",
        nonce: 42n,
        signature: concat(["0x00", `0x${"aa".repeat(65)}`])
      })
    ).toThrow("permission mode")
  })
})
