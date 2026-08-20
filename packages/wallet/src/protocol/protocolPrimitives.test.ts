import { describe, expect, it } from "bun:test"
import { createPublicClient, custom, hashTypedData, keccak256 } from "viem"
import { base } from "viem/chains"
import { predictSliceWalletKernelAccountAddressFromInitConfig } from "./accountPrediction"
import { encodeKernelInstall } from "./kernel/factory"
import { buildSliceWalletPermissionEnableTypedData } from "./permission"
import { createNativeTransferCallRule, getWalletPermissionId } from "./policy"
import { buildRecoveryPermissionInitConfig } from "./recovery"
import type {
  SliceKernelInstall,
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

// Kernel v4 install packages are pinned through the digest of each encoded
// install tuple so the fixture stays readable while still covering the full
// policy/signer byte layout.
const expectedPermissionVectors = {
  checkout: {
    installHashes: [
      "0x6b17feef2db72cc8f08eb237b303f56a0eb0fbb4b76abbcf9e81b8b76f81fe33",
      "0xcd6e4188c5ec35569f943924cadf7a2745388f2395213d8071e6162bcb309bcc",
      "0x77b0a59c1db5b3e51309552817380414cc56c0a7c6c54e56d64545104a55a690",
      "0xc7c4b31bf4b0a94cc279050398bf7525ea19e93c9f41510014307e13386c1e04"
    ],
    permissionId: "0xacf0ba22",
    typedDataHash:
      "0x9d113129ac3eadc3d62c0d976beb9ceaa8fd63459c0f5e486b59822c00a3cfbd"
  },
  generic: {
    installHashes: [
      "0xe5f9096fb3d57c71f9aebe6c3226f6a26a9076e62143fc4dbb710208ed9a8977",
      "0x51f40a1a78854770130d1dc6b29c507a492977659c169cfd8b8b027c6b3f53be",
      "0xc5eb4713cdc0b1864ed77bfff3db02202457b6bad389b6b983da3ff2a6d2ef0f",
      "0x94c1fb4d156605136f0267a1d9cd246f04f8a3454d0a91645ecd8aac52bdfc8c"
    ],
    permissionId: "0xc10a5a5d",
    typedDataHash:
      "0x0a3ab92280793a11ee1749a1ee18061e2fffe743e843f3da0f125cac3b20bb47"
  },
  management: {
    installHashes: [
      "0x80bb4671f1cee3d4ae274479367427b847bc01dfbc1bf4bcfdeecbf408ed0e50",
      "0xed574e323532a1fd3575b8eb7ced781a0346bdb3bbba84c1bd2ddae75e51c62d",
      "0x9281e5701224cf497a36cab49c967c40fb2cf542ef3dd7ba8041f3a7d455a390",
      "0x6115366d7102858c9979619c82f35e30109d96292051bea090a45f65cd7efe7e",
      "0xd359e0b5e95daf824d8c8305965ea208cde2d0a0ce0b2efa2f65d5e2c06cdb3f"
    ],
    permissionId: "0x42979a97",
    typedDataHash:
      "0x845ad42140efd91b6053d8b2ee2276d54828da05e9802acb809e1fcc237d704a"
  }
} as const satisfies Record<
  WalletGrantKind,
  {
    installHashes: readonly `0x${string}`[]
    permissionId: `0x${string}`
    typedDataHash: `0x${string}`
  }
>

const hashInstalls = (installs: readonly SliceKernelInstall[]) =>
  installs.map((install) => keccak256(encodeKernelInstall(install)))

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

describe("Kernel v4 protocol primitive vectors", () => {
  it("pins permission ids, install packages, and enable typed-data hashes", async () => {
    for (const grantKind of grantKinds) {
      const session = createSession(grantKind)
      const expected = expectedPermissionVectors[grantKind]
      expect(getWalletPermissionId(session.policy, session.signerId)).toBe(
        expected.permissionId
      )
      // enableNonce pins the install nonce offline instead of reading it from
      // the account, so the vector never touches RPC.
      const typedData = await buildSliceWalletPermissionEnableTypedData({
        address: account,
        client: offlineClient,
        enableNonce: 0n,
        session
      })
      expect(typedData.message.nonce).toBe(0n)
      expect(hashInstalls(typedData.message.packages)).toEqual([
        ...expected.installHashes
      ])
      expect(hashTypedData(typedData)).toBe(expected.typedDataHash)
    }
  })

  it("pins recovery initialization packages and permission id", async () => {
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: recoverySigner
    })
    expect(recovery.permissionId).toBe("0xebddbf3e")
    expect(hashInstalls(recovery.initConfig)).toEqual([
      "0x678dd386651684f1bed282b7d2428991d88a182bd320f03474a2619f466cc7d6",
      "0x8358e245092f713e580d8e2482e2c20ef90d87619456a0c2036720cf3e14a1d8",
      "0xeafcc2c7f19e1caef9f93bc74367e15c45d70ab2b6e8794e60c68278aea84dba"
    ])
  })

  it("pins counterfactual addresses across indexes and init configs", async () => {
    const credential = {
      credentialIdHash: `0x${"66".repeat(32)}`,
      publicKey: `0x04${"55".repeat(64)}`
    } satisfies SliceWalletRegisteredRootCredential
    const recovery = await buildRecoveryPermissionInitConfig({
      recoverySignerAddress: recoverySigner
    })

    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        chainId: base.id,
        credential
      })
    ).toBe("0x91972d78Db6764a7CA33c06013056564d104C129")
    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        chainId: base.id,
        credential,
        index: 3n
      })
    ).toBe("0x3efA06050853D7d18c1b677aEDfBCafe3D6227Ca")
    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        chainId: base.id,
        credential,
        initConfig: recovery.initConfig
      })
    ).toBe("0x97baF994710fd89746D926a51FaB74dba9F3b5b4")
    expect(
      predictSliceWalletKernelAccountAddressFromInitConfig({
        chainId: base.id,
        credential,
        index: 3n,
        initConfig: recovery.initConfig
      })
    ).toBe("0x58206897164909C8ad4a024b18CB2f8851fAbE41")
  })
})
