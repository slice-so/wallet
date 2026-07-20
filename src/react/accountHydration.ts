"use client"

import { useCallback, useEffect } from "react"
import {
  type Address,
  type Chain,
  type Hex,
  isAddress,
  isAddressEqual,
  isHex
} from "viem"
import { anvil } from "viem/chains"
import {
  createKernelPasskeySliceAccountClient,
  createSliceKernelPasskeyTransport,
  getSliceBundlerApiUrl
} from "../execution"
import {
  buildRecoveryPermissionInitConfig,
  createSliceWalletCeremonyKernelAccount,
  createSliceWalletRegistryClient
} from "../index"
import type { SliceAccountClient } from "../types/accountClient"
import type { SliceWalletCeremonyMode } from "../types/ceremony"
import type { SliceWalletCeremonyBroker } from "../types/pendingCeremony"
import type {
  SliceWalletCredentialRecord,
  SliceWalletProviderAdapters,
  SliceWalletRecoverySnapshot,
  SliceWalletStatus
} from "../types/react"
import type { SliceWalletRegistryCredential } from "../types/registry"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

export const getSliceWalletCredentialStorage = () =>
  typeof window === "undefined" ? null : window.localStorage

export const toSliceWalletCredentialRecord = (
  value: SliceWalletRegistryCredential
): SliceWalletCredentialRecord => {
  if (
    !isHex(value.credentialIdHash, { strict: true }) ||
    !isHex(value.publicKey, { strict: true }) ||
    !isAddress(value.accountAddress) ||
    !Number.isSafeInteger(value.accountIndex) ||
    value.accountIndex < 0
  ) {
    throw new Error("Invalid Slice Wallet registry record.")
  }
  return {
    accountAddress: value.accountAddress,
    accountIndex: value.accountIndex,
    credentialIdHash: value.credentialIdHash,
    publicKey: value.publicKey,
    recoveryPermissionId: value.recoveryPermissionId,
    recoverySignerAddress: value.recoverySignerAddress
  }
}

export const readStoredSliceWalletMetadata = (storageKey: string) => {
  const value = getSliceWalletCredentialStorage()?.getItem(storageKey)
  if (value === null || value === undefined) return null
  try {
    const parsed = JSON.parse(value) as {
      accountAddress?: string
      accountIndex?: number
      credentialIdHash?: string
    }
    if (
      !isAddress(parsed.accountAddress ?? "") ||
      !isHex(parsed.credentialIdHash ?? "", { strict: true }) ||
      !Number.isSafeInteger(parsed.accountIndex) ||
      (parsed.accountIndex ?? -1) < 0
    ) {
      return null
    }
    return {
      accountAddress: parsed.accountAddress as Address,
      accountIndex: parsed.accountIndex as number,
      credentialIdHash: parsed.credentialIdHash as Hex
    }
  } catch {
    return null
  }
}

export const storeSliceWalletMetadata = (
  storageKey: string,
  credential: SliceWalletCredentialRecord
) => {
  getSliceWalletCredentialStorage()?.setItem(
    storageKey,
    JSON.stringify({
      accountAddress: credential.accountAddress,
      accountIndex: credential.accountIndex,
      credentialIdHash: credential.credentialIdHash
    })
  )
}

const devFundBalanceHex = `0x${(10n * 10n ** 18n).toString(16)}`

const fundDevWalletAccount = async (chain: Chain, address: Address) => {
  if (chain.id !== anvil.id) return
  const rpcUrl = chain.rpcUrls.default.http[0]
  if (!rpcUrl) return
  try {
    await fetch(rpcUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "anvil_setBalance",
        params: [address, devFundBalanceHex]
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    })
  } catch {
    // Funding is a dev convenience; checkout surfaces any gas shortfall.
  }
}

