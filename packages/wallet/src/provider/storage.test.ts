import { describe, expect, test } from "bun:test"
import {
  getWalletPermissionId,
  serializeWalletPolicyDescriptor
} from "@slicekit/wallet-primitives/server"
import { type Address, type Hex, keccak256 } from "viem"
import {
  entryPoint07Address,
  getUserOperationHash
} from "viem/account-abstraction"
import { getSliceWalletP256SignerId } from "../p256"
import type { StoredGenericGrantInstallationUserOperation } from "../types/providerInternal"
import { parseSliceWalletGrantPermissions } from "./protocol"
import {
  deserializeStoredGenericGrantInstallationUserOperation,
  readStoredSliceWalletAccount,
  readStoredSliceWalletCall,
  readStoredSliceWalletGrant,
  readStoredSliceWalletGrantRotation,
  serializeStoredGenericGrantInstallationUserOperation,
  writeStoredSliceWalletAccount,
  writeStoredSliceWalletCall,
  writeStoredSliceWalletGrant,
  writeStoredSliceWalletGrantRotation
} from "./storage"

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const account = "0x0000000000000000000000000000000000000001" as Address
const target = "0x0000000000000000000000000000000000000002" as Address
const publicKey = `0x04${"11".repeat(64)}` as Hex
const replacementPublicKey = `0x04${"22".repeat(64)}` as Hex
const installationEntryPoint = entryPoint07Address.toLowerCase() as Address
const installationUserOperation = {
  callData: "0x1234",
  callGasLimit: "0x1",
  maxFeePerGas: "0x2",
  maxPriorityFeePerGas: "0x1",
  nonce: "0x1",
  paymaster: target,
  paymasterData: "0xabcd",
  paymasterPostOpGasLimit: "0x1",
  paymasterVerificationGasLimit: "0x1",
  preVerificationGas: "0x1",
  sender: account,
  signature: "0x5678",
  verificationGasLimit: "0x1"
} satisfies StoredGenericGrantInstallationUserOperation
const installationUserOperationHash = getUserOperationHash({
  chainId: 8453,
  entryPointAddress: installationEntryPoint,
  entryPointVersion: "0.7",
  userOperation: deserializeStoredGenericGrantInstallationUserOperation(
    installationUserOperation
  )
})

const createGrant = (sessionPublicKey = publicKey) => {
  const policy = {
    account,
    calls: [
      {
        parameterRules: [],
        selector: "0x00000000",
        target,
        valueLimit: 1n
      }
    ],
    chainId: 8453,
    grantKind: "generic",
    rateLimit: { count: 1, intervalSec: 3600 },
    validAfter: 1_800_000_000,
    validUntil: 1_800_003_600,
    version: 1
  } as const
  const signerId = getSliceWalletP256SignerId(sessionPublicKey)
  return {
    account,
    chainId: 8453,
    createdAt: 1_800_000_000,
    enableSignature: "0x1234" as Hex,
    expiresAt: 1_800_003_600,
    permissionId: getWalletPermissionId(policy, signerId),
    permissions: [
      {
        data: {
          maximumValue: "0x1" as Hex,
          recipient: target,
          template: "native-transfer" as const
        },
        policies: [
          {
            data: { count: 1, intervalSec: 3600 },
            type: "rate-limit" as const
          }
        ],
        type: "slice-call" as const
      }
    ],
    policy: serializeWalletPolicyDescriptor(policy),
    publicKey: sessionPublicKey,
    signerId
  }
}

const createRotation = () => ({
  installation: {
    callDataHash: keccak256(installationUserOperation.callData),
    entryPoint: installationEntryPoint,
    nonce: "0x1" as Hex,
    sender: account,
    userOperation: installationUserOperation,
    userOperationHash: installationUserOperationHash
  },
  phase: "submitted" as const,
  predecessor: createGrant(),
  rebroadcastAttempts: 0,
  replacement: createGrant(replacementPublicKey),
  version: 1 as const
})

