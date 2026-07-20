import {
  createPublicClient,
  type Hex,
  http,
  isAddressEqual,
  type SignableMessage
} from "viem"
import {
  createBundlerClient,
  type SmartAccount
} from "viem/account-abstraction"
import {
  connectSliceWalletAccount,
  requestSliceWalletSession
} from "../ceremony/accountClient"
import { createSliceWalletCeremonyBroker } from "../ceremony/broker"
import { authorizeSliceWalletSessions } from "../ceremony/client"
import { parseSliceWalletFrameSession } from "../ceremony/protocol"
import { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
import { getSliceWalletChainManifest } from "../chains"
import { connectSliceWalletSignerFrame } from "../frame/client"
import { getSliceWalletP256SignerId } from "../p256Server"
import {
  buildSliceWalletPermissionUninstallCalls,
  createSliceWalletPermissionAccount
} from "../permissionAccount"
import {
  assertWalletCallsMatchPolicy,
  deserializeWalletPolicyDescriptor,
  getWalletPermissionId,
  getWalletPolicyHash,
  serializeWalletPolicyDescriptor
} from "../policy"
import { getSliceWalletRegistryRecoveryInitConfig } from "../recovery"
import { createSliceWalletRegistryClient } from "../registry"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletConnectedAccount,
  SliceWalletFrameSession,
  SliceWalletGenericGrant,
  SliceWalletGenericPermission,
  SliceWalletProviderValue,
  SliceWalletRegistryCredential,
  SliceWalletSessionConnectInput,
  SliceWalletSignerFrameClient,
  WalletCall,
  WalletPolicyDescriptor
} from "../types"
import type {
  SliceWalletProviderChainConfig,
  SliceWalletProviderConfig,
  SliceWalletRequestPaymasterService,
  StoredGenericGrant
} from "../types/providerInternal"
import { createSliceWalletAccountBundler } from "./accountBundler"
import { createSliceWalletCallTracker } from "./callTracker"
import {
  invalidProviderRequest,
  SliceWalletProviderRpcError,
  unauthorizedProviderRequest
} from "./errors"
import { revokeSliceWalletGrantState } from "./grantRevocation"
import { forwardSliceWalletRpc } from "./rpc"
import {
  clearStoredSliceWalletAccount,
  clearStoredSliceWalletGrant,
  readStoredSliceWalletAccount,
  readStoredSliceWalletCall,
  readStoredSliceWalletGrant,
  writeStoredSliceWalletAccount,
  writeStoredSliceWalletGrant
} from "./storage"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

type ActiveWallet = {
  credential: SliceWalletRegistryCredential
  rootAccount: RootAccount
}

type SliceWalletChainRuntimeConfig = Omit<
  SliceWalletProviderConfig,
  "chains" | "defaultChainId"
> &
  SliceWalletProviderChainConfig & {
    ceremonyBroker: SliceWalletCeremonyBroker
    getAccountGeneration: () => number
  }

const getBrowserDependencies = (
  config: Pick<SliceWalletProviderConfig, "document" | "storage" | "window">
) => {
  const browserWindow = config.window ?? globalThis.window
  const browserDocument = config.document ?? globalThis.document
  if (browserWindow === undefined || browserDocument === undefined) {
    throw new Error("Slice Wallet provider requires a browser environment.")
  }
  let storage: Storage | null = config.storage ?? null
  if (config.storage === undefined) {
    try {
      storage = browserWindow.localStorage
    } catch {
      storage = null
    }
  }
  return { browserDocument, browserWindow, storage }
}

const toFrameSession = (grant: StoredGenericGrant): SliceWalletFrameSession => {
  const policy = deserializeWalletPolicyDescriptor(grant.policy)
  if (
    getWalletPermissionId(policy, grant.signerId).toLowerCase() !==
      grant.permissionId.toLowerCase() ||
    getSliceWalletP256SignerId(grant.publicKey).toLowerCase() !==
      grant.signerId.toLowerCase()
  ) {
    throw new Error("Stored wallet grant does not match its signer or policy.")
  }
  return {
    account: grant.account,
    chainId: grant.chainId,
    expiresAt: grant.expiresAt,
    grantKind: "generic",
    permissionId: grant.permissionId,
    policy,
    publicKey: grant.publicKey,
    signerId: grant.signerId
  }
}

