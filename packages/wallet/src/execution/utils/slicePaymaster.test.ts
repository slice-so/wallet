import { describe, expect, it, mock } from "bun:test"
import {
  fundsModuleAbi,
  productsModuleAbi,
  registryProductActionAbi
} from "@slicekit/abi"
import {
  getFundsModuleAddress,
  getProductsModuleAddress,
  sliceHookAddressList
} from "@slicekit/abi/deployments"
import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  type Hex,
  numberToHex,
  pad,
  zeroAddress
} from "viem"
import {
  entryPoint06Address,
  entryPoint07Address,
  entryPoint08Address,
  entryPoint09Address
} from "viem/account-abstraction"
import { base } from "viem/chains"
import {
  ambireAccountExecutionAbi,
  coinbaseSmartWalletExecutionAbi,
  erc7579AccountExecutionAbi,
  erc7579BatchExecutionAbiParameters,
  metaMaskDelegatorExecutionAbi,
  type SliceSenderAccountSnapshot,
  sliceKernelAddresses,
  sliceWalletKernelAddresses
} from "../../protocol/index"
import {
  kernelPermissionExecuteSelector,
  kernelValidationManagementAbi
} from "../../protocol/kernel"
import {
  getSlicePaymasterRpcUrl,
  handleSlicePaymasterRequest
} from "./slicePaymaster"

type Eip7702Auth = {
  address: Address
  chainId: string | number
  nonce: Hex
  yParity: Hex
  r: Hex
  s: Hex
}

type PaymasterBodyOptions = {
  chainId?: number
  entryPoint?: Address
  eip7702Auth?: Eip7702Auth
  factory?: Address | "0x7702"
  factoryData?: Hex
  initCode?: Hex
  nonce?: Hex
}

type TestUserOperationQuantityFields = Partial<
  Record<
    | "callGasLimit"
    | "maxFeePerGas"
    | "maxPriorityFeePerGas"
    | "nonce"
    | "paymasterPostOpGasLimit"
    | "paymasterVerificationGasLimit"
    | "preVerificationGas"
    | "verificationGasLimit",
    Hex
  >
>

const cdpApiKey = "key_123"
const paymasterUrl = `https://api.developer.coinbase.com/rpc/v1/base/${cdpApiKey}`
const policyBaseUrl = "https://api.slice.so"
const sender = "0x0000000000000000000000000000000000000001"
const arbitraryTokenAddress = "0x0000000000000000000000000000000000001234"
const cdpEip7702ProxyAddress =
  "0x7702cb554e6bFb442cb743A7dF23154544a7176C" satisfies Address
const untrustedEip7702DelegateAddress =
  "0x0000000000000000000000000000000000000771" satisfies Address
const untrustedFactoryAddress =
  "0x0000000000000000000000000000000000000772" satisfies Address
const zeroHash =
  "0x0000000000000000000000000000000000000000000000000000000000000000" satisfies Hex
const productsModuleAddress = getProductsModuleAddress(base.id)
const fundsModuleAddress = getFundsModuleAddress(base.id)
const cdpBasePaymasterAddress =
  "0x2FAEB0760D4230Ef2aC21496Bb4F0b47D634FD4c" satisfies Address
const indexedSlicerAddress =
  "0x742d35cc6634c0532925a3b844bc9e7d1333d262" satisfies Address
const generatedHookAddress = sliceHookAddressList[0] as Address
const USDCAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address
const erc7579BatchDefaultMode =
  "0x0100000000000000000000000000000000000000000000000000000000000000" satisfies Hex
const erc7579SingleDefaultMode =
  "0x0000000000000000000000000000000000000000000000000000000000000000" satisfies Hex
const erc7579SingleTryMode =
  "0x0001000000000000000000000000000000000000000000000000000000000000" satisfies Hex

// Kernel v4 nonce layout: [1B mode][1B validator type][20B id][2B key][8B seq]
const buildKernelNonce = ({
  mode,
  validatorType
}: {
  mode: bigint
  validatorType: bigint
}) => numberToHex((mode << 248n) | (validatorType << 240n) | 7n)

