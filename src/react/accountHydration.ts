"use client"

import { useCallback, useEffect } from "react"
import {
  type Address,
  type Chain,
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
import { readStoredSliceWalletAccount } from "../provider/storage"
import type { SliceAccountClient } from "../types/accountClient"
import type { SliceWalletCeremonyMode } from "../types/ceremony"
import type { SliceWalletCeremonyBroker } from "../types/pendingCeremony"
import type {
  SliceWalletCredentialRecord,
  SliceWalletManagementLifecycle,
  SliceWalletManagementLifecycleControl,
  SliceWalletProviderAdapters,
  SliceWalletRecoverySnapshot,
  SliceWalletStatus
} from "../types/react"
import type { SliceWalletRegistryCredential } from "../types/registry"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

const getSliceWalletCredentialStorage = () =>
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

export const shouldCommitActivation = ({
  active,
  builtAddress,
  connectedAccount
}: {
  active: boolean
  builtAddress: Address
  connectedAccount: Address | null
}) =>
  active &&
  connectedAccount !== null &&
  isAddressEqual(builtAddress, connectedAccount)

export const shouldLockReplacedSliceAccount = ({
  connectedAccount,
  previousAccount
}: {
  connectedAccount: Address | null
  previousAccount: Address
}) =>
  connectedAccount !== null &&
  !isAddressEqual(previousAccount, connectedAccount)

export const useSliceWalletAccountHydration = ({
  activeWalletRef,
  ceremonyBroker,
  ceremonyMode,
  checkoutEnabled,
  connectedAccount,
  fetchWalletRecovery,
  hydrateExecutionSession,
  hydrateManagementExecutionSession,
  managementLifecycle,
  managementEnabled,
  normalizedIdOrigin,
  publicClient,
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
  connectedAccount: Address | null
  fetchWalletRecovery: SliceWalletProviderAdapters["fetchWalletRecovery"]
  hydrateExecutionSession: (wallet: {
    credential: SliceWalletCredentialRecord
    kernelAccount: RootAccount
  }) => Promise<void>
  hydrateManagementExecutionSession: (wallet: {
    credential: SliceWalletCredentialRecord
    kernelAccount: RootAccount
    control: SliceWalletManagementLifecycleControl
  }) => Promise<void>
  managementLifecycle: SliceWalletManagementLifecycle
  managementEnabled: boolean
  normalizedIdOrigin: string
  publicClient: Parameters<
    typeof createSliceWalletCeremonyKernelAccount
  >[0]["client"]
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

  const buildCredentialActivation = useCallback(
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
      return {
        credential,
        kernelAccount,
        sliceAccountClient: nextSliceAccountClient
      }
    },
    [
      ceremonyBroker,
      ceremonyMode,
      normalizedIdOrigin,
      publicClient,
      walletChain
    ]
  )

  const activateConnectedAccount = useCallback(
    async (account: Address) => {
      const metadata = readStoredSliceWalletAccount(
        getSliceWalletCredentialStorage()
      )
      setHasStoredCredential(metadata !== null)
      if (
        metadata === null ||
        !isAddressEqual(metadata.accountAddress, account)
      ) {
        throw new Error("The connected Slice Wallet account is not stored.")
      }
      const registered = await createSliceWalletRegistryClient({
        baseUrl: normalizedIdOrigin
      }).lookupCredential({
        accountAddress: metadata.accountAddress,
        credentialIdHash: metadata.credentialIdHash
      })
      if (
        registered === null ||
        !isAddressEqual(registered.accountAddress, account) ||
        registered.accountIndex !== metadata.accountIndex
      ) {
        throw new Error("Stored Slice Wallet metadata is no longer valid.")
      }
      return buildCredentialActivation(
        toSliceWalletCredentialRecord(registered)
      )
    },
    [buildCredentialActivation, normalizedIdOrigin, setHasStoredCredential]
  )

  useEffect(() => {
    let active = true
    void (async () => {
      const metadata = readStoredSliceWalletAccount(
        getSliceWalletCredentialStorage()
      )
      setHasStoredCredential(metadata !== null)
      if (connectedAccount === null) {
        activeWalletRef.current = null
        setSliceAccountClient(null)
        setRecovery(null)
        setStatus("idle")
        return
      }
      setStatus("loading")
      try {
        const built = await activateConnectedAccount(connectedAccount)
        if (
          !shouldCommitActivation({
            active,
            builtAddress: built.kernelAccount.address,
            connectedAccount
          })
        ) {
          return
        }
        activeWalletRef.current = {
          credential: built.credential,
          kernelAccount: built.kernelAccount
        }
        setSliceAccountClient(built.sliceAccountClient)
        setStatus("ready")
        if (checkoutEnabled) {
          void hydrateExecutionSession({
            credential: built.credential,
            kernelAccount: built.kernelAccount
          })
        }
        if (managementEnabled) {
          void managementLifecycle
            .runHydration(connectedAccount, (control) =>
              hydrateManagementExecutionSession({
                credential: built.credential,
                control,
                kernelAccount: built.kernelAccount
              })
            )
            .catch(() => undefined)
        } else {
          managementLifecycle.markNothingToHydrate(connectedAccount)
        }
        if (fetchWalletRecovery) void refreshRecovery()
      } catch {
        if (!active) return
        activeWalletRef.current = null
        setSliceAccountClient(null)
        setStatus("idle")
        setRecovery(null)
        if (managementEnabled) {
          managementLifecycle.markHydrationError(
            connectedAccount,
            "transport-unavailable"
          )
        } else {
          managementLifecycle.markNothingToHydrate(connectedAccount)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [
    activateConnectedAccount,
    activeWalletRef,
    checkoutEnabled,
    connectedAccount,
    fetchWalletRecovery,
    hydrateExecutionSession,
    hydrateManagementExecutionSession,
    managementEnabled,
    managementLifecycle,
    refreshRecovery,
    setHasStoredCredential,
    setRecovery,
    setSliceAccountClient,
    setStatus
  ])

  return { refreshRecovery }
}
