import { type Address, type Hex, isAddress, isHex, numberToHex } from "viem"
import type {
  SliceWalletProvider,
  SliceWalletProviderConfig,
  SliceWalletProviderEventMap,
  SliceWalletProviderRequestArguments,
  SliceWalletProviderValue
} from "../types"
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
  runtime: ReturnType<typeof createSliceWalletProviderRuntime>
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

export const createSliceWalletProvider = (
  config: SliceWalletProviderConfig
): SliceWalletProvider => {
  const runtime = createSliceWalletProviderRuntime(config)
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
    await runtime.disconnect()
    if (before.length > 0) emit("accountsChanged", [])
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
      if (params !== undefined) {
        const values = paramsArray(params, "wallet_connect")
        if (values.length !== 1) {
          throw invalidProviderRequest("wallet_connect expects one parameter.")
        }
      }
      const account = await connect()
      return {
        accounts: [
          {
            address: account,
            capabilities: {
              atomic: { status: "supported" },
              permissions: { supported: true }
            }
          }
        ]
      }
    }
    if (method === "wallet_disconnect") {
      await disconnect()
      return undefined
    }
    if (method === "wallet_requestPermissions") {
      const values = paramsArray(params, "wallet_requestPermissions")
      if (values.length !== 1) {
        throw invalidProviderRequest(
          "wallet_requestPermissions expects one parameter."
        )
      }
      const permissions = values[0]
      if (
        typeof permissions !== "object" ||
        permissions === null ||
        Array.isArray(permissions) ||
        Object.keys(permissions).length !== 1 ||
        typeof permissions.eth_accounts !== "object" ||
        permissions.eth_accounts === null
      ) {
        throw invalidProviderRequest(
          "Only eth_accounts permission is supported."
        )
      }
      await connect()
      return [accountPermission(origin)]
    }
    if (method === "wallet_getPermissions") {
      return (await runtime.getAccounts()).length === 0
        ? []
        : [accountPermission(origin)]
    }
    if (method === "wallet_revokePermissions") {
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
        value.chainId !== numberToHex(runtime.chainId)
      ) {
        throw new SliceWalletProviderRpcError(
          4901,
          "Requested chain is unsupported."
        )
      }
      return null
    }
    if (method === "wallet_getCapabilities") {
      const account = await getConnectedAccount(runtime)
      if (params !== undefined) {
        const values = paramsArray(params, "wallet_getCapabilities")
        if (values[0] !== undefined) assertAccountParam(values[0], account)
      }
      return {
        [numberToHex(runtime.chainId)]: {
          atomic: { status: "supported" },
          paymasterService: { supported: runtime.paymasterAvailable },
          permissions: { supported: true }
        }
      }
    }
    if (method === "wallet_sendCalls") {
      const account = await getConnectedAccount(runtime)
      const request = parseSliceWalletSendCalls({
        account,
        chainId: runtime.chainId,
        params,
        paymasterAvailable: runtime.paymasterAvailable
      })
      return { id: (await runtime.sendCalls(request.calls, request.id)).id }
    }
    if (method === "wallet_getCallsStatus") {
      return runtime.getCallsStatus(singleStringParam(params, method))
    }
    if (
      method === "eth_sendTransaction" ||
      method === "wallet_sendTransaction"
    ) {
      const account = await getConnectedAccount(runtime)
      const transaction = parseSliceWalletTransaction(params)
      assertAccountParam(transaction.from, account)
      const submitted = await runtime.sendCalls([transaction.call])
      const receipt = await runtime.waitForSuccessfulUserOperation(
        submitted.userOperationHash
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
    if (method === "wallet_getSupportedExecutionPermissions") {
      return {
        "slice-call": {
          chainIds: [numberToHex(runtime.chainId)],
          ruleTypes: ["rate-limit"],
          templates: [
            "native-transfer",
            "erc20-transfer",
            "erc20-approve",
            "erc20-transfer-from"
          ]
        }
      }
    }
    if (
      method === "slice_getGrants" ||
      method === "wallet_getGrantedExecutionPermissions"
    ) {
      return runtime.getGrants()
    }
    if (method === "slice_rotateGrant") {
      return runtime.rotateGrant(singlePermissionId(params, method))
    }
    if (method === "slice_revokeGrant") {
      await runtime.revokeGrant(singlePermissionId(params, method))
      return null
    }

    const forwarded = await runtime.forwardRpc(method, params)
    if (forwarded.handled) return forwarded.result
    throw unsupportedProviderMethod(method)
  }

  return {
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
    request
  }
}
