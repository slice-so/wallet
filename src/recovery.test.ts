import { describe, expect, it } from "bun:test"
import { PolicyFlags } from "@zerodev/permissions"
import {
  concat,
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  hexToBigInt,
  http,
  numberToHex,
  size,
  slice,
  toFunctionSelector,
  zeroAddress
} from "viem"
import { anvil } from "viem/chains"
import { sliceWalletKernelAddresses } from "./constants"
import {
  buildRecoveryCancelCall,
  assertRecoveryPermissionInitConfig,
  buildRecoveryPermissionInitConfig,
  buildRecoveryNoOpCallData,
  buildRecoveryRotationCalls,
  createRecoveryCallPolicy,
  encodeRecoveryProposalSignature,
  encodeRecoveryProposalUserOperationSignature,
  sliceRecoveryTimelockDelaySec,
  sliceRecoveryTimelockExpirationSec,
  toSliceTimelockPolicy
} from "./recovery"
import { encodeSliceWalletRootValidatorData } from "./rootValidator"

const sliceKernelTimelockPolicyAddress =
  "0x7f66B69270f96EC6793c545742CCBbBe028Be3f6"
const sliceKernelWebAuthnValidatorAddress =
  sliceWalletKernelAddresses.webAuthnRootValidator

const account = "0x1111111111111111111111111111111111111111"
const permissionId = "0x11223344"
const proposalCallData = "0x12345678"
const proposalNonce = 42n
const ecdsaSignature =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const webAuthnValidatorLifecycleAbi = [
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

const timelockPolicyAbi = [
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

const erc7579AccountExecutionAbi = [
  {
    inputs: [
      { name: "mode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" }
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  }
] as const

const credential = {
  credentialIdHash:
    "0x0102030400000000000000000000000000000000000000000000000000000000",
  publicKey:
    "0x04000000000000000000000000000000000000000000000000000000000000007b00000000000000000000000000000000000000000000000000000000000001c8"
} as const

describe("slice recovery timelock policy", () => {
  it("round-trips the canonical account init config", async () => {
    const client = createPublicClient({
      chain: anvil,
      transport: http("http://127.0.0.1:8545")
    })
    const recoverySignerAddress = "0x0000000000000000000000000000000000000001"
    const recovery = await buildRecoveryPermissionInitConfig({
      client,
      recoverySignerAddress
    })

    await expect(
      assertRecoveryPermissionInitConfig({
        client,
        initConfig: recovery.initConfig
      })
    ).resolves.toEqual({
      permissionId: recovery.permissionId,
      recoverySignerAddress
    })
    await expect(
      assertRecoveryPermissionInitConfig({ client, initConfig: [] })
    ).rejects.toThrow("two calls")
  })

  it("encodes delay, expiration, guardian and policy info", () => {
    const policy = toSliceTimelockPolicy()

    expect(policy.getPolicyInfoInBytes()).toBe(
      concat([PolicyFlags.FOR_ALL_VALIDATION, sliceKernelTimelockPolicyAddress])
    )
    expect(policy.getPolicyData()).toBe(
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

  it("limits recovery calls to proposal no-op and WebAuthn validator rotation", () => {
    const policy = createRecoveryCallPolicy()
    if (policy.policyParams.type !== "call") {
      throw new Error("Recovery call policy must be a call policy.")
    }
    const permissions = policy.policyParams.permissions ?? []

    expect(permissions).toHaveLength(3)
    expect(permissions.map((permission) => permission.target)).toEqual([
      zeroAddress,
      sliceKernelWebAuthnValidatorAddress,
      sliceKernelWebAuthnValidatorAddress
    ])
    expect(permissions.map((permission) => permission.selector)).toEqual([
      "0x00000000",
      toFunctionSelector(webAuthnValidatorLifecycleAbi[1]),
      toFunctionSelector(webAuthnValidatorLifecycleAbi[0])
    ])
  })
})

describe("slice recovery calldata", () => {
  it("builds the WebAuthn root-validator rotation calls", () => {
    const calls = buildRecoveryRotationCalls(credential)

    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.to)).toEqual([
      sliceKernelWebAuthnValidatorAddress,
      sliceKernelWebAuthnValidatorAddress
    ])
    if (calls[0]?.data === undefined || calls[1]?.data === undefined) {
      throw new Error("Recovery rotation calls require calldata.")
    }

    const uninstall = decodeFunctionData({
      abi: webAuthnValidatorLifecycleAbi,
      data: calls[0].data
    })
    const install = decodeFunctionData({
      abi: webAuthnValidatorLifecycleAbi,
      data: calls[1].data
    })

    expect(uninstall.functionName).toBe("onUninstall")
    expect(uninstall.args[0]).toBe("0x")
    expect(install.functionName).toBe("onInstall")
    expect(install.args[0]).toBe(encodeSliceWalletRootValidatorData(credential))
  })

  it("builds the exact ERC-7579 single-call zero no-op", () => {
    const decoded = decodeFunctionData({
      abi: erc7579AccountExecutionAbi,
      data: buildRecoveryNoOpCallData()
    })

    expect(decoded.args[0]).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    )
    expect(size(decoded.args[1])).toBe(52)
    expect(slice(decoded.args[1], 0, 20)).toBe(zeroAddress)
    expect(hexToBigInt(slice(decoded.args[1], 20, 52))).toBe(0n)
  })

  it("builds the account-authorized cancel call", () => {
    const call = buildRecoveryCancelCall({
      account,
      callData: proposalCallData,
      nonce: proposalNonce,
      permissionId
    })
    if (call.data === undefined) {
      throw new Error("Recovery cancel call requires calldata.")
    }

    expect(call.to).toBe(sliceKernelTimelockPolicyAddress)
    const decoded = decodeFunctionData({
      abi: timelockPolicyAbi,
      data: call.data
    })
    expect(decoded.args).toEqual([
      "0x1122334400000000000000000000000000000000000000000000000000000000",
      account,
      proposalCallData,
      proposalNonce
    ])
  })
})

describe("slice recovery proposal signatures", () => {
  it("encodes proposed calldata length, calldata, and nonce for the Timelock policy", () => {
    const signature = encodeRecoveryProposalSignature({
      callData: proposalCallData,
      nonce: proposalNonce
    })

    const [callDataLength] = decodeAbiParameters(
      [{ name: "callDataLength", type: "uint256" }],
      slice(signature, 0, 32)
    )
    expect(callDataLength).toBe(4n)
    expect(slice(signature, 32, 36)).toBe(proposalCallData)

    const [nonce] = decodeAbiParameters(
      [{ name: "nonce", type: "uint256" }],
      slice(signature, 36, 68)
    )
    expect(nonce).toBe(proposalNonce)
  })

  it("frames the Timelock policy signature before the permission-mode ECDSA signature", () => {
    const permissionSignature = concat(["0xff", ecdsaSignature])
    const policyPayload = encodeRecoveryProposalSignature({
      callData: proposalCallData,
      nonce: proposalNonce
    })
    const policyPayloadLength = size(policyPayload)

    expect(
      encodeRecoveryProposalUserOperationSignature({
        callData: proposalCallData,
        nonce: proposalNonce,
        signature: permissionSignature
      })
    ).toBe(
      concat([
        "0x01",
        numberToHex(policyPayloadLength, { size: 8 }),
        policyPayload,
        permissionSignature
      ])
    )
  })

  it("rejects non-permission-mode signatures", () => {
    expect(() =>
      encodeRecoveryProposalUserOperationSignature({
        callData: proposalCallData,
        nonce: proposalNonce,
        signature: concat(["0x00", ecdsaSignature])
      })
    ).toThrow("Recovery proposal signatures require permission mode.")
  })
})
