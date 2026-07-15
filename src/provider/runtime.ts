import {
  createPublicClient,
  type Hex,
  http,
  isAddressEqual,
  type SignableMessage
} from "viem"
import {
  createBundlerClient,
  createPaymasterClient,
  type SmartAccount
} from "viem/account-abstraction"
import { connectSliceWalletAccount } from "../ceremony/accountClient"
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
  SliceWalletConnectedAccount,
  SliceWalletFrameSession,
  SliceWalletGenericGrant,
  SliceWalletGenericPermission,
  SliceWalletProviderValue,
  SliceWalletRegistryCredential,
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
import { createSliceWalletCallTracker } from "./callTracker"
import {
  invalidProviderRequest,
  SliceWalletProviderRpcError,
  unauthorizedProviderRequest
} from "./errors"
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
  SliceWalletProviderChainConfig

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
    hydrationPromise = (async () => {
      const metadata = readStoredSliceWalletAccount(storage)
      if (metadata === null) return null
      try {
        const credential = await createSliceWalletRegistryClient({
          baseUrl: idOrigin,
          fetch: fetchImpl
        }).getCredential(metadata.credentialIdHash)
        if (
          credential === null ||
          !isAddressEqual(credential.accountAddress, metadata.accountAddress)
        ) {
          throw new Error("Stored wallet metadata does not match the registry.")
        }
        activeWallet = await toActiveWallet(credential)
        return activeWallet
      } catch {
        clearStoredSliceWalletAccount(storage)
        clearStoredSliceWalletGrant(storage, config.chain.id)
        return null
      }
    })().finally(() => {
      hydrationPromise = null
    })
    return hydrationPromise
  }

  const requireActiveWallet = async () => {
    const wallet = await hydrate()
    if (wallet === null) throw unauthorizedProviderRequest()
    return wallet
  }

  const getFrame = async () => {
    if (framePromise !== null) return framePromise
    framePromise = connectSliceWalletSignerFrame({
      document: browserDocument,
      frameUrl: new URL("/frame", idOrigin).href,
      window: browserWindow
    }).catch((error) => {
      framePromise = null
      throw error
    })
    return framePromise
  }

  const createAccountBundler = (
    account: SmartAccount,
    paymasterService?: SliceWalletRequestPaymasterService
  ) => {
    const paymasterUrl = paymasterService?.url ?? config.paymasterUrl
    const paymasterClient =
      paymasterUrl === undefined
        ? undefined
        : createPaymasterClient({ transport: http(paymasterUrl) })
    return createBundlerClient({
      account,
      chain: config.chain,
      client: publicClient,
      ...(paymasterClient === undefined ? {} : { paymaster: paymasterClient }),
      ...(paymasterService?.context === undefined
        ? {}
        : { paymasterContext: paymasterService.context.value }),
      transport: http(config.bundlerUrl)
    })
  }

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

  const connect = async () => {
    const hydrated = await hydrate()
    if (hydrated !== null) return hydrated
    const connected = await connectSliceWalletAccount({
      chainId: config.chain.id,
      fetch: fetchImpl,
      idOrigin,
      window: browserWindow
    })
    const wallet = await toActiveWallet(connected)
    await ensureRecovery(wallet, connected)
    activeWallet = wallet
    writeStoredSliceWalletAccount(storage, {
      accountAddress: connected.accountAddress,
      credentialIdHash: connected.credentialIdHash
    })
    return wallet
  }

  const hydrateGrant = async () => {
    const wallet = await requireActiveWallet()
    const stored = readStoredSliceWalletGrant(storage, config.chain.id)
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
      clearStoredSliceWalletGrant(storage, config.chain.id)
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
      clearStoredSliceWalletGrant(storage, config.chain.id)
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
    const stored = readStoredSliceWalletGrant(storage, config.chain.id)
    if (stored === null) return
    if (
      permissionId !== undefined &&
      stored.permissionId.toLowerCase() !== permissionId.toLowerCase()
    ) {
      throw invalidProviderRequest(
        "Permission id does not match this origin's grant."
      )
    }
    await uninstallGrant(stored)
    clearStoredSliceWalletGrant(storage, config.chain.id)
    try {
      await (await getFrame()).request({
        method: "clearSession",
        params: {
          account: stored.account,
          chainId: stored.chainId,
          grantKind: "generic"
        }
      })
    } catch {
      // On-chain revocation is authoritative; stale frame storage cannot execute.
    }
  }

  const createGrant = async ({
    permissions,
    policy
  }: {
    permissions: readonly SliceWalletGenericPermission[]
    policy: WalletPolicyDescriptor
  }) => {
    const previous = readStoredSliceWalletGrant(storage, config.chain.id)
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
        ceremonyMode: config.ceremonyMode,
        document: browserDocument,
        frameClient: frame,
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
        signerId: session.signerId,
        version: 1
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
    const {
      enableSignature: _enableSignature,
      version: _version,
      ...publicGrant
    } = grant.stored
    return [publicGrant]
  }

  const rotateGrant = async (permissionId: Hex) => {
    const stored = readStoredSliceWalletGrant(storage, config.chain.id)
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
    connect,
    createGrant,
    destroy: () => {
      void framePromise?.then((frame) => frame.destroy())
      framePromise = null
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
    getCallsStatus: callTracker.getCallsStatus,
    getGrants,
    paymasterAvailable: config.paymasterUrl !== undefined,
    revokeGrant,
    rotateGrant,
    sendCalls: callTracker.sendCalls,
    signMessage,
    signTypedData,
    waitForSuccessfulUserOperation
  }
}