const createSliceWalletChainRuntime = (
  config: SliceWalletChainRuntimeConfig
) => {
  if (config.requireAdmittedChain === true) {
    getSliceWalletChainManifest(config.chain.id)
  }
  const { browserDocument, browserWindow, storage } =
    getBrowserDependencies(config)
  const idOrigin = new URL(config.idOrigin).origin
  const fetchImpl = config.fetch ?? fetch
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl)
  })
  const receiptClient = createBundlerClient({
    chain: config.chain,
    client: publicClient,
    transport: http(config.bundlerUrl)
  })
  let activeWallet: ActiveWallet | null = null
  let hydrationPromise: Promise<ActiveWallet | null> | null = null
  let framePromise: Promise<SliceWalletSignerFrameClient> | null = null

  const createRootAccount = async (
    credential: SliceWalletRegistryCredential
  ) => {
    const initConfig = await getSliceWalletRegistryRecoveryInitConfig({
      client: publicClient,
      credential
    })
    return createSliceWalletCeremonyKernelAccount({
      address: credential.accountAddress,
      ceremonyBroker: config.ceremonyBroker,
      ceremonyMode: config.ceremonyMode,
      chainId: config.chain.id,
      client: publicClient,
      credential: {
        credentialIdHash: credential.credentialIdHash,
        publicKey: credential.publicKey
      },
      document: browserDocument,
      idOrigin,
      index: BigInt(credential.accountIndex),
      ...(initConfig === undefined ? {} : { initConfig }),
      window: browserWindow
    })
  }

  const toActiveWallet = async (credential: SliceWalletRegistryCredential) => {
    const rootAccount = await createRootAccount(credential)
    if (!isAddressEqual(rootAccount.address, credential.accountAddress)) {
      throw new Error("Slice Wallet registry account does not match its root.")
    }
    return { credential, rootAccount }
  }

  const hydrate = async () => {
    if (activeWallet !== null) return activeWallet
    if (hydrationPromise !== null) return hydrationPromise
    const generation = config.getAccountGeneration()
    let pending!: Promise<ActiveWallet | null>
    pending = (async () => {
      const metadata = readStoredSliceWalletAccount(storage)
      if (metadata === null) return null
      try {
        const credential = await createSliceWalletRegistryClient({
          baseUrl: idOrigin,
          fetch: fetchImpl
        }).lookupCredential({
          accountAddress: metadata.accountAddress,
          credentialIdHash: metadata.credentialIdHash
        })
        if (
          credential === null ||
          !isAddressEqual(credential.accountAddress, metadata.accountAddress) ||
          credential.accountIndex !== metadata.accountIndex
        ) {
          if (
            config.getAccountGeneration() === generation &&
            hydrationPromise === pending
          ) {
            clearStoredSliceWalletAccount(storage)
            clearStoredSliceWalletGrant(
              storage,
              config.chain.id,
              metadata.accountAddress
            )
          }
          return null
        }
        const resolved = await toActiveWallet(credential)
        if (
          config.getAccountGeneration() !== generation ||
          hydrationPromise !== pending
        ) {
          return null
        }
        activeWallet = resolved
        return resolved
      } catch {
        // Registry and chain outages are transient. Keep the indexed account so
        // hydration can retry without silently disconnecting the user.
        return null
      }
    })().finally(() => {
      if (
        config.getAccountGeneration() === generation &&
        hydrationPromise === pending
      ) {
        hydrationPromise = null
      }
    })
    hydrationPromise = pending
    return pending
  }

  const requireActiveWallet = async () => {
    const wallet = await hydrate()
    if (wallet === null) throw unauthorizedProviderRequest()
    return wallet
  }

  const getFrame = async () => {
    if (framePromise !== null) return framePromise
    const generation = config.getAccountGeneration()
    let pending!: Promise<SliceWalletSignerFrameClient>
    pending = connectSliceWalletSignerFrame({
      document: browserDocument,
      frameUrl: new URL("/frame", idOrigin).href,
      window: browserWindow
    }).catch((error) => {
      if (
        config.getAccountGeneration() === generation &&
        framePromise === pending
      ) {
        framePromise = null
      }
      throw error
    })
    framePromise = pending
    return pending
  }

  const createAccountBundler = (
    account: SmartAccount,
    paymasterService?: SliceWalletRequestPaymasterService
  ) =>
    createSliceWalletAccountBundler({
      account,
      bundlerUrl: config.bundlerUrl,
      chain: config.chain,
      client: publicClient,
      ...(config.paymasterUrl === undefined
        ? {}
        : { defaultPaymasterUrl: config.paymasterUrl }),
      ...(paymasterService === undefined ? {} : { paymasterService })
    })

  const waitForSuccessfulUserOperation = async (hash: Hex) => {
    const receipt = await receiptClient.waitForUserOperationReceipt({ hash })
    if (!receipt.success) {
      throw new SliceWalletProviderRpcError(
        -32000,
        receipt.reason ?? "Wallet user operation reverted."
      )
    }
    return receipt
  }

  const ensureRecovery = async (
    wallet: ActiveWallet,
    connected: SliceWalletConnectedAccount
  ) => {
    if (connected.recovery === undefined) {
      throw new Error("Complete recovery enrollment before connecting.")
    }
    if (
      wallet.credential.recoveryPermissionId !== null &&
      (wallet.credential.recoveryPermissionId.toLowerCase() !==
        connected.recovery.permissionId.toLowerCase() ||
        wallet.credential.recoverySignerAddress?.toLowerCase() !==
          connected.recovery.signerAddress.toLowerCase())
    ) {
      throw new Error("Recovery permission does not match the registry.")
    }
  }

  const chooseAccount = async (session?: SliceWalletSessionConnectInput) => {
    const generation = config.getAccountGeneration()
    const connected = await connectSliceWalletAccount({
      ceremonyBroker: config.ceremonyBroker,
      chainId: config.chain.id,
      fetch: fetchImpl,
      idOrigin,
      ...(session === undefined ? {} : { session }),
      window: browserWindow
    })
    const wallet = await toActiveWallet(connected)
    await ensureRecovery(wallet, connected)
    if (config.getAccountGeneration() !== generation) {
      throw new Error("Wallet account selection was superseded.")
    }
    return { connected, wallet }
  }

  const commitAccount = ({
    connected,
    wallet
  }: Awaited<ReturnType<typeof chooseAccount>>) => {
    activeWallet = wallet
    writeStoredSliceWalletAccount(storage, {
      accountAddress: connected.accountAddress,
      accountIndex: connected.accountIndex,
      credentialIdHash: connected.credentialIdHash
    })
    return wallet
  }

  const connect = async () => {
    const hydrated = await hydrate()
    if (hydrated !== null) return hydrated
    if (readStoredSliceWalletAccount(storage) !== null) {
      throw new Error(
        "Slice Wallet account hydration is temporarily unavailable."
      )
    }
    return commitAccount(await chooseAccount())
  }

  const connectWithSession = async (
    session: SliceWalletSessionConnectInput
  ) => {
    const selection = await chooseAccount(session)
    const wallet = commitAccount(selection)
    return { session: selection.connected.session, wallet }
  }

  const requestSession = async () => {
    if (config.session === undefined) {
      throw new Error("Slice Wallet session integration is not configured.")
    }
    const wallet = await requireActiveWallet()
    const result = await requestSliceWalletSession({
      account: wallet.rootAccount.address,
      ceremonyBroker: config.ceremonyBroker,
      ceremonyMode: config.ceremonyMode,
      chainId: config.chain.id,
      document: config.document,
      fetch: fetchImpl,
      idOrigin,
      session: {
        audience: config.session.audience,
        prepare: config.session.prepare,
        ...(config.session.scopes === undefined
          ? {}
          : { scopes: config.session.scopes }),
        ...(config.session.ttlSeconds === undefined
          ? {}
          : { ttlSeconds: config.session.ttlSeconds })
      },
      window: browserWindow
    })
    await config.session.onSession?.(result)
    return result
  }

  const hydrateGrant = async () => {
    const wallet = await requireActiveWallet()
    const stored = readStoredSliceWalletGrant(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    if (
      stored === null ||
      stored.chainId !== config.chain.id ||
      !isAddressEqual(stored.account, wallet.rootAccount.address)
    ) {
      return null
    }
    const expected = toFrameSession(stored)
    const result = await (await getFrame()).request({
      method: "getSession",
      params: {
        account: stored.account,
        chainId: stored.chainId,
        grantKind: "generic"
      }
    })
    if (result === null || typeof result !== "object") {
      clearStoredSliceWalletGrant(
        storage,
        config.chain.id,
        wallet.rootAccount.address
      )
      return null
    }
    const session = parseSliceWalletFrameSession(result)
    if (
      session.permissionId.toLowerCase() !==
        expected.permissionId.toLowerCase() ||
      session.publicKey.toLowerCase() !== expected.publicKey.toLowerCase() ||
      session.signerId.toLowerCase() !== expected.signerId.toLowerCase() ||
      getWalletPolicyHash(session.policy) !==
        getWalletPolicyHash(expected.policy)
    ) {
      clearStoredSliceWalletGrant(
        storage,
        config.chain.id,
        wallet.rootAccount.address
      )
      return null
    }
    return { session, stored }
  }

  const sendCallsWithBestAuthority = async (
    calls: readonly WalletCall[],
    paymasterService?: SliceWalletRequestPaymasterService
  ) => {
    const wallet = await requireActiveWallet()
    const grant = await hydrateGrant()
    if (grant !== null) {
      try {
        assertWalletCallsMatchPolicy(calls, grant.session.policy)
      } catch {
        return createAccountBundler(
          wallet.rootAccount,
          paymasterService
        ).sendUserOperation({ calls })
      }
      const permissionAccount = await createSliceWalletPermissionAccount({
        address: wallet.rootAccount.address,
        accountIndex: BigInt(wallet.credential.accountIndex),
        client: publicClient,
        credential: {
          credentialIdHash: wallet.credential.credentialIdHash,
          publicKey: wallet.credential.publicKey
        },
        enableSignature: grant.stored.enableSignature,
        frameClient: await getFrame(),
        getFactoryArgs: () => wallet.rootAccount.getFactoryArgs(),
        mode: "generic",
        session: grant.session
      })
      return createAccountBundler(
        permissionAccount,
        paymasterService
      ).sendUserOperation({ calls })
    }
    return createAccountBundler(
      wallet.rootAccount,
      paymasterService
    ).sendUserOperation({ calls })
  }

  const callTracker = createSliceWalletCallTracker({
    chainId: config.chain.id,
    crypto: browserWindow.crypto,
    getUserOperationReceipt: (hash) =>
      receiptClient.getUserOperationReceipt({ hash }),
    sendUserOperation: sendCallsWithBestAuthority,
    storage
  })

  const uninstallGrant = async (stored: StoredGenericGrant) => {
    const wallet = await requireActiveWallet()
    const session = toFrameSession(stored)
    const code = await publicClient.getCode({
      address: wallet.rootAccount.address
    })
    if (code !== undefined) {
      const { calls } = await buildSliceWalletPermissionUninstallCalls({
        account: wallet.rootAccount.address,
        client: publicClient,
        session
      })
      if (calls.length > 0) {
        const hash = await createAccountBundler(
          wallet.rootAccount
        ).sendUserOperation({ calls })
        await waitForSuccessfulUserOperation(hash)
      }
    }
  }

  const revokeGrant = async (permissionId?: Hex) => {
    const account =
      activeWallet?.credential.accountAddress ??
      readStoredSliceWalletAccount(storage)?.accountAddress
    if (account === undefined) return
    const stored = readStoredSliceWalletGrant(storage, config.chain.id, account)
    if (stored === null) return
    if (
      permissionId !== undefined &&
      stored.permissionId.toLowerCase() !== permissionId.toLowerCase()
    ) {
      throw invalidProviderRequest(
        "Permission id does not match this origin's grant."
      )
    }
    await revokeSliceWalletGrantState({
      clearSession: async () => {
        await (await getFrame()).request({
          method: "clearSession",
          params: {
            account: stored.account,
            chainId: stored.chainId,
            grantKind: "generic"
          }
        })
      },
      clearStored: () =>
        clearStoredSliceWalletGrant(storage, config.chain.id, stored.account),
      permissionId: stored.permissionId,
      uninstall: () => uninstallGrant(stored)
    })
  }

  const createGrant = async ({
    permissions,
    policy
  }: {
    permissions: readonly SliceWalletGenericPermission[]
    policy: WalletPolicyDescriptor
  }) => {
    const wallet = await requireActiveWallet()
    const previous = readStoredSliceWalletGrant(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    const frame = await getFrame()
    const result = await frame.request({
      method: "createSession",
      params: { policy }
    })
    if (result === null || typeof result !== "object") {
      throw new Error("Slice signer frame did not create a permission session.")
    }
    const session = parseSliceWalletFrameSession(result)
    try {
      const [authorization] = await authorizeSliceWalletSessions({
        ceremonyBroker: config.ceremonyBroker,
        ceremonyMode: config.ceremonyMode,
        document: browserDocument,
        idOrigin,
        sessions: [session],
        window: browserWindow
      })
      if (authorization === undefined) {
        throw new Error("Wallet ceremony returned no authorization.")
      }
      if (
        previous !== null &&
        previous.permissionId.toLowerCase() !==
          session.permissionId.toLowerCase()
      ) {
        await uninstallGrant(previous)
      }
      await frame.request({
        method: "commitSession",
        params: {
          account: session.account,
          chainId: session.chainId,
          grantKind: session.grantKind
        }
      })
      const stored: StoredGenericGrant = {
        account: session.account,
        chainId: session.chainId,
        createdAt: Math.floor(Date.now() / 1000),
        enableSignature: authorization.enableSignature,
        expiresAt: session.expiresAt,
        permissionId: session.permissionId,
        policy: serializeWalletPolicyDescriptor(session.policy),
        publicKey: session.publicKey,
        signerId: session.signerId
      }
      writeStoredSliceWalletGrant(storage, stored)
      return {
        account: session.account,
        chainId: session.chainId,
        expiresAt: session.expiresAt,
        permissionId: session.permissionId,
        permissions,
        version: "1" as const
      }
    } catch (error) {
      await frame.request({
        method: "discardSession",
        params: {
          account: session.account,
          chainId: session.chainId,
          grantKind: "generic"
        }
      })
      throw error
    }
  }

  const getGrants = async (): Promise<readonly SliceWalletGenericGrant[]> => {
    const grant = await hydrateGrant()
    if (grant === null) return []
    const { enableSignature: _enableSignature, ...publicGrant } = grant.stored
    return [publicGrant]
  }

  const rotateGrant = async (permissionId: Hex) => {
    const wallet = await requireActiveWallet()
    const stored = readStoredSliceWalletGrant(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    if (
      stored === null ||
      stored.permissionId.toLowerCase() !== permissionId.toLowerCase()
    ) {
      throw invalidProviderRequest(
        "Permission id does not match this origin's grant."
      )
    }
    const policy = deserializeWalletPolicyDescriptor(stored.policy)
    await createGrant({ permissions: [], policy })
    const [rotated] = await getGrants()
    if (rotated === undefined) {
      throw new Error("Rotated wallet grant could not be restored.")
    }
    return rotated
  }

  const signMessage = async (message: SignableMessage) =>
    (await requireActiveWallet()).rootAccount.signMessage({ message })

  const signTypedData = async (typedDataJson: string) => {
    const wallet = await requireActiveWallet()
    const parsed = JSON.parse(typedDataJson) as SliceWalletProviderValue
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw invalidProviderRequest("Typed data must be a JSON object.")
    }
    return wallet.rootAccount.signTypedData(
      parsed as Parameters<RootAccount["signTypedData"]>[0]
    )
  }

  return {
    chainId: config.chain.id,
    chooseAccount,
    commitAccount,
    connect,
    connectWithSession,
    createGrant,
    destroy: () => {
      void framePromise?.then((frame) => frame.destroy())
      framePromise = null
      hydrationPromise = null
      activeWallet = null
    },
    forwardRpc: (
      method: string,
      params: SliceWalletProviderValue | undefined
    ) =>
      forwardSliceWalletRpc({
        fetch: fetchImpl,
        method,
        params,
        rpcUrl: config.rpcUrl
      }),
    getAccounts: async () => {
      const wallet = await hydrate()
      return wallet === null ? [] : [wallet.rootAccount.address]
    },
    hasCall: callTracker.hasCall,
    getCallsStatus: callTracker.getCallsStatus,
    getGrants,
    paymasterAvailable: config.paymasterUrl !== undefined,
    revokeGrant,
    requestSession,
    rotateGrant,
    sendCalls: callTracker.sendCalls,
    signMessage,
    signTypedData,
    waitForSuccessfulUserOperation
  }
}

type SliceWalletChainRuntime = ReturnType<typeof createSliceWalletChainRuntime>

export const createSliceWalletProviderRuntime = (
  config: SliceWalletProviderConfig,
  dependencies: {
    createChainRuntime?: typeof createSliceWalletChainRuntime
  } = {}
) => {
  const createChainRuntime =
    dependencies.createChainRuntime ?? createSliceWalletChainRuntime
  const ceremonyBroker = createSliceWalletCeremonyBroker()
  let accountGeneration = 0
  const chainConfigs = new Map(
    config.chains.map((chainConfig) => [chainConfig.chain.id, chainConfig])
  )
  if (
    chainConfigs.size !== config.chains.length ||
    !chainConfigs.has(config.defaultChainId)
  ) {
    throw invalidProviderRequest(
      "Slice Wallet runtime requires unique chains and a configured default."
    )
  }

  const runtimes = new Map<number, SliceWalletChainRuntime>()
  let activeChainId = config.defaultChainId
  const getChainRuntime = (chainId = activeChainId) => {
    const chainConfig = chainConfigs.get(chainId)
    if (chainConfig === undefined) {
      throw new SliceWalletProviderRpcError(
        4902,
        `Slice Wallet chain ${chainId} is unsupported.`
      )
    }
    let runtime = runtimes.get(chainId)
    if (runtime === undefined) {
      runtime = createChainRuntime({
        ...config,
        ...chainConfig,
        ceremonyBroker,
        getAccountGeneration: () => accountGeneration
      })
      runtimes.set(chainId, runtime)
    }
    return runtime
  }
  const getCallRuntime = (id: string) => {
    const { storage } = getBrowserDependencies(config)
    const call = readStoredSliceWalletCall(storage, id)
    if (call !== null) return getChainRuntime(call.chainId)
    for (const runtime of runtimes.values()) {
      if (runtime.hasCall(id)) return runtime
    }
    return getChainRuntime(activeChainId)
  }

  let switchQueue = Promise.resolve()
  const withSwitchMutex = async <Result>(operation: () => Promise<Result>) => {
    const previous = switchQueue
    let release = () => {}
    switchQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  const destroyChainRuntimes = () => {
    for (const runtime of runtimes.values()) runtime.destroy()
    runtimes.clear()
  }

  const switchAccount = () =>
    withSwitchMutex(async () => {
      accountGeneration += 1
      const generation = accountGeneration
      const { storage } = getBrowserDependencies(config)
      const snapshot = readStoredSliceWalletAccount(storage)
      if (snapshot === null) return getChainRuntime().connect()

      ceremonyBroker.cancel()
      destroyChainRuntimes()
      try {
        const runtime = getChainRuntime()
        const selection = await runtime.chooseAccount()
        if (accountGeneration !== generation) {
          throw new Error("Wallet account switch was superseded.")
        }
        if (
          isAddressEqual(
            selection.connected.accountAddress,
            snapshot.accountAddress
          ) &&
          selection.connected.accountIndex === snapshot.accountIndex
        ) {
          runtime.destroy()
          runtimes.clear()
          return getChainRuntime().connect()
        }
        for (const chainId of chainConfigs.keys()) {
          clearStoredSliceWalletGrant(storage, chainId, snapshot.accountAddress)
        }
        return runtime.commitAccount(selection)
      } catch (error) {
        destroyChainRuntimes()
        try {
          await getChainRuntime().connect()
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Wallet account switch failed and the previous account could not be rehydrated."
          )
        }
        throw error
      }
    })

  return {
    get chainId() {
      return activeChainId
    },
    connect: () => getChainRuntime().connect(),
    connectWithSession: (session: SliceWalletSessionConnectInput) =>
      getChainRuntime().connectWithSession(session),
    requestSession: () => getChainRuntime().requestSession(),
    continueInPopup: () => ceremonyBroker.continueInPopup(),
    cancelPendingCeremony: () => ceremonyBroker.cancel(),
    createGrant: (
      ...args: Parameters<SliceWalletChainRuntime["createGrant"]>
    ) => getChainRuntime().createGrant(...args),
    destroy: () => {
      ceremonyBroker.cancel()
      accountGeneration += 1
      destroyChainRuntimes()
    },
    disconnect: async () => {
      ceremonyBroker.cancel()
      const { storage } = getBrowserDependencies(config)
      const revocations = [...chainConfigs.keys()].map((chainId) =>
        getChainRuntime(chainId).revokeGrant()
      )
      const results = await Promise.allSettled(revocations)
      for (const runtime of runtimes.values()) runtime.destroy()
      runtimes.clear()
      const failures: Error[] = []
      for (const result of results) {
        if (result.status !== "rejected") continue
        failures.push(
          result.reason instanceof Error
            ? result.reason
            : new Error("Wallet permission revocation failed unexpectedly.")
        )
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `${failures.length} wallet permission revocation${failures.length === 1 ? "" : "s"} failed during disconnect.`
        )
      }
      clearStoredSliceWalletAccount(storage)
    },
    forwardRpc: (...args: Parameters<SliceWalletChainRuntime["forwardRpc"]>) =>
      getChainRuntime().forwardRpc(...args),
    getAccounts: () => getChainRuntime().getAccounts(),
    getCallsStatus: (id: string) => getCallRuntime(id).getCallsStatus(id),
    getChainRuntime,
    getGrants: () => getChainRuntime().getGrants(),
    paymasterAvailable: (chainId = activeChainId) =>
      getChainRuntime(chainId).paymasterAvailable,
    get pendingCeremony() {
      return ceremonyBroker.getPending()
    },
    revokeGrant: (
      ...args: Parameters<SliceWalletChainRuntime["revokeGrant"]>
    ) => getChainRuntime().revokeGrant(...args),
    rotateGrant: (
      ...args: Parameters<SliceWalletChainRuntime["rotateGrant"]>
    ) => getChainRuntime().rotateGrant(...args),
    sendCalls: (
      calls: Parameters<SliceWalletChainRuntime["sendCalls"]>[0],
      requestedId?: Parameters<SliceWalletChainRuntime["sendCalls"]>[1],
      paymasterService?: Parameters<SliceWalletChainRuntime["sendCalls"]>[2],
      chainId = activeChainId
    ) =>
      getChainRuntime(chainId).sendCalls(calls, requestedId, paymasterService),
    signMessage: (
      ...args: Parameters<SliceWalletChainRuntime["signMessage"]>
    ) => getChainRuntime().signMessage(...args),
    signTypedData: (
      ...args: Parameters<SliceWalletChainRuntime["signTypedData"]>
    ) => getChainRuntime().signTypedData(...args),
    supportedChainIds: Object.freeze([...chainConfigs.keys()]),
    switchAccount,
    switchChain: (chainId: number) => {
      getChainRuntime(chainId)
      if (activeChainId !== chainId) ceremonyBroker.cancel()
      activeChainId = chainId
    },
    waitForSuccessfulUserOperation: (hash: Hex, chainId = activeChainId) =>
      getChainRuntime(chainId).waitForSuccessfulUserOperation(hash)
  }
}
