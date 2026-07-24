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
import { predictSliceWalletKernelAccountAddressFromInitConfig } from "../accountPrediction"
import {
  connectSliceWalletAccount,
  requestSliceWalletSession
} from "../ceremony/accountClient"
import { createSliceWalletCeremonyBroker } from "../ceremony/broker"
import { authorizeSliceWalletSessions } from "../ceremony/client"
import { parseSliceWalletFrameSession } from "../ceremony/protocol"
import { createSliceWalletCeremonyKernelAccount } from "../ceremony/rootAccountClient"
import {
  assertSliceWalletAuthorityDeployment,
  getSliceWalletChainManifest
} from "../chains"
import { acquireSliceWalletSignerFrame } from "../frame/client"
import { getSliceWalletP256SignerId } from "../p256Server"
import {
  buildSliceWalletPermissionInstallCalls,
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
import {
  createSliceWalletRegistryClient,
  SliceWalletRegistryRequestError
} from "../registry"
import {
  getSliceWalletRootValidatorPublicKey,
  parseSliceWalletUncompressedPublicKey
} from "../rootValidator"
import type {
  SliceWalletCeremonyBroker,
  SliceWalletConnectedAccount,
  SliceWalletFrameSession,
  SliceWalletGenericPermission,
  SliceWalletPendingCeremony,
  SliceWalletPermissionGrant,
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
  StoredGenericGrant,
  StoredGenericGrantRotation
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
  clearStoredSliceWalletGrantRotation,
  readStoredSliceWalletAccount,
  readStoredSliceWalletCall,
  readStoredSliceWalletGrant,
  readStoredSliceWalletGrantRotation,
  storedSliceWalletGrantsMatch,
  writeStoredSliceWalletAccount,
  writeStoredSliceWalletGrant,
  writeStoredSliceWalletGrantRotation
} from "./storage"

type RootAccount = Awaited<
  ReturnType<typeof createSliceWalletCeremonyKernelAccount>
>

type ActiveWallet = {
  credential: SliceWalletRegistryCredential
  rootAccount: RootAccount
}

export const deriveSliceWalletRegistryAccountAddress = async ({
  client,
  credential
}: Parameters<typeof getSliceWalletRegistryRecoveryInitConfig>[0]) => {
  const initConfig = await getSliceWalletRegistryRecoveryInitConfig({
    client,
    credential
  })
  return {
    address: predictSliceWalletKernelAccountAddressFromInitConfig({
      credential: {
        credentialIdHash: credential.credentialIdHash,
        publicKey: credential.publicKey
      },
      index: BigInt(credential.accountIndex),
      ...(initConfig === undefined ? {} : { initConfig })
    }),
    initConfig
  }
}

export const assertSliceWalletRegistryAccountIdentity = async (
  parameters: Parameters<typeof deriveSliceWalletRegistryAccountAddress>[0]
) => {
  const derived = await deriveSliceWalletRegistryAccountAddress(parameters)
  if (!isAddressEqual(derived.address, parameters.credential.accountAddress)) {
    throw new Error("Slice Wallet registry account does not match its root.")
  }
  return derived
}

export const assertSliceWalletDeployedRootIdentity = ({
  credential,
  currentRoot
}: {
  credential: Pick<SliceWalletRegistryCredential, "publicKey">
  currentRoot: Awaited<ReturnType<typeof getSliceWalletRootValidatorPublicKey>>
}) => {
  const expectedRoot = parseSliceWalletUncompressedPublicKey(
    credential.publicKey
  )
  if (
    currentRoot === null ||
    currentRoot.x !== expectedRoot.x ||
    currentRoot.y !== expectedRoot.y
  ) {
    throw new Error("Deployed Slice Wallet root does not match local metadata.")
  }
}

export const executeSliceWalletGenericGrantReplacement = async <
  Authorization,
  Result
>({
  authorize,
  commit,
  disablePredecessor,
  discardPending,
  installReplacement,
  persistPrepared,
  verifyReplacement
}: {
  authorize: () => Promise<Authorization>
  commit: (authorization: Authorization) => Promise<Result>
  disablePredecessor: () => Promise<void>
  discardPending: () => Promise<void>
  installReplacement: () => Promise<void>
  persistPrepared: (authorization: Authorization) => Promise<void>
  verifyReplacement: () => Promise<void>
}) => {
  let prepared = false
  try {
    const authorization = await authorize()
    await persistPrepared(authorization)
    prepared = true
    await installReplacement()
    await verifyReplacement()
    await disablePredecessor()
    return await commit(authorization)
  } catch (error) {
    if (!prepared) await discardPending()
    throw error
  }
}

const genericGrantRotationPhaseOrder: Record<
  StoredGenericGrantRotation["phase"],
  number
> = {
  prepared: 0,
  submitting: 1,
  submitted: 2,
  installed: 3,
  "predecessor-disabled": 4,
  "frame-committed": 5,
  "active-grant-committed": 6
}

export const getSliceWalletGenericGrantInstallationAction = ({
  finalizedBlockNumber,
  installed,
  receipt,
  rotation
}: {
  finalizedBlockNumber: bigint | null
  installed: boolean
  receipt: { blockNumber: bigint; success: boolean } | null
  rotation: StoredGenericGrantRotation
}): "installed" | "retry" | "submit" | "wait" => {
  if (installed) return "installed"
  if (rotation.installationUserOperationHash === undefined) {
    if (rotation.phase === "prepared") return "submit"
    return rotation.phase === "submitting" ? "wait" : "retry"
  }
  if (receipt === null || receipt.success) return "wait"
  return finalizedBlockNumber !== null &&
    receipt.blockNumber <= finalizedBlockNumber
    ? "retry"
    : "wait"
}

export const resumeSliceWalletGenericGrantReplacement = async ({
  clearJournal,
  disablePredecessor,
  ensureFrameCommitted,
  ensureInstalled,
  initialRotation,
  persistActiveGrant,
  setPhase,
  verifyFinalized
}: {
  clearJournal: (rotation: StoredGenericGrantRotation) => Promise<void>
  disablePredecessor: (rotation: StoredGenericGrantRotation) => Promise<void>
  ensureFrameCommitted: (rotation: StoredGenericGrantRotation) => Promise<void>
  ensureInstalled: (
    rotation: StoredGenericGrantRotation
  ) => Promise<StoredGenericGrantRotation>
  initialRotation: StoredGenericGrantRotation
  persistActiveGrant: (rotation: StoredGenericGrantRotation) => Promise<void>
  setPhase: (
    rotation: StoredGenericGrantRotation,
    phase: StoredGenericGrantRotation["phase"]
  ) => Promise<StoredGenericGrantRotation>
  verifyFinalized: (rotation: StoredGenericGrantRotation) => Promise<void>
}) => {
  let rotation = await ensureInstalled(initialRotation)
  if (
    genericGrantRotationPhaseOrder[rotation.phase] <
    genericGrantRotationPhaseOrder["predecessor-disabled"]
  ) {
    await disablePredecessor(rotation)
    rotation = await setPhase(rotation, "predecessor-disabled")
  }
  await ensureFrameCommitted(rotation)
  if (
    genericGrantRotationPhaseOrder[rotation.phase] <
    genericGrantRotationPhaseOrder["frame-committed"]
  ) {
    rotation = await setPhase(rotation, "frame-committed")
  }
  await persistActiveGrant(rotation)
  if (
    genericGrantRotationPhaseOrder[rotation.phase] <
    genericGrantRotationPhaseOrder["active-grant-committed"]
  ) {
    rotation = await setPhase(rotation, "active-grant-committed")
  }
  await verifyFinalized(rotation)
  await clearJournal(rotation)
  return rotation
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

const toPublicGrant = (
  grant: StoredGenericGrant
): SliceWalletPermissionGrant => ({
  account: grant.account,
  chainId: grant.chainId,
  createdAt: grant.createdAt,
  expiresAt: grant.expiresAt,
  permissionId: grant.permissionId,
  permissions: grant.permissions,
  version: "1"
})

const createSliceWalletChainRuntime = (
  config: SliceWalletChainRuntimeConfig,
  dependencies: {
    acquireFrame?: typeof acquireSliceWalletSignerFrame
    connectAccount?: typeof connectSliceWalletAccount
  } = {}
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
    const { address, initConfig } =
      await assertSliceWalletRegistryAccountIdentity({
        client: publicClient,
        credential
      })
    return createSliceWalletCeremonyKernelAccount({
      address,
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
      const clearInvalidSnapshot = () => {
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
          clearStoredSliceWalletGrantRotation(
            storage,
            config.chain.id,
            metadata.accountAddress
          )
        }
      }
      const activate = async (credential: SliceWalletRegistryCredential) => {
        const resolved = await toActiveWallet(credential)
        if (
          config.getAccountGeneration() !== generation ||
          hydrationPromise !== pending
        ) {
          return null
        }
        activeWallet = resolved
        return resolved
      }
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
          credential.accountIndex !== metadata.accountIndex ||
          credential.credentialIdHash.toLowerCase() !==
            metadata.credentialIdHash.toLowerCase() ||
          credential.publicKey.toLowerCase() !==
            metadata.publicKey.toLowerCase() ||
          credential.factoryVersion !== metadata.factoryVersion ||
          credential.recoveryPermissionId?.toLowerCase() !==
            metadata.recoveryPermissionId?.toLowerCase() ||
          credential.recoverySignerAddress?.toLowerCase() !==
            metadata.recoverySignerAddress?.toLowerCase() ||
          credential.registrationKind !== metadata.registrationKind
        ) {
          clearInvalidSnapshot()
          return null
        }
        return activate(credential)
      } catch (error) {
        if (
          error instanceof SliceWalletRegistryRequestError &&
          error.status < 500
        ) {
          clearInvalidSnapshot()
          return null
        }
        try {
          await assertSliceWalletRegistryAccountIdentity({
            client: publicClient,
            credential: metadata
          })
        } catch {
          clearInvalidSnapshot()
          return null
        }
        let code: Hex | undefined
        try {
          code = await publicClient.getCode({
            address: metadata.accountAddress
          })
        } catch {
          return null
        }
        if (code !== undefined && code !== "0x") {
          let currentRoot: Awaited<
            ReturnType<typeof getSliceWalletRootValidatorPublicKey>
          >
          try {
            currentRoot = await getSliceWalletRootValidatorPublicKey({
              account: metadata.accountAddress,
              client: publicClient
            })
          } catch {
            return null
          }
          try {
            assertSliceWalletDeployedRootIdentity({
              credential: metadata,
              currentRoot
            })
          } catch {
            clearInvalidSnapshot()
            return null
          }
        }
        try {
          return await activate(metadata)
        } catch {
          clearInvalidSnapshot()
          return null
        }
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
    pending = (dependencies.acquireFrame ?? acquireSliceWalletSignerFrame)({
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
    await getFrame()
    const connected = await (
      dependencies.connectAccount ?? connectSliceWalletAccount
    )({
      ceremonyBroker: config.ceremonyBroker,
      ceremonyMode: config.ceremonyMode,
      chainId: config.chain.id,
      document: browserDocument,
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
      createdAt: connected.createdAt,
      credentialIdHash: connected.credentialIdHash,
      factoryVersion: connected.factoryVersion,
      publicKey: connected.publicKey,
      recoveryPermissionId: connected.recoveryPermissionId,
      recoverySignerAddress: connected.recoverySignerAddress,
      registrationKind: connected.registrationKind
    })
    return wallet
  }

  const connect = async () => {
    const hydrated = await hydrate()
    if (hydrated !== null) {
      const lockState = await (await getFrame()).request({
        method: "getAccountLockState",
        params: { account: hydrated.rootAccount.address }
      })
      if (lockState === "unlocked") return hydrated
      return commitAccount(await chooseAccount())
    }
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

  const lockAccount = async (account: `0x${string}`) => {
    await (await getFrame()).request({
      method: "lockAccount",
      params: { account }
    })
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
      document: browserDocument,
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
    try {
      assertSliceWalletAuthorityDeployment({
        authority: "generic",
        chainId: config.chain.id
      })
    } catch {
      return null
    }
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
    if (grant !== null && calls.length === 1) {
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

  const getPendingGenericSession = async () => {
    const wallet = await requireActiveWallet()
    const result = await (await getFrame()).request({
      method: "getPendingSession",
      params: {
        account: wallet.rootAccount.address,
        chainId: config.chain.id,
        grantKind: "generic"
      }
    })
    if (result === null || typeof result !== "object") return null
    const session = parseSliceWalletFrameSession(result)
    if (
      session.grantKind !== "generic" ||
      session.chainId !== config.chain.id ||
      !isAddressEqual(session.account, wallet.rootAccount.address)
    ) {
      throw new Error("Pending generic wallet session identity is invalid.")
    }
    return session
  }

  const getCurrentGenericSession = async () => {
    const wallet = await requireActiveWallet()
    const result = await (await getFrame()).request({
      method: "getSession",
      params: {
        account: wallet.rootAccount.address,
        chainId: config.chain.id,
        grantKind: "generic"
      }
    })
    if (result === null || typeof result !== "object") return null
    const session = parseSliceWalletFrameSession(result)
    if (
      session.grantKind !== "generic" ||
      session.chainId !== config.chain.id ||
      !isAddressEqual(session.account, wallet.rootAccount.address)
    ) {
      throw new Error("Committed generic wallet session identity is invalid.")
    }
    return session
  }

  const sessionMatchesGrant = (
    session: SliceWalletFrameSession,
    grant: StoredGenericGrant
  ) =>
    session.grantKind === "generic" &&
    session.chainId === grant.chainId &&
    isAddressEqual(session.account, grant.account) &&
    session.expiresAt === grant.expiresAt &&
    session.permissionId.toLowerCase() === grant.permissionId.toLowerCase() &&
    session.publicKey.toLowerCase() === grant.publicKey.toLowerCase() &&
    session.signerId.toLowerCase() === grant.signerId.toLowerCase() &&
    getWalletPolicyHash(session.policy) ===
      getWalletPolicyHash(deserializeWalletPolicyDescriptor(grant.policy))

  const getPermissionInstallCalls = (session: SliceWalletFrameSession) =>
    buildSliceWalletPermissionInstallCalls({
      account: session.account,
      client: publicClient,
      session
    })

  const assertPermissionInstalled = async (
    session: SliceWalletFrameSession
  ) => {
    const verification = await getPermissionInstallCalls(session)
    if (verification.calls.length !== 0) {
      throw new Error(
        "Replacement wallet permission was not installed onchain."
      )
    }
  }

  const rotationsMatch = (
    left: StoredGenericGrantRotation,
    right: StoredGenericGrantRotation
  ) =>
    left.version === right.version &&
    left.phase === right.phase &&
    left.installationUserOperationHash?.toLowerCase() ===
      right.installationUserOperationHash?.toLowerCase() &&
    storedSliceWalletGrantsMatch(left.predecessor, right.predecessor) &&
    storedSliceWalletGrantsMatch(left.replacement, right.replacement)

  const persistRotation = (rotation: StoredGenericGrantRotation) => {
    if (!writeStoredSliceWalletGrantRotation(storage, rotation)) {
      throw new Error("Wallet permission rotation could not be persisted.")
    }
    const persisted = readStoredSliceWalletGrantRotation(
      storage,
      rotation.replacement.chainId,
      rotation.replacement.account
    )
    if (persisted === null || !rotationsMatch(persisted, rotation)) {
      throw new Error(
        "Wallet permission rotation persistence could not be verified."
      )
    }
    return persisted
  }

  const setRotationPhase = (
    rotation: StoredGenericGrantRotation,
    phase: StoredGenericGrantRotation["phase"],
    installationUserOperationHash:
      | Hex
      | null
      | undefined = rotation.installationUserOperationHash
  ) =>
    persistRotation({
      ...(installationUserOperationHash === null ||
      installationUserOperationHash === undefined
        ? {}
        : { installationUserOperationHash }),
      phase,
      predecessor: rotation.predecessor,
      replacement: rotation.replacement,
      version: 1
    })

  const installPermission = async (
    session: SliceWalletFrameSession,
    rotation: StoredGenericGrantRotation
  ) => {
    const installation = await getPermissionInstallCalls(session)
    if (installation.calls.length === 0) {
      return setRotationPhase(rotation, "installed")
    }
    const submitting = setRotationPhase(rotation, "submitting", null)
    let hash: Hex
    try {
      hash = await createAccountBundler(
        (await requireActiveWallet()).rootAccount
      ).sendUserOperation({ calls: installation.calls })
    } catch (error) {
      throw new AggregateError(
        [error],
        "Wallet permission installation submission is ambiguous."
      )
    }
    let submitted: StoredGenericGrantRotation
    try {
      submitted = setRotationPhase(submitting, "submitted", hash)
    } catch (persistenceError) {
      try {
        await waitForSuccessfulUserOperation(hash)
        await assertPermissionInstalled(session)
        return setRotationPhase(submitting, "installed", hash)
      } catch (installationError) {
        try {
          setRotationPhase(submitting, "submitted", hash)
        } catch (retryError) {
          throw new AggregateError(
            [persistenceError, installationError, retryError],
            "Wallet permission submission could not be durably recorded."
          )
        }
        throw new AggregateError(
          [persistenceError, installationError],
          "Wallet permission submission was recorded after a persistence interruption."
        )
      }
    }
    await waitForSuccessfulUserOperation(hash)
    await assertPermissionInstalled(session)
    return setRotationPhase(submitted, "installed")
  }

  const toStoredGrant = ({
    enableSignature,
    permissions,
    session
  }: {
    enableSignature: Hex
    permissions: readonly SliceWalletGenericPermission[]
    session: SliceWalletFrameSession
  }): StoredGenericGrant => ({
    account: session.account,
    chainId: session.chainId,
    createdAt: Math.floor(Date.now() / 1000),
    enableSignature,
    expiresAt: session.expiresAt,
    permissionId: session.permissionId,
    permissions,
    policy: serializeWalletPolicyDescriptor(session.policy),
    publicKey: session.publicKey,
    signerId: session.signerId
  })

  const commitGrant = async (
    frame: SliceWalletSignerFrameClient,
    stored: StoredGenericGrant
  ) => {
    if (!writeStoredSliceWalletGrant(storage, stored)) {
      throw new Error("Wallet permission metadata could not be persisted.")
    }
    const persisted = readStoredSliceWalletGrant(
      storage,
      stored.chainId,
      stored.account
    )
    if (
      persisted === null ||
      !storedSliceWalletGrantsMatch(persisted, stored)
    ) {
      clearStoredSliceWalletGrant(storage, stored.chainId, stored.account)
      throw new Error("Wallet permission metadata could not be verified.")
    }
    try {
      await frame.request({
        method: "commitSession",
        params: {
          account: stored.account,
          chainId: stored.chainId,
          grantKind: "generic"
        }
      })
      const committed = await getCurrentGenericSession()
      if (committed === null || !sessionMatchesGrant(committed, stored)) {
        throw new Error("Wallet permission frame commit could not be verified.")
      }
    } catch (error) {
      clearStoredSliceWalletGrant(storage, stored.chainId, stored.account)
      throw error
    }
  }

  const assertRotationMatchesRequest = (
    rotation: StoredGenericGrantRotation,
    permissions: readonly SliceWalletGenericPermission[],
    policy: WalletPolicyDescriptor,
    activeGrant: StoredGenericGrant | null
  ) => {
    const replacementPolicy = deserializeWalletPolicyDescriptor(
      rotation.replacement.policy
    )
    const requestedWithPinnedActivation = {
      ...policy,
      validAfter: replacementPolicy.validAfter
    }
    if (
      replacementPolicy.validUntil !== policy.validUntil ||
      getWalletPolicyHash(replacementPolicy) !==
        getWalletPolicyHash(requestedWithPinnedActivation) ||
      JSON.stringify(rotation.replacement.permissions) !==
        JSON.stringify(permissions)
    ) {
      throw new Error(
        "A different generic permission rotation is already pending."
      )
    }
    if (
      activeGrant !== null &&
      !storedSliceWalletGrantsMatch(activeGrant, rotation.predecessor) &&
      !storedSliceWalletGrantsMatch(activeGrant, rotation.replacement)
    ) {
      throw new Error(
        "Stored generic permission state does not match its rotation journal."
      )
    }
  }

  const getRotationSession = async (rotation: StoredGenericGrantRotation) => {
    const pending = await getPendingGenericSession()
    if (pending !== null) {
      if (!sessionMatchesGrant(pending, rotation.replacement)) {
        throw new Error(
          "Pending generic permission does not match its rotation journal."
        )
      }
      return pending
    }
    const committed = await getCurrentGenericSession()
    if (
      committed !== null &&
      sessionMatchesGrant(committed, rotation.replacement)
    ) {
      return committed
    }
    if (rotation.phase === "prepared") {
      clearStoredSliceWalletGrantRotation(
        storage,
        rotation.replacement.chainId,
        rotation.replacement.account
      )
      throw new Error(
        "Prepared wallet permission key is unavailable; retry the rotation."
      )
    }
    throw new Error(
      "Submitted wallet permission key is unavailable; rotation recovery is required."
    )
  }

  const reconcileRotationInstallation = async (
    rotation: StoredGenericGrantRotation,
    session: SliceWalletFrameSession
  ) => {
    const installation = await getPermissionInstallCalls(session)
    let receipt: { blockNumber: bigint; success: boolean } | null = null
    let finalizedBlockNumber: bigint | null = null
    if (rotation.installationUserOperationHash !== undefined) {
      try {
        const result = await receiptClient.getUserOperationReceipt({
          hash: rotation.installationUserOperationHash
        })
        receipt = {
          blockNumber: result.receipt.blockNumber,
          success: result.success
        }
      } catch {
        // A missing or unavailable receipt cannot prove that submission failed.
      }
      if (receipt !== null && !receipt.success) {
        try {
          finalizedBlockNumber = (
            await publicClient.getBlock({ blockTag: "finalized" })
          ).number
        } catch {
          // An unavailable finalized head keeps the submitted operation pending.
        }
      }
    }
    const action = getSliceWalletGenericGrantInstallationAction({
      finalizedBlockNumber,
      installed: installation.calls.length === 0,
      receipt,
      rotation
    })
    if (action === "installed") {
      return genericGrantRotationPhaseOrder[rotation.phase] <
        genericGrantRotationPhaseOrder.installed
        ? setRotationPhase(rotation, "installed")
        : rotation
    }
    if (action === "wait") {
      if (
        rotation.phase === "submitting" &&
        rotation.installationUserOperationHash === undefined
      ) {
        throw new Error(
          "Wallet permission installation is still ambiguous; retry after inclusion."
        )
      }
      if (receipt?.success) {
        throw new Error(
          "Wallet permission installation succeeded but is not yet observable onchain."
        )
      }
      if (receipt !== null) {
        throw new Error(
          "Wallet permission installation failure is not yet finalized."
        )
      }
      throw new Error(
        "Wallet permission installation is pending; a duplicate was not submitted."
      )
    }
    if (action === "retry") {
      rotation = setRotationPhase(rotation, "prepared", null)
    }
    return installPermission(session, rotation)
  }

  const ensureRotationFrameCommitted = async (
    frame: SliceWalletSignerFrameClient,
    rotation: StoredGenericGrantRotation
  ) => {
    const committed = await getCurrentGenericSession()
    if (
      committed !== null &&
      sessionMatchesGrant(committed, rotation.replacement)
    ) {
      return
    }
    const pending = await getPendingGenericSession()
    if (
      pending === null ||
      !sessionMatchesGrant(pending, rotation.replacement)
    ) {
      throw new Error(
        "Wallet permission frame state does not match its rotation journal."
      )
    }
    await frame.request({
      method: "commitSession",
      params: {
        account: rotation.replacement.account,
        chainId: rotation.replacement.chainId,
        grantKind: "generic"
      }
    })
    const verified = await getCurrentGenericSession()
    if (
      verified === null ||
      !sessionMatchesGrant(verified, rotation.replacement)
    ) {
      throw new Error("Wallet permission frame commit could not be verified.")
    }
  }

  const persistAndVerifyActiveGrant = (replacement: StoredGenericGrant) => {
    if (!writeStoredSliceWalletGrant(storage, replacement)) {
      throw new Error("Replacement wallet permission could not be persisted.")
    }
    const activeGrant = readStoredSliceWalletGrant(
      storage,
      replacement.chainId,
      replacement.account
    )
    if (
      activeGrant === null ||
      !storedSliceWalletGrantsMatch(activeGrant, replacement)
    ) {
      throw new Error(
        "Replacement wallet permission persistence could not be verified."
      )
    }
  }

  const finishRotation = async (
    frame: SliceWalletSignerFrameClient,
    initialRotation: StoredGenericGrantRotation
  ) => {
    const session = await getRotationSession(initialRotation)
    const finalized = await resumeSliceWalletGenericGrantReplacement({
      clearJournal: async (rotation) => {
        if (
          !clearStoredSliceWalletGrantRotation(
            storage,
            rotation.replacement.chainId,
            rotation.replacement.account
          )
        ) {
          throw new Error(
            "Wallet permission rotation journal could not be cleared."
          )
        }
      },
      disablePredecessor: (rotation) => uninstallGrant(rotation.predecessor),
      ensureFrameCommitted: (rotation) =>
        ensureRotationFrameCommitted(frame, rotation),
      ensureInstalled: async (rotation) => {
        const installed = await reconcileRotationInstallation(rotation, session)
        await assertPermissionInstalled(session)
        return installed
      },
      initialRotation,
      persistActiveGrant: async (rotation) => {
        persistAndVerifyActiveGrant(rotation.replacement)
      },
      setPhase: async (rotation, phase) => setRotationPhase(rotation, phase),
      verifyFinalized: async (rotation) => {
        const committed = await getCurrentGenericSession()
        const activeGrant = readStoredSliceWalletGrant(
          storage,
          rotation.replacement.chainId,
          rotation.replacement.account
        )
        if (
          committed === null ||
          !sessionMatchesGrant(committed, rotation.replacement) ||
          activeGrant === null ||
          !storedSliceWalletGrantsMatch(activeGrant, rotation.replacement)
        ) {
          throw new Error(
            "Wallet permission rotation finalization is incomplete."
          )
        }
      }
    })
    return toPublicGrant(finalized.replacement)
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

  const createGrant = async (
    {
      permissions,
      policy
    }: {
      permissions: readonly SliceWalletGenericPermission[]
      policy: WalletPolicyDescriptor
    },
    options: { reuseMatching?: boolean } = {}
  ) => {
    assertSliceWalletAuthorityDeployment({
      authority: "generic",
      chainId: config.chain.id
    })
    const wallet = await requireActiveWallet()
    const previous = readStoredSliceWalletGrant(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    const existingRotation = readStoredSliceWalletGrantRotation(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    if (existingRotation !== null) {
      assertRotationMatchesRequest(
        existingRotation,
        permissions,
        policy,
        previous
      )
      return finishRotation(await getFrame(), existingRotation)
    }
    if (options.reuseMatching === true && previous !== null) {
      const previousPolicy = deserializeWalletPolicyDescriptor(previous.policy)
      const requestedWithPinnedActivation = {
        ...policy,
        validAfter: previousPolicy.validAfter
      }
      if (
        previousPolicy.validUntil === policy.validUntil &&
        getWalletPolicyHash(previousPolicy) ===
          getWalletPolicyHash(requestedWithPinnedActivation)
      ) {
        return toPublicGrant(previous)
      }
    }
    const frame = await getFrame()
    const pending = await getPendingGenericSession()
    if (pending !== null) {
      throw new Error(
        "A pending generic permission has no durable rotation journal."
      )
    }
    const result = await frame.request({
      method: "createSession",
      params: { policy }
    })
    if (result === null || typeof result !== "object") {
      throw new Error("Slice signer frame did not create a permission session.")
    }
    const session = parseSliceWalletFrameSession(result)
    const authorize = async () => {
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
      return authorization
    }
    const discardPending = async () => {
      await frame.request({
        method: "discardSession",
        params: {
          account: session.account,
          chainId: session.chainId,
          grantKind: "generic"
        }
      })
    }
    const persist = async (enableSignature: Hex) => {
      const stored = toStoredGrant({
        enableSignature,
        permissions,
        session
      })
      await commitGrant(frame, stored)
      return toPublicGrant(stored)
    }
    if (
      previous !== null &&
      previous.permissionId.toLowerCase() !== session.permissionId.toLowerCase()
    ) {
      let rotation: StoredGenericGrantRotation | null = null
      return executeSliceWalletGenericGrantReplacement({
        authorize,
        commit: async () => {
          if (rotation === null) {
            throw new Error("Wallet permission rotation was not prepared.")
          }
          return finishRotation(frame, rotation)
        },
        disablePredecessor: async () => {
          if (rotation === null) {
            throw new Error("Wallet permission rotation was not prepared.")
          }
          await uninstallGrant(previous)
          rotation = setRotationPhase(rotation, "predecessor-disabled")
        },
        discardPending,
        installReplacement: async () => {
          if (rotation === null) {
            throw new Error("Wallet permission rotation was not prepared.")
          }
          rotation = await reconcileRotationInstallation(rotation, session)
        },
        persistPrepared: async (authorization) => {
          const prepared = {
            phase: "prepared",
            predecessor: previous,
            replacement: toStoredGrant({
              enableSignature: authorization.enableSignature,
              permissions,
              session
            }),
            version: 1
          } satisfies StoredGenericGrantRotation
          try {
            rotation = persistRotation(prepared)
          } catch (error) {
            clearStoredSliceWalletGrantRotation(
              storage,
              prepared.replacement.chainId,
              prepared.replacement.account
            )
            throw error
          }
        },
        verifyReplacement: () => assertPermissionInstalled(session)
      })
    }
    try {
      const authorization = await authorize()
      return await persist(authorization.enableSignature)
    } catch (error) {
      await discardPending()
      throw error
    }
  }

  const getGrants = async (): Promise<
    readonly SliceWalletPermissionGrant[]
  > => {
    const grant = await hydrateGrant()
    if (grant === null) return []
    const pending = await getPendingGenericSession()
    if (pending === null) return [toPublicGrant(grant.stored)]
    try {
      await assertPermissionInstalled(pending)
    } catch {
      return [toPublicGrant(grant.stored)]
    }
    const replacement = toStoredGrant({
      enableSignature: "0x",
      permissions: grant.stored.permissions,
      session: pending
    })
    return [toPublicGrant(grant.stored), toPublicGrant(replacement)]
  }

  const rotateGrant = async (permissionId: Hex) => {
    assertSliceWalletAuthorityDeployment({
      authority: "generic",
      chainId: config.chain.id
    })
    const wallet = await requireActiveWallet()
    const stored = readStoredSliceWalletGrant(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    const rotation = readStoredSliceWalletGrantRotation(
      storage,
      config.chain.id,
      wallet.rootAccount.address
    )
    if (rotation !== null) {
      if (
        rotation.predecessor.permissionId.toLowerCase() !==
          permissionId.toLowerCase() &&
        rotation.replacement.permissionId.toLowerCase() !==
          permissionId.toLowerCase()
      ) {
        throw invalidProviderRequest(
          "Permission id does not match this origin's grant."
        )
      }
      return createGrant({
        permissions: rotation.replacement.permissions,
        policy: deserializeWalletPolicyDescriptor(rotation.replacement.policy)
      })
    }
    if (
      stored === null ||
      stored.permissionId.toLowerCase() !== permissionId.toLowerCase()
    ) {
      throw invalidProviderRequest(
        "Permission id does not match this origin's grant."
      )
    }
    const policy = deserializeWalletPolicyDescriptor(stored.policy)
    return createGrant({ permissions: stored.permissions, policy })
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
      if (wallet === null) return []
      try {
        const lockState = await (await getFrame()).request({
          method: "getAccountLockState",
          params: { account: wallet.rootAccount.address }
        })
        return lockState === "unlocked" ? [wallet.rootAccount.address] : []
      } catch {
        return []
      }
    },
    hasCall: callTracker.hasCall,
    getCallsStatus: callTracker.getCallsStatus,
    getGrants,
    lockAccount,
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
    acquireFrame?: typeof acquireSliceWalletSignerFrame
    connectAccount?: typeof connectSliceWalletAccount
    createChainRuntime?: typeof createSliceWalletChainRuntime
  } = {}
) => {
  const createChainRuntime =
    dependencies.createChainRuntime ??
    ((chainConfig: SliceWalletChainRuntimeConfig) =>
      createSliceWalletChainRuntime(chainConfig, {
        acquireFrame: dependencies.acquireFrame,
        connectAccount: dependencies.connectAccount
      }))
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

  const collectFailures = (
    results: readonly PromiseSettledResult<void>[],
    fallbackMessage: string
  ) => {
    const failures: Error[] = []
    for (const result of results) {
      if (result.status !== "rejected") continue
      failures.push(
        result.reason instanceof Error
          ? result.reason
          : new Error(fallbackMessage)
      )
    }
    return failures
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
          return runtime.commitAccount(selection)
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
      const account = readStoredSliceWalletAccount(storage)?.accountAddress
      const results =
        account === undefined
          ? []
          : await Promise.allSettled([
              (runtimes.values().next().value ?? getChainRuntime()).lockAccount(
                account
              )
            ])
      destroyChainRuntimes()
      clearStoredSliceWalletAccount(storage)
      const failures = collectFailures(
        results,
        "Wallet session lock failed unexpectedly."
      )
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `${failures.length} wallet session lock${failures.length === 1 ? "" : "s"} failed during disconnect.`
        )
      }
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
    subscribePendingCeremony: (
      listener: (pending: SliceWalletPendingCeremony | null) => void
    ) => ceremonyBroker.subscribe(listener),
    revokeGrant: (
      ...args: Parameters<SliceWalletChainRuntime["revokeGrant"]>
    ) => getChainRuntime().revokeGrant(...args),
    revokePermissions: async () => {
      ceremonyBroker.cancel()
      const { storage } = getBrowserDependencies(config)
      const account = readStoredSliceWalletAccount(storage)?.accountAddress
      const revocationResults = await Promise.allSettled(
        [...chainConfigs.keys()].map((chainId) =>
          getChainRuntime(chainId).revokeGrant()
        )
      )
      const lockResults =
        account === undefined
          ? []
          : await Promise.allSettled([
              getChainRuntime(activeChainId).lockAccount(account)
            ])
      const failures = [
        ...collectFailures(
          revocationResults,
          "Wallet permission revocation failed unexpectedly."
        ),
        ...collectFailures(
          lockResults,
          "Wallet session lock failed unexpectedly."
        )
      ]
      destroyChainRuntimes()
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `${failures.length} wallet permission revocation${failures.length === 1 ? "" : "s"} failed.`
        )
      }
      clearStoredSliceWalletAccount(storage)
      return account !== undefined
    },
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
