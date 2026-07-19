import { type Address, type Hex, isAddress, isHex, numberToHex } from "viem"
import type {
  SliceWalletProvider,
  SliceWalletProviderEventMap,
  SliceWalletProviderRequestArguments,
  SliceWalletProviderValue
} from "../types"
import type { SliceWalletProviderConfig } from "../types/providerInternal"
import {
  invalidProviderRequest,
  SliceWalletProviderRpcError,
  unauthorizedProviderRequest,
  unsupportedProviderMethod
} from "./errors"
import {
  parseSliceWalletGrantPermissions,
  parseSliceWalletSendCalls,
  parseSliceWalletTransaction
} from "./protocol"
import { createSliceWalletProviderRuntime } from "./runtime"

type ProviderEvent = keyof SliceWalletProviderEventMap
type ProviderEventPayload = SliceWalletProviderEventMap[ProviderEvent]
type ProviderEventListener = (payload: ProviderEventPayload) => void
type FullProviderRuntime = ReturnType<typeof createSliceWalletProviderRuntime>
type ProviderRuntime = Omit<
  FullProviderRuntime,
  "connect" | "getChainRuntime" | "waitForSuccessfulUserOperation"
> & {
  connect: () => Promise<{ rootAccount: { address: Address } }>
  waitForSuccessfulUserOperation: (
    hash: Hex,
    chainId?: number
  ) => Promise<{ receipt: { transactionHash: Hex } }>
}
type ProviderDependencies = {
  createRuntime?: (config: SliceWalletProviderConfig) => ProviderRuntime
}

const paramsArray = (
  params: SliceWalletProviderRequestArguments["params"],
  label: string
) => {
  if (!Array.isArray(params)) {
    throw invalidProviderRequest(`${label} params must be an array.`)
  }
  return params
}

const singleStringParam = (
  params: SliceWalletProviderRequestArguments["params"],
  label: string
) => {
  const values = paramsArray(params, label)
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw invalidProviderRequest(`${label} expects one string parameter.`)
  }
  return values[0]
}

const assertNoParams = (
  params: SliceWalletProviderRequestArguments["params"],
  label: string
) => {
  if (params === undefined) return
  if (paramsArray(params, label).length !== 0) {
    throw invalidProviderRequest(`${label} expects no parameters.`)
  }
}

const singlePermissionId = (
  params: SliceWalletProviderRequestArguments["params"],
  label: string
) => {
  const value = singleStringParam(params, label)
  if (!/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw invalidProviderRequest(`${label} expects a four-byte permission id.`)
  }
  return value as Hex
}

const getConnectedAccount = async (
  runtime: Pick<ProviderRuntime, "getAccounts">
) => {
  const accounts = await runtime.getAccounts()
  const account = accounts[0]
  if (account === undefined) throw unauthorizedProviderRequest()
  return account
}

const accountPermission = (origin: string) => ({
  caveats: [],
  date: Date.now(),
  id: `eth_accounts:${origin}`,
  invoker: origin,
  parentCapability: "eth_accounts"
})

const parseWalletConnect = (
  params: SliceWalletProviderRequestArguments["params"]
) => {
  const values = paramsArray(params, "wallet_connect")
  const input = values[0]
  if (
    values.length !== 1 ||
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => key !== "version" && key !== "capabilities"
    ) ||
    input.version !== "1"
  ) {
    throw invalidProviderRequest("Slice Wallet supports wallet_connect v1.")
  }
  if (input.capabilities === undefined) return
  if (
    typeof input.capabilities !== "object" ||
    input.capabilities === null ||
    Array.isArray(input.capabilities)
  ) {
    throw invalidProviderRequest(
      "wallet_connect capabilities must be an object."
    )
  }
  for (const [name, capability] of Object.entries(input.capabilities)) {
    if (
      typeof capability === "object" &&
      capability !== null &&
      !Array.isArray(capability) &&
      Reflect.get(capability, "optional") === true
    ) {
      continue
    }
    throw new SliceWalletProviderRpcError(
      5700,
      `Unsupported wallet_connect capability: ${name}.`
    )
  }
}

const assertEthAccountsRequest = (
  params: SliceWalletProviderRequestArguments["params"]
) => {
  const values = paramsArray(params, "wallet_requestPermissions")
  const permissions = values[0]
  if (
    values.length !== 1 ||
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions) ||
    Object.keys(permissions).length !== 1 ||
    typeof permissions.eth_accounts !== "object" ||
    permissions.eth_accounts === null ||
    Array.isArray(permissions.eth_accounts)
  ) {
    throw invalidProviderRequest("Only eth_accounts permission is supported.")
  }
}