const rootValidationNonce = buildKernelNonce({ mode: 0n, validatorType: 0n })
const permissionValidationNonce = buildKernelNonce({
  mode: 0n,
  validatorType: 2n
})

/** Runtime code of accounts deployed by the pinned Slice Kernel factory. */
const kernelProxyCode =
  "0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3" satisfies Hex

const kernelSenderAccountSnapshot: SliceSenderAccountSnapshot = {
  code: kernelProxyCode,
  erc1967Implementation: pad(sliceKernelAddresses.implementation, {
    size: 32
  })
}

const createSlicerValidationFetch = ({
  address,
  isSlicer
}: {
  address: Address
  isSlicer: boolean
}) =>
  mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input
    const url = new URL(inputUrl)
    expect(url.origin).toBe("https://api.slice.so")
    expect(url.pathname.toLowerCase()).toBe(
      `/slicers/validate-address/${address.toLowerCase()}`
    )
    expect(init?.method).toBe("GET")

    if (!isSlicer) {
      return Response.json({ isSlicer: false }, { status: 404 })
    }

    return Response.json({
      isSlicer: true,
      slicerId: 1,
      address
    })
  })

const encodeSmartWalletExecute = ({
  data,
  target,
  value = 0n
}: {
  data: Hex
  target: Address
  value?: bigint
}) =>
  encodeFunctionData({
    abi: coinbaseSmartWalletExecutionAbi,
    functionName: "execute",
    args: [target, value, data]
  })

const encodeSetProductType = () =>
  encodeFunctionData({
    abi: productsModuleAbi,
    functionName: "setProductType",
    args: [1n, 2n, "3"]
  })

const encodeSetWithdrawerRestricted = () =>
  encodeFunctionData({
    abi: fundsModuleAbi,
    functionName: "setWithdrawerRestricted",
    args: [true]
  })

const encodeHookConfigureProduct = () =>
  encodeFunctionData({
    abi: registryProductActionAbi,
    functionName: "configureProduct",
    args: [1n, 2n, 0n, "0x"]
  })

const encodeInstallPermission = () =>
  encodeFunctionData({
    abi: kernelValidationManagementAbi,
    functionName: "installModule",
    args: [
      [
        {
          internalData: "0x12345678",
          module: sliceWalletKernelAddresses.sudoPolicy,
          moduleData: "0x",
          moduleType: 5n
        },
        {
          internalData: concat([
            "0x12345678",
            zeroAddress,
            kernelPermissionExecuteSelector
          ]),
          module: sliceWalletKernelAddresses.ecdsaSigner,
          moduleData: "0x",
          moduleType: 6n
        }
      ]
    ]
  })

const encodeInstallNonceCheckpoint = () =>
  encodeFunctionData({
    abi: kernelValidationManagementAbi,
    functionName: "setNonce",
    args: [0n, 1n]
  })

const encodeSmartWalletExecuteBatch = (
  calls: { data: Hex; target: Address; value?: bigint }[]
) =>
  encodeFunctionData({
    abi: coinbaseSmartWalletExecutionAbi,
    functionName: "executeBatch",
    args: [
      calls.map(({ data, target, value = 0n }) => ({
        data,
        target,
        value
      }))
    ]
  })

const encodeAmbireExecuteBySender = (
  calls: { data: Hex; target: Address; value?: bigint }[]
) =>
  encodeFunctionData({
    abi: ambireAccountExecutionAbi,
    functionName: "executeBySender",
    args: [
      calls.map(({ data, target, value = 0n }) => ({
        data,
        to: target,
        value
      }))
    ]
  })

const encodeMetaMaskExecute = ({
  data,
  target,
  value = 0n
}: {
  data: Hex
  target: Address
  value?: bigint
}) =>
  encodeFunctionData({
    abi: metaMaskDelegatorExecutionAbi,
    functionName: "execute",
    args: [{ target, value, callData: data }]
  })