export const useSliceWalletAccountHydration = ({
  activeWalletRef,
  ceremonyBroker,
  ceremonyMode,
  checkoutEnabled,
  credentialStorageKey,
  fetchWalletRecovery,
  hydrateExecutionSession,
  hydrateManagementExecutionSession,
  managementEnabled,
  normalizedIdOrigin,
  publicClient,
  setAccountAddress,
  setHasStoredCredential,
  setRecovery,
  setSliceAccountClient,
  setStatus,
  walletChain
}: {
  activeWalletRef: {
    current: {
      credential: SliceWalletCredentialRecord
      kernelAccount: RootAccount
    } | null
  }
  ceremonyBroker: SliceWalletCeremonyBroker
  ceremonyMode: SliceWalletCeremonyMode
  checkoutEnabled: boolean
  credentialStorageKey: string
  fetchWalletRecovery: SliceWalletProviderAdapters["fetchWalletRecovery"]
  hydrateExecutionSession: (wallet: {
    credential: SliceWalletCredentialRecord
    kernelAccount: RootAccount
  }) => Promise<void>
  hydrateManagementExecutionSession: (wallet: {
    credential: SliceWalletCredentialRecord
    kernelAccount: RootAccount
  }) => Promise<void>
  managementEnabled: boolean
  normalizedIdOrigin: string
  publicClient: Parameters<
    typeof createSliceWalletCeremonyKernelAccount
  >[0]["client"]
  setAccountAddress: (address: Address | null) => void
  setHasStoredCredential: (stored: boolean) => void
  setRecovery: (snapshot: SliceWalletRecoverySnapshot | null) => void
  setSliceAccountClient: (client: SliceAccountClient | null) => void
  setStatus: (status: SliceWalletStatus) => void
  walletChain: Chain
}) => {
  const refreshRecovery = useCallback(async () => {
    const activeWallet = activeWalletRef.current
    if (!activeWallet || !fetchWalletRecovery) {
      setRecovery(null)
      return
    }
    try {
      setRecovery(
        await fetchWalletRecovery({
          address: activeWallet.kernelAccount.address
        })
      )
    } catch {
      setRecovery(null)
    }
  }, [activeWalletRef, fetchWalletRecovery, setRecovery])

  const activateCredential = useCallback(
    async (credential: SliceWalletCredentialRecord) => {
      const recovery =
        credential.recoveryPermissionId === null ||
        credential.recoverySignerAddress === null
          ? undefined
          : await buildRecoveryPermissionInitConfig({
              client: publicClient,
              recoverySignerAddress: credential.recoverySignerAddress
            })
      if (
        recovery !== undefined &&
        recovery.permissionId.toLowerCase() !==
          credential.recoveryPermissionId?.toLowerCase()
      ) {
        throw new Error("Slice wallet recovery metadata is inconsistent.")
      }
      const kernelAccount = await createSliceWalletCeremonyKernelAccount({
        address: credential.accountAddress,
        ceremonyBroker,
        ceremonyMode,
        chainId: walletChain.id,
        client: publicClient,
        credential: {
          credentialIdHash: credential.credentialIdHash,
          publicKey: credential.publicKey
        },
        document,
        idOrigin: normalizedIdOrigin,
        ...(recovery === undefined ? {} : { initConfig: recovery.initConfig }),
        window
      })
      if (!isAddressEqual(kernelAccount.address, credential.accountAddress)) {
        throw new Error("Slice wallet credential does not match its account.")
      }
      const nextSliceAccountClient = createKernelPasskeySliceAccountClient({
        account: kernelAccount.address,
        chainId: walletChain.id,
        transport: createSliceKernelPasskeyTransport({
          account: kernelAccount,
          bundlerUrl: getSliceBundlerApiUrl(window.location.origin),
          chain: walletChain,
          client: publicClient
        })
      })
      await fundDevWalletAccount(walletChain, kernelAccount.address)
      activeWalletRef.current = { credential, kernelAccount }
      setAccountAddress(kernelAccount.address)
      setSliceAccountClient(nextSliceAccountClient)
      setStatus("ready")
      if (checkoutEnabled)
        void hydrateExecutionSession({ credential, kernelAccount })
      if (managementEnabled)
        void hydrateManagementExecutionSession({ credential, kernelAccount })
      if (fetchWalletRecovery) void refreshRecovery()
      return { kernelAccount, sliceAccountClient: nextSliceAccountClient }
    },
    [
      activeWalletRef,
      ceremonyBroker,
      ceremonyMode,
      checkoutEnabled,
      fetchWalletRecovery,
      hydrateExecutionSession,
      hydrateManagementExecutionSession,
      managementEnabled,
      normalizedIdOrigin,
      publicClient,
      refreshRecovery,
      setAccountAddress,
      setSliceAccountClient,
      setStatus,
      walletChain
    ]
  )

  useEffect(() => {
    let active = true
    void (async () => {
      const metadata = readStoredSliceWalletMetadata(credentialStorageKey)
      setHasStoredCredential(metadata !== null)
      if (metadata === null) {
        setStatus("idle")
        return
      }
      try {
        const registered = await createSliceWalletRegistryClient({
          baseUrl: normalizedIdOrigin
        }).lookupCredential({
          accountAddress: metadata.accountAddress,
          credentialIdHash: metadata.credentialIdHash
        })
        if (
          registered === null ||
          !isAddressEqual(registered.accountAddress, metadata.accountAddress)
        ) {
          throw new Error("Stored Slice Wallet metadata is no longer valid.")
        }
        if (active)
          await activateCredential(toSliceWalletCredentialRecord(registered))
      } catch {
        if (!active) return
        setStatus("idle")
        setRecovery(null)
      }
    })()
    return () => {
      active = false
    }
  }, [
    activateCredential,
    credentialStorageKey,
    normalizedIdOrigin,
    setHasStoredCredential,
    setRecovery,
    setStatus
  ])

  return { activateCredential, refreshRecovery }
}