const assertEthAccountsRevocation = (
  params: SliceWalletProviderRequestArguments["params"]
) => {
  const values = paramsArray(params, "wallet_revokePermissions")
  const permission = values[0]
  const keyedRequest =
    typeof permission === "object" &&
    permission !== null &&
    !Array.isArray(permission) &&
    Object.keys(permission).length === 1 &&
    typeof permission.eth_accounts === "object" &&
    permission.eth_accounts !== null &&
    !Array.isArray(permission.eth_accounts)
  const returnedPermission =
    typeof permission === "object" &&
    permission !== null &&
    !Array.isArray(permission) &&
    permission.parentCapability === "eth_accounts"
  if (values.length !== 1 || (!keyedRequest && !returnedPermission)) {
    throw invalidProviderRequest("Only eth_accounts permission is supported.")
  }
}

const parseCapabilityChainIds = (
  value: SliceWalletProviderValue | undefined
) => {
  if (value === undefined) return null
  if (!Array.isArray(value)) {
    throw invalidProviderRequest("Capability chain ids must be an array.")
  }
  return value.map((chainId) => {
    if (
      typeof chainId !== "string" ||
      !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(chainId)
    ) {
      throw invalidProviderRequest("Capability chain id must be hex.")
    }
    const parsedChainId = BigInt(chainId)
    if (parsedChainId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidProviderRequest("Capability chain id is too large.")
    }
    return Number(parsedChainId)
  })
}

const parseChainId = (value: SliceWalletProviderValue | undefined) => {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw invalidProviderRequest("Wallet chain id must be hex.")
  }
  const chainId = BigInt(value)
  if (chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidProviderRequest("Wallet chain id is too large.")
  }
  return Number(chainId)
}

const assertAccountParam = (
  value: SliceWalletProviderValue,
  account: Address
) => {
  if (
    typeof value !== "string" ||
    !isAddress(value) ||
    value.toLowerCase() !== account.toLowerCase()
  ) {
    throw new SliceWalletProviderRpcError(
      4100,
      "Requested account is not connected."
    )
  }
}