const encodeErc7579PackedExecution = ({
  data,
  target,
  value = 0n
}: {
  data: Hex
  target: Address
  value?: bigint
}) => encodePacked(["address", "uint256", "bytes"], [target, value, data])

const encodeErc7579ExecuteWithMode = ({
  data,
  mode,
  target,
  value = 0n
}: {
  data: Hex
  mode: Hex
  target: Address
  value?: bigint
}) =>
  encodeFunctionData({
    abi: erc7579AccountExecutionAbi,
    functionName: "execute",
    args: [mode, encodeErc7579PackedExecution({ data, target, value })]
  })

const encodeErc7579ExecuteBatch = (
  calls: { data: Hex; target: Address; value?: bigint }[]
) =>
  encodeFunctionData({
    abi: erc7579AccountExecutionAbi,
    functionName: "execute",
    args: [
      erc7579BatchDefaultMode,
      encodeAbiParameters(erc7579BatchExecutionAbiParameters, [
        calls.map(({ data, target, value = 0n }) => ({
          target,
          value,
          callData: data
        }))
      ])
    ]
  })

const createEip7702Auth = ({
  address = cdpEip7702ProxyAddress,
  chainId = `0x${base.id.toString(16)}`
}: {
  address?: Address
  chainId?: string | number
} = {}): Eip7702Auth => ({
  address,
  chainId,
  nonce: "0x1",
  yParity: "0x0",
  r: zeroHash,
  s: zeroHash
})

const createInitCode = (factory: Address) =>
  encodePacked(["address", "bytes"], [factory, "0x1234"])

const createPaymasterBody = (
  callData: Hex,
  {
    chainId = base.id,
    entryPoint = entryPoint06Address,
    eip7702Auth,
    factory,
    factoryData,
    initCode,
    nonce = "0x0"
  }: PaymasterBodyOptions = {}
) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "pm_getPaymasterStubData",
  params: [
    {
      sender,
      nonce,
      callData,
      ...(eip7702Auth ? { eip7702Auth } : {}),
      ...(factory ? { factory } : {}),
      ...(factoryData ? { factoryData } : {}),
      ...(initCode ? { initCode } : {})
    },
    entryPoint,
    `0x${chainId.toString(16)}`
  ]
})

const createPaymasterBodyWithUserOperationQuantities = ({
  callData,
  quantities,
  options
}: {
  callData: Hex
  quantities: TestUserOperationQuantityFields
  options?: PaymasterBodyOptions
}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "pm_getPaymasterStubData",
  params: [
    {
      sender,
      nonce: "0x0",
      callData,
      ...quantities,
      ...(options?.eip7702Auth ? { eip7702Auth: options.eip7702Auth } : {})
    },
    options?.entryPoint ?? entryPoint06Address,
    `0x${base.id.toString(16)}`
  ]
})

type HandleSlicePaymasterRequestOptions = Parameters<
  typeof handleSlicePaymasterRequest
>[1]

const unexpectedSlicerValidationFetch = () =>
  mock(async () => {
    throw new Error("Unexpected slicer validation lookup")
  })

const handleTestPaymasterRequest = (
  request: Request,
  options: Omit<HandleSlicePaymasterRequestOptions, "fetchSlicer"> &
    Partial<Pick<HandleSlicePaymasterRequestOptions, "fetchSlicer">>
) =>
  handleSlicePaymasterRequest(request, {
    fetchSlicer: unexpectedSlicerValidationFetch(),
    policyBaseUrl,
    ...options
  })

