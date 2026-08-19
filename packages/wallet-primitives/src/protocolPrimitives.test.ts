import { describe, expect, it } from "bun:test"
import { createPublicClient, custom, hashTypedData, keccak256 } from "viem"
import { base } from "viem/chains"
import { predictSliceWalletKernelAccountAddressFromInitConfig } from "./accountPrediction"
import {
  buildSliceWalletPermissionEnableTypedData,
  getSliceWalletPermissionEnableData
} from "./permission"
import { createNativeTransferCallRule, getWalletPermissionId } from "./policy"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import type {
  SliceWalletFrameSession,
  SliceWalletRegisteredRootCredential,
  WalletGrantKind,
  WalletPolicyDescriptor
} from "./types"

const account = "0x2222222222222222222222222222222222222222"
const recipient = "0x1111111111111111111111111111111111111111"
const signerId = "0x4444444444444444444444444444444444444444"
const recoverySigner = "0x7777777777777777777777777777777777777777"
const sessionPublicKey = `0x04${"33".repeat(64)}` as const
const grantKinds = ["generic", "management", "checkout"] as const

const expectedPermissionVectors = {
  checkout: {
    enableDataHash:
      "0xef34114966092977e24bc5f489b772020ea7490ba83d4db0ff2085ca627418b2",
    permissionId: "0xacf0ba22",
    typedDataHash:
      "0xd23bb7f301d847eec44652add6720f4eacf059c6a44a765acad64ffc477c68a4"
  },
  generic: {
    enableDataHash:
      "0x696fd718ab56f96ace87719ce698f58e529b2a21ac5d9c8cef84e0d86ac206ec",
    permissionId: "0xc10a5a5d",
    typedDataHash:
      "0x2a333e9ffcc4bfa7ee3688b670a5a21ab2824291c0ca62ea70bf77f2ba915aa9"
  },
  management: {
    enableDataHash:
      "0x1d39b902b2b16d2f1a83ee9369547c273fb49beb775036d504cda86433c8d143",
    permissionId: "0x42979a97",
    typedDataHash:
      "0x868336895912e8cbdb3012a0fd3994b852422fa9bd9923ae54f403cbccf3e4e1"
  }
} as const satisfies Record<
  WalletGrantKind,
  {
    enableDataHash: `0x${string}`
    permissionId: `0x${string}`
    typedDataHash: `0x${string}`
  }
>

const createSession = (grantKind: WalletGrantKind) => {
  const policy = {
    account,
    calls: [createNativeTransferCallRule({ maximumValue: 1n, recipient })],
    chainId: base.id,
    grantKind,
    rateLimit: { count: 1, intervalSec: 60 },
    validAfter: 1_999_996_400,
    validUntil: 2_000_000_000,
    version: 1
  } satisfies WalletPolicyDescriptor
  return {
    account,
    chainId: base.id,
    ...(grantKind === "checkout"
      ? {
          checkout: {
            allowanceUsdMicros: "25000000",
            budgetPeriodSec: 86_400,
            coSignerAddress: recoverySigner
          }
        }
      : {}),
    expiresAt: 2_000_000_000,
    grantKind,
    permissionId: "0x00000000",
    policy,
    publicKey: sessionPublicKey,
    signerId
  } satisfies SliceWalletFrameSession
}

const offlineClient = createPublicClient({
  chain: base,
  transport: custom({
    request: async () => {
      throw new Error("Golden vectors must not use RPC.")
    }
  })
})

describe("ZeroDev-free protocol primitive vectors", () => {
  it("pins permission ids, enable-data bytes, and enable typed-data hashes", async () => {
    for (const grantKind of grantKinds) {
      const session = createSession(grantKind)
      const expected = expectedPermissionVectors[grantKind]
      expect(getWalletPermissionId(session.policy, session.signerId)).toBe(
        expected.permissionId
      )
      // The digest pins the complete encoded byte sequence without embedding
      // several kilobytes of ABI padding in the fixture.
      expect(keccak256(getSliceWalletPermissionEnableData(session))).toBe(
        expected.enableDataHash
      )
      expect(
        hashTypedData(
          await buildSliceWalletPermissionEnableTypedData({
            address: account,
            client: offlineClient,
            session
          })
        )
      ).toBe(expected.typedDataHash)
    }
  })

  it("pins recovery initialization bytes and permission id", () => {
    const recovery = buildRecoveryPermissionInitConfig({
      recoverySignerAddress: recoverySigner
    })
    expect(recovery.permissionId).toBe("0x4b739308")
    expect(recovery.initConfig.map((call) => keccak256(call))).toEqual([
      "0x98b1fc224520fba75ed9dc1eba260fe212e610753902a880433f12ee8dd3b419",
      "0x8588c34f6b003154ea564e0b84c3f85de7a1e695b040ca3ad6b5789976cb77fb"
    ])
  })

  it("pins counterfactual addresses across indexes and init configs", () => {
    const credential = {
      credentialIdHash: `0x${"66".repeat(32)}`,
      publicKey: `0x04${"55".repeat(64)}`
    } satisfies SliceWalletRegisteredRootCredential
    const recovery = buildRecoveryPermissionInitConfig({
      recoverySignerAddress: recoverySigner
    })

    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({ credential })
    ).toBe("0xEe0Cb8c9C38C4eDe6919BeB999d660Add5c7b59F")
    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        credential,
        index: 3n
      })
    ).toBe("0xd1Cee63f09f79847C8096f233D871A4253d4Ad35")
    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        credential,
        initConfig: recovery.initConfig
      })
    ).toBe("0x70b3089f9DB8dDAC2cCA68145996aBcf5004b27D")
    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        credential,
        index: 3n,
        initConfig: recovery.initConfig
      })
    ).toBe("0x34fFd2658a6E8347bb6F150115E81DD882481418")
  })
})