describe("portable wallet provider storage", () => {
  test("persists indexed accounts", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletAccount(storage, {
      accountAddress: account,
      accountIndex: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
      credentialIdHash: `0x${"33".repeat(32)}`,
      factoryVersion: "1",
      publicKey,
      recoveryPermissionId: null,
      recoverySignerAddress: null,
      registrationKind: "initial"
    })
    expect(readStoredSliceWalletAccount(storage)).toMatchObject({
      accountAddress: account,
      accountIndex: 7
    })
  })

  test("persists public grant metadata without private key material", () => {
    const storage = new MemoryStorage()
    expect(writeStoredSliceWalletGrant(storage, createGrant())).toBe(true)
    expect([...storage.values.values()][0]).not.toContain("privateKey")
    expect(
      readStoredSliceWalletGrant(storage, 8453, account, 1_800_000_001)
    ).not.toBeNull()
  })

  test("rejects a record containing private key material", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    const [key, raw] = [...storage.values.entries()][0] ?? []
    if (key === undefined || raw === undefined)
      throw new Error("Missing fixture.")
    storage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(raw), privateKey: "0xdeadbeef" })
    )
    expect(
      readStoredSliceWalletGrant(storage, 8453, account, 1_800_000_001)
    ).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  test("isolates grants by account", () => {
    const storage = new MemoryStorage()
    writeStoredSliceWalletGrant(storage, createGrant())
    expect(
      readStoredSliceWalletGrant(storage, 8453, account, 1_800_000_001)
    ).not.toBeNull()
    expect(
      readStoredSliceWalletGrant(storage, 10, account, 1_800_000_001)
    ).toBeNull()
    expect(
      readStoredSliceWalletGrant(storage, 8453, target, 1_800_000_001)
    ).toBeNull()
  })

  test("strictly persists and parses a recoverable rotation journal", () => {
    const storage = new MemoryStorage()
    const rotation = createRotation()

    expect(
      serializeStoredGenericGrantInstallationUserOperation(
        deserializeStoredGenericGrantInstallationUserOperation(
          installationUserOperation
        )
      )
    ).toEqual(installationUserOperation)
    expect(writeStoredSliceWalletGrantRotation(storage, rotation)).toBe(true)
    expect(
      readStoredSliceWalletGrantRotation(
        storage,
        rotation.replacement.chainId,
        rotation.replacement.account,
        1_800_000_001
      )
    ).toEqual(rotation)

    const [key, raw] =
      [...storage.values.entries()].find(([entryKey]) =>
        entryKey.includes("generic-rotation")
      ) ?? []
    if (key === undefined || raw === undefined)
      throw new Error("Missing rotation fixture.")
    const noncanonical = JSON.parse(raw)
    storage.setItem(key, JSON.stringify({ ...noncanonical, version: 2 }))
    expect(
      readStoredSliceWalletGrantRotation(
        storage,
        rotation.replacement.chainId,
        rotation.replacement.account,
        1_800_000_001
      )
    ).toBeNull()
    expect(storage.values.size).toBe(0)

    expect(writeStoredSliceWalletGrantRotation(storage, rotation)).toBe(true)
    const current = storage.getItem(key)
    if (current === null) throw new Error("Missing current rotation fixture.")
    const hashless = JSON.parse(current)
    delete hashless.installation
    storage.setItem(
      key,
      JSON.stringify({ ...hashless, phase: "transport-pending" })
    )
    expect(
      readStoredSliceWalletGrantRotation(
        storage,
        rotation.replacement.chainId,
        rotation.replacement.account,
        1_800_000_001
      )
    ).toBeNull()
    expect(storage.getItem(key)).toBeNull()

    expect(writeStoredSliceWalletGrantRotation(storage, rotation)).toBe(true)
    const rewritten = storage.getItem(key)
    if (rewritten === null) throw new Error("Missing rewritten fixture.")
    storage.setItem(
      key,
      JSON.stringify({
        ...JSON.parse(rewritten),
        untrustedPhaseData: true
      })
    )
    expect(
      readStoredSliceWalletGrantRotation(
        storage,
        rotation.replacement.chainId,
        rotation.replacement.account,
        1_800_000_001
      )
    ).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  test("accepts a replacement with different policy and permissions", () => {
    const storage = new MemoryStorage()
    const rotation = createRotation()
    const expiry = rotation.replacement.expiresAt + 600
    const currentPermission = rotation.replacement.permissions[0]
    if (currentPermission?.data.template !== "native-transfer") {
      throw new Error("Missing native-transfer rotation fixture.")
    }
    const parsed = parseSliceWalletGrantPermissions({
      account: rotation.replacement.account,
      chainId: rotation.replacement.chainId,
      now: rotation.replacement.createdAt,
      params: [
        {
          expiry,
          permissions: [
            {
              ...currentPermission,
              data: { ...currentPermission.data, maximumValue: "0x2" }
            }
          ]
        }
      ]
    })
    const descriptor = {
      ...parsed.policy,
      validAfter: rotation.replacement.policy.validAfter
    }
    const policy = serializeWalletPolicyDescriptor(descriptor)
    const replacement = {
      ...rotation.replacement,
      expiresAt: expiry,
      permissionId: getWalletPermissionId(
        descriptor,
        rotation.replacement.signerId
      ),
      permissions: parsed.permissions,
      policy
    }
    const changedRotation = { ...rotation, replacement }

    expect(writeStoredSliceWalletGrantRotation(storage, changedRotation)).toBe(
      true
    )
    expect(
      readStoredSliceWalletGrantRotation(
        storage,
        replacement.chainId,
        replacement.account,
        1_800_000_001
      )
    ).toEqual(changedRotation)
  })

  test("rejects non-canonical or identity-mismatched replay envelopes", () => {
    const rotation = createRotation()
    const invalidInstallations = [
      {
        ...rotation.installation,
        userOperation: {
          ...rotation.installation.userOperation,
          untrustedField: true
        }
      },
      {
        ...rotation.installation,
        userOperation: {
          ...rotation.installation.userOperation,
          callData: "0x1235"
        }
      },
      {
        ...rotation.installation,
        userOperation: {
          ...rotation.installation.userOperation,
          nonce: "0x01"
        }
      },
      {
        ...rotation.installation,
        entryPoint: entryPoint07Address
      },
      {
        ...rotation.installation,
        userOperationHash: `0x${"44".repeat(32)}`
      }
    ]

    for (const installation of invalidInstallations) {
      const storage = new MemoryStorage()
      expect(
        writeStoredSliceWalletGrantRotation(storage, {
          ...rotation,
          installation
        } as typeof rotation)
      ).toBe(true)
      expect(
        readStoredSliceWalletGrantRotation(
          storage,
          rotation.replacement.chainId,
          rotation.replacement.account,
          1_800_000_001
        )
      ).toBeNull()
      expect(storage.values.size).toBe(0)
    }
  })

  test("reports rejected active-grant and journal writes", () => {
    const storage = new MemoryStorage()
    storage.setItem = () => {
      throw new Error("quota exceeded")
    }
    const predecessor = createGrant()
    expect(writeStoredSliceWalletGrant(storage, predecessor)).toBe(false)
    expect(
      writeStoredSliceWalletGrantRotation(storage, {
        phase: "prepared",
        predecessor,
        rebroadcastAttempts: 0,
        replacement: createGrant(replacementPublicKey),
        version: 1
      })
    ).toBe(false)
  })

  test("persists a tracked call by opaque id and expires it after retention", () => {
    const storage = new MemoryStorage()
    const call = {
      chainId: 8453,
      createdAt: 1_800_000_000_000,
      id: "checkout-call",
      userOperationHash: `0x${"22".repeat(32)}` as Hex
    }
    writeStoredSliceWalletCall(storage, call)

    expect(
      readStoredSliceWalletCall(storage, call.id, call.createdAt + 1)
    ).toEqual(call)
    expect(
      readStoredSliceWalletCall(
        storage,
        call.id,
        call.createdAt + 24 * 60 * 60 * 1000 + 1
      )
    ).toBeNull()
  })
})