export const createSliceWalletProviderInternal = (
  config: SliceWalletProviderConfig,
  {
    createRuntime = createSliceWalletProviderRuntime
  }: ProviderDependencies = {}
): SliceWalletProvider => {
  const runtime = createRuntime(config)
  const origin = new URL(
    config.window?.location.href ?? globalThis.location.href
  ).origin
  const listeners = new Map<ProviderEvent, Set<ProviderEventListener>>()

  const emit = <Event extends ProviderEvent>(
    event: Event,
    payload: SliceWalletProviderEventMap[Event]
  ) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload)
    }
  }

  const connect = async () => {
    const before = await runtime.getAccounts()
    const wallet = await runtime.connect()
    if (before.length === 0) {
      const chainId = numberToHex(runtime.chainId)
      emit("connect", { chainId })
      emit("accountsChanged", [wallet.rootAccount.address])
    }
    return wallet.rootAccount.address
  }

  const disconnect = async () => {
    const before = await runtime.getAccounts()
    const cleanup = runtime.disconnect()
    if (before.length > 0) {
      emit("accountsChanged", [])
      emit("disconnect", { code: 4900, message: "Slice Wallet disconnected." })
    }
    await cleanup
  }

  const request = async ({
    method,
    params
  }: SliceWalletProviderRequestArguments): Promise<
    SliceWalletProviderValue | undefined
  > => {
    if (method === "eth_chainId") return numberToHex(runtime.chainId)
    if (method === "net_version") return String(runtime.chainId)
    if (method === "eth_accounts") return runtime.getAccounts()
    if (method === "eth_requestAccounts") return [await connect()]
    if (method === "wallet_connect") {
      parseWalletConnect(params)
      const account = await connect()
      return {
        accounts: [
          {
            address: account,
            capabilities: {}
          }
        ]
      }
    }
    if (method === "wallet_disconnect") {
      await disconnect()
      return undefined
    }
    if (method === "wallet_requestPermissions") {
      assertEthAccountsRequest(params)
      await connect()
      return [accountPermission(origin)]
    }
    if (method === "wallet_getPermissions") {
      return (await runtime.getAccounts()).length === 0
        ? []
        : [accountPermission(origin)]
    }
    if (method === "wallet_revokePermissions") {
      assertEthAccountsRevocation(params)
      await disconnect()
      return null
    }
    if (method === "wallet_switchEthereumChain") {
      const values = paramsArray(params, "wallet_switchEthereumChain")
      const value = values[0]
      if (
        values.length !== 1 ||
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.keys(value).some((key) => key !== "chainId")
      ) {
        throw invalidProviderRequest(
          "wallet_switchEthereumChain expects one chain id."
        )
      }
      const chainId = parseChainId(value.chainId)
      const previousChainId = runtime.chainId
      runtime.switchChain(chainId)
      if (previousChainId !== chainId)
        emit("chainChanged", numberToHex(chainId))
      return null
    }
    if (method === "wallet_addEthereumChain") {
      const values = paramsArray(params, "wallet_addEthereumChain")
      const value = values[0]
      if (
        values.length !== 1 ||
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        typeof value.chainId !== "string"
      ) {
        throw invalidProviderRequest(
          "wallet_addEthereumChain expects one chain object."
        )
      }
      const chainId = parseChainId(value.chainId)
      if (!runtime.supportedChainIds.includes(chainId)) {
        throw new SliceWalletProviderRpcError(
          4902,
          "Requested chain is unsupported."
        )
      }
      return null
    }
    if (method === "wallet_getCapabilities") {
      const account = await getConnectedAccount(runtime)
      const values = paramsArray(params, "wallet_getCapabilities")
      if (values.length < 1 || values.length > 2) {
        throw invalidProviderRequest(
          "wallet_getCapabilities expects an account and optional chain ids."
        )
      }
      assertAccountParam(values[0], account)
      const requestedChainIds = parseCapabilityChainIds(values[1])
      const chainIds = (requestedChainIds ?? runtime.supportedChainIds).filter(
        (chainId) => runtime.supportedChainIds.includes(chainId)
      )
      return Object.fromEntries(
        chainIds.map((chainId) => [
          numberToHex(chainId),
          {
            atomic: { status: "supported" },
            paymasterService: { supported: true }
          }
        ])
      )
    }
    if (method === "wallet_sendCalls") {
      const account = await getConnectedAccount(runtime)
      const request = parseSliceWalletSendCalls({
        account,
        chainId: runtime.chainId,
        params,
        paymasterAvailable: runtime.paymasterAvailable,
        supportedChainIds: runtime.supportedChainIds
      })
      return {
        id: (
          await runtime.sendCalls(
            request.calls,
            request.id,
            request.paymasterService,
            request.chainId
          )
        ).id
      }
    }
    if (method === "wallet_getCallsStatus") {
      return runtime.getCallsStatus(singleStringParam(params, method))
    }
    if (method === "wallet_showCallsStatus") {
      throw unsupportedProviderMethod(method)
    }
    if (method === "eth_sendTransaction") {
      const account = await getConnectedAccount(runtime)
      const transaction = parseSliceWalletTransaction(params)
      assertAccountParam(transaction.from, account)
      if (
        transaction.chainId !== undefined &&
        transaction.chainId !== runtime.chainId
      ) {
        if (!runtime.supportedChainIds.includes(transaction.chainId)) {
          throw new SliceWalletProviderRpcError(
            4902,
            "Requested chain is not configured in Slice Wallet."
          )
        }
        throw new SliceWalletProviderRpcError(
          4901,
          "Requested chain is configured but inactive; switch chains first."
        )
      }
      const chainId = runtime.chainId
      const submitted = await runtime.sendCalls([transaction.call])
      const receipt = await runtime.waitForSuccessfulUserOperation(
        submitted.userOperationHash,
        chainId
      )
      return receipt.receipt.transactionHash
    }
    if (method === "personal_sign") {
      const account = await getConnectedAccount(runtime)
      const values = paramsArray(params, method)
      if (values.length !== 2) {
        throw invalidProviderRequest("personal_sign expects data and account.")
      }
      const data = values[0]
      if (typeof data !== "string" || !isHex(data, { strict: true })) {
        throw invalidProviderRequest("personal_sign data must be hex.")
      }
      assertAccountParam(values[1], account)
      return runtime.signMessage({ raw: data })
    }
    if (method === "eth_signTypedData_v4") {
      const account = await getConnectedAccount(runtime)
      const values = paramsArray(params, method)
      if (values.length !== 2) {
        throw invalidProviderRequest(
          "eth_signTypedData_v4 expects account and typed data."
        )
      }
      assertAccountParam(values[0], account)
      if (typeof values[1] !== "string") {
        throw invalidProviderRequest("Typed data must be serialized JSON.")
      }
      return runtime.signTypedData(values[1])
    }
    if (method === "wallet_grantPermissions") {
      const account = await getConnectedAccount(runtime)
      return runtime.createGrant(
        parseSliceWalletGrantPermissions({
          account,
          chainId: runtime.chainId,
          now: Math.floor(Date.now() / 1000),
          params
        })
      )
    }
    if (method === "wallet_getSessionPermissions") {
      assertNoParams(params, method)
      return runtime.getGrants()
    }
    if (method === "wallet_rotateSessionPermission") {
      return runtime.rotateGrant(singlePermissionId(params, method))
    }
    if (method === "wallet_revokeSessionPermission") {
      await runtime.revokeGrant(singlePermissionId(params, method))
      return null
    }

    const forwarded = await runtime.forwardRpc(method, params)
    if (forwarded.handled) return forwarded.result
    throw unsupportedProviderMethod(method)
  }

  return {
    cancelPendingCeremony: () => runtime.cancelPendingCeremony(),
    continueInPopup: () => runtime.continueInPopup(),
    destroy: () => {
      runtime.destroy()
      listeners.clear()
    },
    on: (event, listener) => {
      const callbacks = listeners.get(event) ?? new Set<ProviderEventListener>()
      callbacks.add(listener as ProviderEventListener)
      listeners.set(event, callbacks)
    },
    removeListener: (event, listener) => {
      listeners.get(event)?.delete(listener as ProviderEventListener)
    },
    get pendingCeremony() {
      return runtime.pendingCeremony
    },
    request
  }
}