type SliceWalletChainRuntime = ReturnType<typeof createSliceWalletChainRuntime>

export const createSliceWalletProviderRuntime = (
  config: SliceWalletProviderConfig
) => {
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
      runtime = createSliceWalletChainRuntime({
        ...config,
        ...chainConfig
      })
      runtimes.set(chainId, runtime)
    }
    return runtime
  }
  const getCallRuntime = (id: string) => {
    const { storage } = getBrowserDependencies(config)
    const call = readStoredSliceWalletCall(storage, id)
    return getChainRuntime(call?.chainId ?? activeChainId)
  }

  return {
    get chainId() {
      return activeChainId
    },
    connect: () => getChainRuntime().connect(),
    createGrant: (
      ...args: Parameters<SliceWalletChainRuntime["createGrant"]>
    ) => getChainRuntime().createGrant(...args),
    destroy: () => {
      for (const runtime of runtimes.values()) runtime.destroy()
      runtimes.clear()
    },
    disconnect: async () => {
      for (const chainId of chainConfigs.keys()) {
        await getChainRuntime(chainId).revokeGrant()
      }
      const { storage } = getBrowserDependencies(config)
      clearStoredSliceWalletAccount(storage)
      for (const runtime of runtimes.values()) runtime.destroy()
      runtimes.clear()
    },
    forwardRpc: (...args: Parameters<SliceWalletChainRuntime["forwardRpc"]>) =>
      getChainRuntime().forwardRpc(...args),
    getAccounts: () => getChainRuntime().getAccounts(),
    getCallsStatus: (id: string) => getCallRuntime(id).getCallsStatus(id),
    getChainRuntime,
    getGrants: () => getChainRuntime().getGrants(),
    paymasterAvailable: (chainId = activeChainId) =>
      getChainRuntime(chainId).paymasterAvailable,
    revokeGrant: (
      ...args: Parameters<SliceWalletChainRuntime["revokeGrant"]>
    ) => getChainRuntime().revokeGrant(...args),
    rotateGrant: (
      ...args: Parameters<SliceWalletChainRuntime["rotateGrant"]>
    ) => getChainRuntime().rotateGrant(...args),
    sendCalls: (...args: Parameters<SliceWalletChainRuntime["sendCalls"]>) =>
      getChainRuntime().sendCalls(...args),
    signMessage: (
      ...args: Parameters<SliceWalletChainRuntime["signMessage"]>
    ) => getChainRuntime().signMessage(...args),
    signTypedData: (
      ...args: Parameters<SliceWalletChainRuntime["signTypedData"]>
    ) => getChainRuntime().signTypedData(...args),
    supportedChainIds: Object.freeze([...chainConfigs.keys()]),
    switchChain: (chainId: number) => {
      getChainRuntime(chainId)
      activeChainId = chainId
    },
    waitForSuccessfulUserOperation: (hash: Hex, chainId = activeChainId) =>
      getChainRuntime(chainId).waitForSuccessfulUserOperation(hash)
  }
}