describe("slice paymaster", () => {
  it("resolves the CDP paymaster URL from the API key", () => {
    expect(getSlicePaymasterRpcUrl({ cdpApiKey })).toBe(paymasterUrl)
    expect(getSlicePaymasterRpcUrl({ cdpApiKey: "  " })).toBeNull()
  })

  it("forwards valid Slice paymaster requests", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      })
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.method).toBe("POST")
        expect(init?.headers).toEqual({ "content-type": "application/json" })
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { paymasterAndData: "0x1234" }
    })
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("reports upstream JSON-RPC errors without changing the proxied response", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      })
    )
    const upstreamError = {
      code: -32000,
      data: { reason: "policy limit" },
      message: "paymaster rejected"
    } as const
    const fetchPaymaster = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: upstreamError
      })
    )
    const onUpstreamError = mock(() => {})

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        onUpstreamError
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: body.id,
      error: upstreamError
    })
    expect(onUpstreamError).toHaveBeenCalledWith({
      error: upstreamError,
      id: body.id,
      method: body.method
    })
  })

  it("does not report successful upstream JSON-RPC responses", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      })
    )
    const fetchPaymaster = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { paymasterAndData: "0x1234" }
      })
    )
    const onUpstreamError = mock(() => {})

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        onUpstreamError
      }
    )

    expect(response.status).toBe(200)
    expect(onUpstreamError).not.toHaveBeenCalled()
  })

  it("forwards FundsModule calls as Slice operations", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: fundsModuleAddress,
        data: encodeSetWithdrawerRestricted()
      })
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("allows ERC20 approvals to FundsModule with a FundsModule call", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [fundsModuleAddress, 1n]
    })
    const body = createPaymasterBody(
      encodeSmartWalletExecuteBatch([
        {
          target: arbitraryTokenAddress,
          data: approveCallData
        },
        {
          target: fundsModuleAddress,
          data: encodeSetWithdrawerRestricted()
        }
      ])
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("forwards indexed slicer contract calls resolved through the API lookup", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: indexedSlicerAddress,
        data: "0x12345678"
      })
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )
    const fetchSlicer = createSlicerValidationFetch({
      address: indexedSlicerAddress,
      isSlicer: true
    })

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        fetchSlicer
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
    expect(fetchSlicer).toHaveBeenCalledTimes(1)
  })

  it("disables indexed slicer lookup when the policy base URL is omitted", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: indexedSlicerAddress,
        data: "0x12345678"
      })
    )
    const fetchPaymaster = mock<typeof fetch>()
    const fetchSlicer = mock<typeof fetch>()

    const response = await handleSlicePaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      { cdpApiKey, fetchPaymaster, fetchSlicer }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
    expect(fetchSlicer).not.toHaveBeenCalled()
  })

  it("rejects unknown contract calls when the API lookup does not find a slicer", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: indexedSlicerAddress,
        data: "0x12345678"
      })
    )
    const fetchPaymaster = mock<typeof fetch>()
    const fetchSlicer = createSlicerValidationFetch({
      address: indexedSlicerAddress,
      isSlicer: false
    })

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        fetchSlicer
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
    expect(fetchSlicer).toHaveBeenCalledTimes(1)
  })

  it("forwards Ambire account requests through EntryPoint v0.7", async () => {
    const body = createPaymasterBody(
      encodeAmbireExecuteBySender([
        {
          target: productsModuleAddress,
          data: encodeSetProductType()
        }
      ]),
      { entryPoint: entryPoint07Address }
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("normalizes Ambire UserOperation gas quantities before forwarding", async () => {
    const callData = encodeAmbireExecuteBySender([
      {
        target: productsModuleAddress,
        data: encodeSetProductType()
      }
    ])
    const body = createPaymasterBodyWithUserOperationQuantities({
      callData,
      quantities: {
        callGasLimit: "0x000f",
        maxFeePerGas: "0x0001",
        maxPriorityFeePerGas: "0x0002",
        paymasterPostOpGasLimit: "0x0004",
        paymasterVerificationGasLimit: "0x0003",
        preVerificationGas: "0x0010",
        verificationGasLimit: "0x0000"
      },
      options: { entryPoint: entryPoint07Address }
    })
    const expectedForwardedBody =
      createPaymasterBodyWithUserOperationQuantities({
        callData,
        quantities: {
          callGasLimit: "0xf",
          maxFeePerGas: "0x1",
          maxPriorityFeePerGas: "0x2",
          paymasterPostOpGasLimit: "0x4",
          paymasterVerificationGasLimit: "0x3",
          preVerificationGas: "0x10",
          verificationGasLimit: "0x0"
        },
        options: { entryPoint: entryPoint07Address }
      })
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(expectedForwardedBody))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("forwards MetaMask DeleGator execute requests through EntryPoint v0.7", async () => {
    const body = createPaymasterBody(
      encodeMetaMaskExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      { entryPoint: entryPoint07Address }
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("forwards ERC-7579 default single-mode requests through EntryPoint v0.7", async () => {
    const body = createPaymasterBody(
      encodeErc7579ExecuteWithMode({
        mode: erc7579SingleDefaultMode,
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      { entryPoint: entryPoint07Address }
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("forwards ERC-7579 default batch requests through EntryPoint v0.7", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [cdpBasePaymasterAddress, 1n]
    })
    const body = createPaymasterBody(
      encodeErc7579ExecuteBatch([
        {
          target: arbitraryTokenAddress,
          data: approveCallData
        },
        {
          target: productsModuleAddress,
          data: encodeSetProductType()
        }
      ]),
      { entryPoint: entryPoint07Address }
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("rejects ERC-7579 try-mode requests", async () => {
    const body = createPaymasterBody(
      encodeErc7579ExecuteWithMode({
        mode: erc7579SingleTryMode,
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      { entryPoint: entryPoint07Address }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("forwards supported EntryPoint v0.8 and v0.9 requests", async () => {
    for (const entryPoint of [entryPoint08Address, entryPoint09Address]) {
      const body = createPaymasterBody(
        encodeSmartWalletExecute({
          target: productsModuleAddress,
          data: encodeSetProductType()
        }),
        { entryPoint }
      )
      const fetchPaymaster = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(input).toBe(paymasterUrl)
          expect(init?.body).toBe(JSON.stringify(body))

          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { paymasterAndData: "0x1234" }
          })
        }
      )

      const response = await handleTestPaymasterRequest(
        new Request("https://shop.test/api/paymaster", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchPaymaster
        }
      )

      expect(response.status).toBe(200)
      expect(fetchPaymaster).toHaveBeenCalledTimes(1)
    }
  })

  it("rejects unsupported EntryPoint addresses", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      {
        entryPoint: "0x000000000000000000000000000000000000dEaD"
      }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("treats null paymaster context as absent", async () => {
    const baseBody = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      })
    )
    const body = {
      ...baseBody,
      params: [...baseBody.params, null]
    }
    const fetchPaymaster = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("forwards EIP-7702 requests for allowlisted Base delegates", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      {
        eip7702Auth: createEip7702Auth()
      }
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        eip7702DelegateAllowlist: [cdpEip7702ProxyAddress],
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("rejects EIP-7702 requests when no delegate allowlist is configured", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      {
        eip7702Auth: createEip7702Auth()
      }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("rejects EIP-7702 requests for non-Base authorizations", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      {
        eip7702Auth: createEip7702Auth({ chainId: "0x1" })
      }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        eip7702DelegateAllowlist: [cdpEip7702ProxyAddress],
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("rejects EIP-7702 requests for untrusted delegates", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      {
        eip7702Auth: createEip7702Auth()
      }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        eip7702DelegateAllowlist: [untrustedEip7702DelegateAddress],
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("forwards deployment user operations through Slice Kernel factories", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })

    for (const factory of [sliceKernelAddresses.factory]) {
      const body = createPaymasterBody(callData, {
        entryPoint: entryPoint09Address,
        factory,
        factoryData: "0x1234"
      })
      const fetchPaymaster = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(input).toBe(paymasterUrl)
          expect(init?.body).toBe(JSON.stringify(body))

          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: { paymasterAndData: "0x1234" }
          })
        }
      )

      const response = await handleTestPaymasterRequest(
        new Request("https://shop.test/api/paymaster", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchPaymaster
        }
      )

      expect(response.status).toBe(200)
      expect(fetchPaymaster).toHaveBeenCalledTimes(1)
    }
  })

  it("rejects deployment user operations through unknown factories", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }),
      {
        entryPoint: entryPoint09Address,
        factory: untrustedFactoryAddress,
        factoryData: "0x1234"
      }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("keeps EIP-7702 factory marker governed by the delegate allowlist", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const allowedBody = createPaymasterBody(callData, {
      eip7702Auth: createEip7702Auth(),
      factory: "0x7702"
    })
    const allowedFetchPaymaster = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBe(JSON.stringify(allowedBody))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const allowedResponse = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(allowedBody),
        method: "POST"
      }),
      {
        cdpApiKey,
        eip7702DelegateAllowlist: [cdpEip7702ProxyAddress],
        fetchPaymaster: allowedFetchPaymaster
      }
    )

    expect(allowedResponse.status).toBe(200)
    expect(allowedFetchPaymaster).toHaveBeenCalledTimes(1)

    const rejectedBody = createPaymasterBody(callData, {
      eip7702Auth: createEip7702Auth(),
      factory: "0x7702"
    })
    const rejectedFetchPaymaster = mock<typeof fetch>()

    const rejectedResponse = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(rejectedBody),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster: rejectedFetchPaymaster
      }
    )

    expect(rejectedResponse.status).toBe(403)
    expect(rejectedFetchPaymaster).not.toHaveBeenCalled()
  })

  it("rejects the Kernel v4 factory through EntryPoint v0.6", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const acceptedBody = createPaymasterBody(callData, {
      initCode: createInitCode(sliceKernelAddresses.factory)
    })
    const acceptedFetchPaymaster = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBe(JSON.stringify(acceptedBody))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const acceptedResponse = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(acceptedBody),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster: acceptedFetchPaymaster
      }
    )

    expect(acceptedResponse.status).toBe(403)
    expect(acceptedFetchPaymaster).not.toHaveBeenCalled()

    const rejectedBody = createPaymasterBody(callData, {
      initCode: createInitCode(untrustedFactoryAddress)
    })
    const rejectedFetchPaymaster = mock<typeof fetch>()

    const rejectedResponse = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(rejectedBody),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster: rejectedFetchPaymaster
      }
    )

    expect(rejectedResponse.status).toBe(403)
    expect(rejectedFetchPaymaster).not.toHaveBeenCalled()
  })

  it("forwards accepted payment tokens discovery requests", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "pm_getAcceptedPaymentTokens",
      params: [entryPoint06Address, `0x${base.id.toString(16)}`, {}]
    }
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.method).toBe("POST")
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            acceptedTokens: [
              {
                name: "USDC",
                address: USDCAddress,
                decimals: 6
              }
            ]
          }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        acceptedTokens: [
          {
            name: "USDC",
            address: USDCAddress,
            decimals: 6
          }
        ]
      }
    })
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("can disable accepted payment tokens discovery on a narrow proxy", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "pm_getAcceptedPaymentTokens",
      params: [entryPoint06Address, `0x${base.id.toString(16)}`, {}]
    }
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://id.slice.so/v1/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        allowAcceptedPaymentTokens: false,
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("rejects accepted payment tokens discovery outside the Base EntryPoint", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "pm_getAcceptedPaymentTokens",
      params: [entryPoint06Address, "0x1", {}]
    }
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "Unsupported accepted payment tokens request"
      }
    })
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("rejects approval-only requests", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [productsModuleAddress, 1n]
    })
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: USDCAddress,
        data: approveCallData
      })
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "Not a sponsorable Slice operation"
      }
    })
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("allows any ERC20 approval to ProductsModule with a Slice call", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [productsModuleAddress, 1n]
    })
    const body = createPaymasterBody(
      encodeSmartWalletExecuteBatch([
        {
          target: arbitraryTokenAddress,
          data: approveCallData
        },
        {
          target: productsModuleAddress,
          data: encodeSetProductType()
        }
      ])
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("allows ERC20 approval to the CDP paymaster with a Slice call", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [cdpBasePaymasterAddress, 1n]
    })
    const body = createPaymasterBody(
      encodeSmartWalletExecuteBatch([
        {
          target: arbitraryTokenAddress,
          data: approveCallData
        },
        {
          target: productsModuleAddress,
          data: encodeSetProductType()
        }
      ])
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("rejects CDP paymaster approval-only requests", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [cdpBasePaymasterAddress, 1n]
    })
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: arbitraryTokenAddress,
        data: approveCallData
      })
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32000,
        message: "Not a sponsorable Slice operation"
      }
    })
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("forwards generated hook-only batches", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecuteBatch([
        {
          target: generatedHookAddress,
          data: encodeHookConfigureProduct()
        }
      ])
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
  })

  it("sponsors root-signed recovery validation management on the sender", async () => {
    const body = createPaymasterBody(
      encodeErc7579ExecuteBatch([
        { target: sender, data: encodeInstallPermission() },
        { target: sender, data: encodeInstallNonceCheckpoint() }
      ]),
      { entryPoint: entryPoint09Address, nonce: rootValidationNonce }
    )
    const fetchPaymaster = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe(paymasterUrl)
        expect(init?.body).toBe(JSON.stringify(body))

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { paymasterAndData: "0x1234" }
        })
      }
    )
    const fetchSenderAccount = mock(async () => kernelSenderAccountSnapshot)

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        fetchSenderAccount
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
    expect(fetchSenderAccount).toHaveBeenCalledTimes(1)
  })

  it("sponsors Kernel's direct root self-administration call", async () => {
    const body = createPaymasterBody(encodeInstallNonceCheckpoint(), {
      entryPoint: entryPoint09Address,
      nonce: rootValidationNonce
    })
    const fetchPaymaster = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { paymasterAndData: "0x1234" }
      })
    )
    const fetchSenderAccount = mock(async () => kernelSenderAccountSnapshot)

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        fetchSenderAccount
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
    expect(fetchSenderAccount).toHaveBeenCalledTimes(1)
  })

  it("rejects recovery administration when the sender cannot be verified", async () => {
    const body = createPaymasterBody(
      encodeErc7579ExecuteBatch([
        { target: sender, data: encodeInstallPermission() },
        { target: sender, data: encodeInstallNonceCheckpoint() }
      ]),
      { entryPoint: entryPoint09Address, nonce: rootValidationNonce }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("dedupes indexed slicer lookups across batch calls", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecuteBatch([
        { target: indexedSlicerAddress, data: "0x12345678" },
        { target: indexedSlicerAddress, data: "0x87654321" },
        { target: indexedSlicerAddress, data: "0x11112222" }
      ])
    )
    const fetchPaymaster = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { paymasterAndData: "0x1234" }
      })
    )
    const fetchSlicer = createSlicerValidationFetch({
      address: indexedSlicerAddress,
      isSlicer: true
    })

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster,
        fetchSlicer
      }
    )

    expect(response.status).toBe(200)
    expect(fetchPaymaster).toHaveBeenCalledTimes(1)
    expect(fetchSlicer).toHaveBeenCalledTimes(1)
  })

  it("rejects recovery validation management without root validation", async () => {
    const body = createPaymasterBody(
      encodeErc7579ExecuteBatch([
        { target: sender, data: encodeInstallPermission() },
        { target: sender, data: encodeInstallNonceCheckpoint() }
      ]),
      { entryPoint: entryPoint09Address, nonce: permissionValidationNonce }
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })

  it("rejects calls outside accepted Slice targets", async () => {
    const body = createPaymasterBody(
      encodeSmartWalletExecute({
        target: "0x000000000000000000000000000000000000dEaD",
        data: encodeSetProductType()
      })
    )
    const fetchPaymaster = mock<typeof fetch>()

    const response = await handleTestPaymasterRequest(
      new Request("https://shop.test/api/paymaster", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchPaymaster
      }
    )

    expect(response.status).toBe(403)
    expect(fetchPaymaster).not.toHaveBeenCalled()
  })
})
