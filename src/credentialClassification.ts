import {
  type Address,
  bytesToBigInt,
  hexToBytes,
  isAddressEqual,
  zeroAddress
} from "viem"
import { getChainId, getCode, multicall } from "viem/actions"
import { getAction } from "viem/utils"
import { predictSliceWalletKernelAccountAddress } from "./accountPrediction"
import { getSliceWalletChainPolicy } from "./chains"
import { sliceWalletKernelAddresses } from "./constants"
import { getSliceWalletDevicePermissionId } from "./deviceValidator"
import type { SliceWalletPublicClient } from "./types/account"
import type {
  SliceWalletCredentialRowClassification,
  SliceWalletRegistryCredential
} from "./types/registry"

const rootValidatorStorageAbi = [
  {
    inputs: [{ name: "kernel", type: "address" }],
    name: "webAuthnValidatorStorage",
    outputs: [
      { name: "pubKeyX", type: "uint256" },
      { name: "pubKeyY", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

const permissionConfigAbi = [
  {
    inputs: [{ name: "pId", type: "bytes4" }],
    name: "permissionConfig",
    outputs: [
      {
        components: [
          { name: "permissionFlag", type: "bytes2" },
          { name: "signer", type: "address" },
          { name: "policyData", type: "bytes22[]" }
        ],
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

const publicKeyCoordinates = (publicKey: `0x${string}`) => {
  const bytes = hexToBytes(publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) return null
  return {
    x: bytesToBigInt(bytes.slice(1, 33)),
    y: bytesToBigInt(bytes.slice(33, 65))
  }
}

export const isSliceWalletDevicePermissionActive = async ({
  account,
  chainId,
  client,
  credentialIdHash
}: {
  account: Address
  chainId: number
  client: SliceWalletPublicClient
  credentialIdHash: `0x${string}`
}) => {
  const config = await getAction(client, multicall, "multicall")({
    allowFailure: false,
    contracts: [
      {
        abi: permissionConfigAbi,
        address: account,
        args: [getSliceWalletDevicePermissionId(credentialIdHash)],
        functionName: "permissionConfig"
      }
    ]
  })
  const permission = config[0]
  return (
    permission !== undefined &&
    !isAddressEqual(permission.signer, zeroAddress) &&
    isAddressEqual(
      permission.signer,
      getSliceWalletChainPolicy(chainId).contracts.webAuthnSigner.address
    )
  )
}

export const classifySliceWalletCredentialRows = async ({
  chainId,
  client,
  rows
}: {
  chainId: number
  client: SliceWalletPublicClient
  rows: readonly SliceWalletRegistryCredential[]
}): Promise<readonly SliceWalletCredentialRowClassification[]> => {
  try {
    if ((await getAction(client, getChainId, "getChainId")({})) !== chainId) {
      return rows.map((credential) => ({
        credential,
        status: "unavailable"
      }))
    }
  } catch {
    return rows.map((credential) => ({
      credential,
      status: "unavailable"
    }))
  }

  const codeResults = await Promise.all(
    rows.map(async (credential) => {
      try {
        return {
          code: await getAction(client, getCode, "getCode")({
            address: credential.accountAddress
          }),
          status: "available" as const
        }
      } catch {
        return { status: "unavailable" as const }
      }
    })
  )
  const statuses: Array<"active" | "inactive" | "unavailable"> = rows.map(
    () => "unavailable"
  )
  const deployedRootIndexes: number[] = []
  const deployedDeviceIndexes: number[] = []

  await Promise.all(
    rows.map(async (credential, index) => {
      const codeResult = codeResults[index]
      if (codeResult?.status !== "available") return
      if (codeResult.code === undefined || codeResult.code === "0x") {
        if (
          credential.registrationKind === "device" ||
          credential.recoverySignerAddress === null
        ) {
          statuses[index] = "inactive"
          return
        }
        try {
          const derived = await predictSliceWalletKernelAccountAddress({
            chainId,
            credential: {
              credentialIdHash: credential.credentialIdHash,
              publicKey: credential.publicKey
            },
            index: BigInt(credential.accountIndex),
            recoverySignerAddress: credential.recoverySignerAddress
          })
          statuses[index] = isAddressEqual(derived, credential.accountAddress)
            ? "active"
            : "inactive"
        } catch {
          statuses[index] = "inactive"
        }
        return
      }
      if (credential.registrationKind === "device") {
        deployedDeviceIndexes.push(index)
      } else {
        deployedRootIndexes.push(index)
      }
    })
  )

  if (deployedRootIndexes.length > 0) {
    try {
      const results = await getAction(client, multicall, "multicall")({
        allowFailure: true,
        contracts: deployedRootIndexes.map((index) => ({
          abi: rootValidatorStorageAbi,
          address: sliceWalletKernelAddresses.webAuthnRootValidator,
          args: [rows[index]!.accountAddress],
          functionName: "webAuthnValidatorStorage"
        }))
      })
      results.forEach((result, resultIndex) => {
        const rowIndex = deployedRootIndexes[resultIndex]
        if (rowIndex === undefined || result.status === "failure") return
        const expected = publicKeyCoordinates(rows[rowIndex]!.publicKey)
        statuses[rowIndex] =
          expected !== null &&
          result.result[0] === expected.x &&
          result.result[1] === expected.y
            ? "active"
            : "inactive"
      })
    } catch {
      // The prefilled unavailable status is intentionally preserved.
    }
  }

  if (deployedDeviceIndexes.length > 0) {
    try {
      const expectedSigner =
        getSliceWalletChainPolicy(chainId).contracts.webAuthnSigner.address
      const results = await getAction(client, multicall, "multicall")({
        allowFailure: true,
        contracts: deployedDeviceIndexes.map((index) => ({
          abi: permissionConfigAbi,
          address: rows[index]!.accountAddress,
          args: [
            getSliceWalletDevicePermissionId(rows[index]!.credentialIdHash)
          ],
          functionName: "permissionConfig"
        }))
      })
      results.forEach((result, resultIndex) => {
        const rowIndex = deployedDeviceIndexes[resultIndex]
        if (rowIndex === undefined || result.status === "failure") return
        statuses[rowIndex] = isAddressEqual(result.result.signer, expectedSigner)
          ? "active"
          : "inactive"
      })
    } catch {
      // The prefilled unavailable status is intentionally preserved.
    }
  }

  return rows.map((credential, index) => ({
    credential,
    status: statuses[index] ?? "unavailable"
  }))
}
