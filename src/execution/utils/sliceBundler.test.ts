import { describe, expect, it, mock } from "bun:test"
import { productsModuleAbi } from "@slicekit/abi"
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  numberToHex,
  pad,
  zeroAddress,
  zeroHash
} from "viem"
import { entryPoint07Address } from "viem/account-abstraction"
import { anvil, base } from "viem/chains"
import type {
  SliceSenderAccountSnapshot,
  SliceUserOperation
} from "../../types/userOperation"
import { getProductsModuleAddress } from "../generated/commerceFacts"
import {
  sliceKernelBaseV33Addresses,
  sliceKernelTimelockPolicyAddress
} from "./sliceAccountClient"
import {
  classifyAltoBundlerRetryReason,
  getSliceBundlerApiUrl,
  getSliceBundlerRpcUrl,
  handleSliceBundlerRequest,
  sliceBundlerRetryDataCode,
  sliceBundlerRetryRpcCode
} from "./sliceBundler"
import {
  coinbaseSmartWalletExecutionAbi,
  erc7579AccountExecutionAbi,
  erc7579BatchExecutionAbiParameters,
  kernelTimelockPolicyCancelAbi,
  kernelValidationManagementAbi
} from "./slicePaymasterAbis"
import {
  isAcceptedSliceIdSecurityOperationUserOperation,
  isAcceptedSliceIdUserFundedRegistryOperationUserOperation,
  isAcceptedSliceRecoveryCancellationUserOperation,
  isAcceptedSliceWalletSenderUserOperation,
  sliceIdAuthorizationRevocationRegistryAddress,
  sliceKernelBaseV33SenderCode
} from "./sliceUserOperationPolicy"

const cdpApiKey = "key_123"
const bundlerUrl = `https://api.developer.coinbase.com/rpc/v1/base/${cdpApiKey}`
const sender = "0x0000000000000000000000000000000000000001" satisfies Address
const productsModuleAddress = getProductsModuleAddress(base.id)
const arbitraryTargetAddress =
  "0x0000000000000000000000000000000000001234" satisfies Address
const userOperationHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" satisfies Hex

type BundlerUserOperationOptions = {
  factory?: Address | "0x7702"
  factoryData?: Hex
  nonce?: Hex
}

// Kernel v3 nonce layout: [1B mode][1B validator type][20B id][2B key][8B seq]
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

const recoveryValidationId = `0x02${"11".repeat(20)}` as Hex
const recoveryTimelockProposalId = `0x${"22".repeat(32)}` as Hex
const erc7579BatchDefaultMode =
  "0x0100000000000000000000000000000000000000000000000000000000000000" satisfies Hex

/** Runtime code of accounts deployed by the pinned Slice Kernel factory. */
const kernelProxyCode =
  "0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3" satisfies Hex

const kernelSenderAccountSnapshot: SliceSenderAccountSnapshot = {
  code: kernelProxyCode,
  erc1967Implementation: pad(sliceKernelBaseV33Addresses.implementation, {
    size: 32
  })
}
const kernelMetaFactoryAbi = [
  {
    inputs: [
      { name: "factory", type: "address" },
      { name: "createData", type: "bytes" },
      { name: "salt", type: "bytes32" }
    ],
    name: "deployWithFactory",
    outputs: [{ name: "account", type: "address" }],
    stateMutability: "payable",
    type: "function"
  }
] as const
const canonicalKernelFactoryData = encodeFunctionData({
  abi: kernelMetaFactoryAbi,
  args: [sliceKernelBaseV33Addresses.factory, "0x1234", zeroHash],
  functionName: "deployWithFactory"
})
const unknownSenderAccountSnapshot: SliceSenderAccountSnapshot = {
  code: "0x6001600155",
  erc1967Implementation: pad("0x00", { size: 32 })
}
const undeployedSenderAccountSnapshot: SliceSenderAccountSnapshot = {
  code: "0x",
  erc1967Implementation: pad("0x00", { size: 32 })
}

const createSenderAccountFetch = (snapshot: SliceSenderAccountSnapshot) =>
  mock(async () => snapshot)

const encodeSetProductType = () =>
  encodeFunctionData({
    abi: productsModuleAbi,
    functionName: "setProductType",
    args: [1n, 2n, "3"]
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

const encodeInstallValidations = () =>
  encodeFunctionData({
    abi: kernelValidationManagementAbi,
    functionName: "installValidations",
    args: [
      [recoveryValidationId],
      [{ hook: zeroAddress, nonce: 1 }],
      ["0x"],
      ["0x"]
    ]
  })

const encodeGrantAccess = (allow = true) =>
  encodeFunctionData({
    abi: kernelValidationManagementAbi,
    functionName: "grantAccess",
    args: [recoveryValidationId, "0xe9ae5c53", allow]
  })

const encodeUninstallValidation = () =>
  encodeFunctionData({
    abi: kernelValidationManagementAbi,
    functionName: "uninstallValidation",
    args: [recoveryValidationId, "0x", "0x"]
  })

const encodeCancelRecoveryProposal = (account: Address) =>
  encodeFunctionData({
    abi: kernelTimelockPolicyCancelAbi,
    functionName: "cancelProposal",
    args: [recoveryTimelockProposalId, account, "0x", 0n]
  })

const createBundlerUserOperation = (
  callData: Hex,
  options: BundlerUserOperationOptions = {}
): SliceUserOperation => ({
  sender,
  nonce: options.nonce ?? "0x0",
  callData,
  ...(options.factory ? { factory: options.factory } : {}),
  ...(options.factoryData ? { factoryData: options.factoryData } : {})
})

const createBundlerBody = (
  method: "eth_estimateUserOperationGas" | "eth_sendUserOperation",
  callData: Hex,
  options?: BundlerUserOperationOptions
) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: [createBundlerUserOperation(callData, options), entryPoint07Address]
})

type HandleSliceBundlerRequestOptions = Parameters<
  typeof handleSliceBundlerRequest
>[1]

const unexpectedSlicerValidationFetch = () =>
  mock(async () => {
    throw new Error("Unexpected slicer validation lookup")
  })

const handleTestBundlerRequest = (
  request: Request,
  options: Omit<HandleSliceBundlerRequestOptions, "fetchSlicer"> &
    Partial<Pick<HandleSliceBundlerRequestOptions, "fetchSlicer">>
) =>
  handleSliceBundlerRequest(request, {
    fetchSlicer: unexpectedSlicerValidationFetch(),
    ...options
  })

describe("slice bundler", () => {
  it("classifies only Alto's exact structured fee-admission reasons", () => {
    expect(
      classifyAltoBundlerRetryReason({
        code: -32602,
        message:
          "maxFeePerGas must be at least 20 (current maxFeePerGas: 10) - use pimlico_getUserOperationGasPrice to get the current gas price"
      })
    ).toBe("fee_floor")
    expect(
      classifyAltoBundlerRetryReason({
        code: -32602,
        message:
          "AA25 invalid account nonce: User operation already present in mempool, bump the gas price by minimum 10%"
      })
    ).toBe("replacement_underpriced")
    expect(
      classifyAltoBundlerRetryReason({
        code: -32602,
        message:
          "maxFeePerGas must be at least 20 (current maxFeePerGas: 10) - retry"
      })
    ).toBeNull()
    expect(
      classifyAltoBundlerRetryReason({
        code: -32500,
        message:
          "maxFeePerGas must be at least 20 (current maxFeePerGas: 10) - use pimlico_getUserOperationGasPrice to get the current gas price"
      })
    ).toBeNull()
  })

  it("normalizes an accepted Alto fee-floor rejection for the wallet", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(
          createBundlerBody("eth_sendUserOperation", callData)
        ),
        method: "POST"
      }),
      {
        bundlerRpcUrl: "http://localhost:4337",
        classifyUpstreamError: classifyAltoBundlerRetryReason,
        fetchBundler: mock(async () =>
          Response.json({
            error: {
              code: -32602,
              message:
                "maxPriorityFeePerGas must be at least 20 (current maxPriorityFeePerGas: 10) - use pimlico_getUserOperationGasPrice to get the current gas price"
            },
            id: 1,
            jsonrpc: "2.0"
          })
        )
      }
    )

    expect(await response.json()).toEqual({
      error: {
        code: sliceBundlerRetryRpcCode,
        data: {
          code: sliceBundlerRetryDataCode,
          provider: "alto-v2",
          reason: "fee_floor",
          version: "1"
        },
        message: "Bundler rejected the user operation fee parameters."
      },
      id: 1,
      jsonrpc: "2.0"
    })
  })

  it("resolves bundler URLs through the shared environment policy", () => {
    expect(getSliceBundlerRpcUrl({ cdpApiKey })).toBe(bundlerUrl)
    expect(getSliceBundlerRpcUrl({ cdpApiKey: "  " })).toBeNull()
    expect(getSliceBundlerRpcUrl({ chainId: 31_337 })).toBe(
      "http://localhost:4337"
    )
    expect(
      getSliceBundlerRpcUrl({
        cdpApiKey,
        chainId: 10,
        serializedBundlerRpcUrls: JSON.stringify({
          10: "https://optimism-bundler.example/rpc"
        })
      })
    ).toBe("https://optimism-bundler.example/rpc")
    expect(
      getSliceBundlerRpcUrl({
        bundlerRpcUrl: "https://custom-bundler.example/rpc",
        cdpApiKey,
        chainId: 8453
      })
    ).toBe("https://custom-bundler.example/rpc")
    expect(getSliceBundlerRpcUrl({ cdpApiKey, chainId: 10 })).toBeNull()
    expect(() =>
      getSliceBundlerRpcUrl({
        cdpApiKey,
        chainId: 10,
        serializedBundlerRpcUrls: JSON.stringify({
          10: "http://remote-bundler.example"
        })
      })
    ).toThrow("Slice bundler RPC URL is not permitted.")
    expect(getSliceBundlerApiUrl("https://shop.test")).toBe(
      "https://shop.test/api/bundler"
    )
  })

  it("forwards to the bundlerRpcUrl override instead of CDP when configured", async () => {
    const overrideUrl = "http://localhost:4337"
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const body = createBundlerBody("eth_sendUserOperation", callData)
    const fetchBundler = mock(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        expect(input).toBe(overrideUrl)

        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: userOperationHash
        })
      }
    )

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        bundlerRpcUrl: overrideUrl,
        cdpApiKey,
        fetchBundler
      }
    )

    expect(response.status).toBe(200)
    expect(fetchBundler).toHaveBeenCalledTimes(1)
  })

  it("forwards valid send and estimate requests after policy checks", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })

    for (const method of [
      "eth_sendUserOperation",
      "eth_estimateUserOperationGas"
    ] as const) {
      const body = createBundlerBody(method, callData, {
        factory: sliceKernelBaseV33Addresses.metaFactory,
        factoryData: "0x1234"
      })
      const fetchBundler = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(input).toBe(bundlerUrl)
          expect(init?.method).toBe("POST")
          expect(init?.headers).toEqual({ "content-type": "application/json" })
          expect(init?.body).toBe(JSON.stringify(body))

          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: userOperationHash
          })
        }
      )

      const response = await handleTestBundlerRequest(
        new Request("https://shop.test/api/bundler", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchBundler
        }
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
      expect(fetchBundler).toHaveBeenCalledTimes(1)
    }
  })

  it("admits local checkout calls only when the caller configures the development chain", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const fetchBundler = mock(async (input: RequestInfo | URL) => {
      expect(input).toBe("http://localhost:4337")
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    })
    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(
          createBundlerBody("eth_sendUserOperation", callData)
        ),
        method: "POST"
      }),
      {
        acceptedChainIds: [anvil.id],
        chainId: anvil.id,
        fetchBundler
      }
    )

    expect(response.status).toBe(200)
    expect(fetchBundler).toHaveBeenCalledTimes(1)
  })

  it("passes the configured chain to the public-wallet authorizer", async () => {
    const authorizeUserOperation = mock(async () => true)
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(
          createBundlerBody("eth_sendUserOperation", callData)
        ),
        method: "POST"
      }),
      {
        authorizeUserOperation,
        bundlerRpcUrl: "https://optimism-bundler.example/rpc",
        cdpApiKey,
        chainId: 10,
        fetchBundler: mock(async () =>
          Response.json({ id: 1, jsonrpc: "2.0", result: userOperationHash })
        )
      }
    )

    expect(response.status).toBe(200)
    expect(authorizeUserOperation).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 10 })
    )
  })

  it("forwards receipt, userop lookup, and supported entry point methods", async () => {
    const bodies = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getUserOperationReceipt",
        params: [userOperationHash]
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_getUserOperationByHash",
        params: [userOperationHash]
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "eth_supportedEntryPoints",
        params: []
      }
    ] as const

    for (const body of bodies) {
      const fetchBundler = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          expect(input).toBe(bundlerUrl)
          expect(init?.body).toBe(JSON.stringify(body))

          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: []
          })
        }
      )

      const response = await handleTestBundlerRequest(
        new Request("https://shop.test/api/bundler", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchBundler
        }
      )

      expect(response.status).toBe(200)
      expect(fetchBundler).toHaveBeenCalledTimes(1)
    }
  })

  it("reports upstream JSON-RPC errors without changing the proxied response", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getUserOperationReceipt",
      params: [userOperationHash]
    } as const
    const upstreamError = {
      code: -32000,
      data: "0x1234",
      message: "receipt lookup failed"
    }
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: upstreamError
      })
    )
    const onUpstreamError = mock(() => {})

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler,
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
      method: body.method,
      userOperationHash
    })
  })

  it("does not report successful upstream JSON-RPC responses", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const body = createBundlerBody("eth_sendUserOperation", callData, {
      factory: sliceKernelBaseV33Addresses.metaFactory,
      factoryData: "0x1234"
    })
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: userOperationHash
      })
    )
    const onUpstreamError = mock(() => {})

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler,
        onUpstreamError
      }
    )

    expect(response.status).toBe(200)
    expect(onUpstreamError).not.toHaveBeenCalled()
  })

  it("rejects unsupported methods and invalid hash params", async () => {
    for (const body of [
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [] },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "pm_getPaymasterData",
        params: []
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "eth_getUserOperationReceipt",
        params: ["0x1234"]
      }
    ]) {
      const fetchBundler = mock<typeof fetch>()

      const response = await handleTestBundlerRequest(
        new Request("https://shop.test/api/bundler", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchBundler
        }
      )

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: -32600 }
      })
      expect(fetchBundler).not.toHaveBeenCalled()
    }
  })

  it("rejects send and estimate requests that fail Slice policy", async () => {
    const approveCallData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [arbitraryTargetAddress, 1n]
    })

    for (const body of [
      createBundlerBody(
        "eth_sendUserOperation",
        encodeSmartWalletExecute({
          target: arbitraryTargetAddress,
          data: "0x12345678"
        })
      ),
      createBundlerBody(
        "eth_estimateUserOperationGas",
        encodeSmartWalletExecute({
          target: arbitraryTargetAddress,
          data: approveCallData
        })
      ),
      createBundlerBody(
        "eth_sendUserOperation",
        encodeSmartWalletExecute({
          target: productsModuleAddress,
          data: encodeSetProductType()
        }),
        {
          factory: arbitraryTargetAddress,
          factoryData: "0x1234"
        }
      )
    ]) {
      const fetchBundler = mock<typeof fetch>()

      const response = await handleTestBundlerRequest(
        new Request("https://shop.test/api/bundler", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchBundler
        }
      )

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        error: { code: -32000 }
      })
      expect(fetchBundler).not.toHaveBeenCalled()
    }
  })

  it("lets a replacement authorizer admit non-commerce wallet calls", async () => {
    const body = createBundlerBody(
      "eth_sendUserOperation",
      encodeSmartWalletExecute({
        target: arbitraryTargetAddress,
        data: "0x12345678"
      })
    )
    const authorizeUserOperation = mock(() => true)
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    )

    const response = await handleTestBundlerRequest(
      new Request("https://api.test/wallet-rpc/8453/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      { authorizeUserOperation, cdpApiKey, fetchBundler }
    )

    expect(response.status).toBe(200)
    expect(authorizeUserOperation).toHaveBeenCalledWith({
      chainId: base.id,
      entryPoint: entryPoint07Address,
      userOperation: body.params[0]
    })
    expect(fetchBundler).toHaveBeenCalledTimes(1)
  })

  it("keeps the additional operation predicate after replacement authorization", async () => {
    const body = createBundlerBody(
      "eth_sendUserOperation",
      encodeSmartWalletExecute({
        target: arbitraryTargetAddress,
        data: "0x12345678"
      })
    )
    const acceptUserOperation = mock(() => false)
    const fetchBundler = mock<typeof fetch>()

    const response = await handleTestBundlerRequest(
      new Request("https://api.test/wallet-rpc/8453/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        acceptUserOperation,
        authorizeUserOperation: () => true,
        cdpApiKey,
        fetchBundler
      }
    )

    expect(response.status).toBe(403)
    expect(acceptUserOperation).toHaveBeenCalledTimes(1)
    expect(fetchBundler).not.toHaveBeenCalled()
  })

  it("accepts only canonical Base Kernel senders for public wallet transport", async () => {
    const deployedOperation = createBundlerUserOperation("0x12345678")
    await expect(
      isAcceptedSliceWalletSenderUserOperation({
        chainId: base.id,
        entryPoint: entryPoint07Address,
        fetchSenderAccount: createSenderAccountFetch(
          kernelSenderAccountSnapshot
        ),
        userOperation: deployedOperation
      })
    ).resolves.toBe(true)

    const undeployedOperation = createBundlerUserOperation("0x12345678", {
      factory: sliceKernelBaseV33Addresses.metaFactory,
      factoryData: canonicalKernelFactoryData
    })
    await expect(
      isAcceptedSliceWalletSenderUserOperation({
        chainId: base.id,
        entryPoint: entryPoint07Address,
        fetchSenderAccount: createSenderAccountFetch(
          undeployedSenderAccountSnapshot
        ),
        userOperation: undeployedOperation
      })
    ).resolves.toBe(true)

    for (const userOperation of [
      createBundlerUserOperation("0x12345678", {
        factory: sliceKernelBaseV33Addresses.factory,
        factoryData: "0x1234"
      }),
      createBundlerUserOperation("0x12345678", {
        factory: sliceKernelBaseV33Addresses.metaFactory
      }),
      createBundlerUserOperation("0x12345678", {
        factory: sliceKernelBaseV33Addresses.metaFactory,
        factoryData: "0x1234"
      }),
      createBundlerUserOperation("0x12345678", {
        factory: sliceKernelBaseV33Addresses.metaFactory,
        factoryData: encodeFunctionData({
          abi: kernelMetaFactoryAbi,
          args: [arbitraryTargetAddress, "0x1234", zeroHash],
          functionName: "deployWithFactory"
        })
      }),
      createBundlerUserOperation("0x12345678", {
        factory: "0x7702",
        factoryData: "0x1234"
      })
    ]) {
      await expect(
        isAcceptedSliceWalletSenderUserOperation({
          chainId: base.id,
          entryPoint: entryPoint07Address,
          fetchSenderAccount: createSenderAccountFetch(
            undeployedSenderAccountSnapshot
          ),
          userOperation
        })
      ).resolves.toBe(false)
    }
  })

  it("pins the accepted Kernel sender code hash to the factory-deployed proxy", () => {
    expect(keccak256(kernelProxyCode)).toBe(
      sliceKernelBaseV33SenderCode.codeHash
    )
  })

  it("forwards root-signed recovery validation management on the sender", async () => {
    const callData = encodeErc7579ExecuteBatch([
      { target: sender, data: encodeUninstallValidation() },
      { target: sender, data: encodeInstallValidations() },
      { target: sender, data: encodeGrantAccess() }
    ])
    const body = createBundlerBody("eth_sendUserOperation", callData, {
      nonce: rootValidationNonce
    })
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    )
    const fetchSenderAccount = createSenderAccountFetch(
      kernelSenderAccountSnapshot
    )

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler,
        fetchSenderAccount
      }
    )

    expect(response.status).toBe(200)
    expect(fetchBundler).toHaveBeenCalledTimes(1)
    expect(fetchSenderAccount).toHaveBeenCalledTimes(1)
  })

  it("forwards Kernel's direct root self-administration call", async () => {
    const body = createBundlerBody(
      "eth_sendUserOperation",
      encodeGrantAccess(false),
      { nonce: rootValidationNonce }
    )
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    )
    const fetchSenderAccount = createSenderAccountFetch(
      kernelSenderAccountSnapshot
    )

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler,
        fetchSenderAccount
      }
    )

    expect(response.status).toBe(200)
    expect(fetchBundler).toHaveBeenCalledTimes(1)
    expect(fetchSenderAccount).toHaveBeenCalledTimes(1)
  })

  it("forwards root-signed recovery timelock cancellations for the sender", async () => {
    const body = createBundlerBody(
      "eth_sendUserOperation",
      encodeSmartWalletExecute({
        target: sliceKernelTimelockPolicyAddress,
        data: encodeCancelRecoveryProposal(sender)
      }),
      { nonce: rootValidationNonce }
    )
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    )

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler,
        fetchSenderAccount: createSenderAccountFetch(
          kernelSenderAccountSnapshot
        )
      }
    )

    expect(response.status).toBe(200)
    expect(fetchBundler).toHaveBeenCalledTimes(1)
  })

  it("rejects recovery administration from unverified sender accounts", async () => {
    const callData = encodeErc7579ExecuteBatch([
      { target: sender, data: encodeInstallValidations() }
    ])
    const body = createBundlerBody("eth_sendUserOperation", callData, {
      nonce: rootValidationNonce
    })

    for (const fetchSenderAccount of [
      undefined,
      createSenderAccountFetch(unknownSenderAccountSnapshot),
      createSenderAccountFetch(undeployedSenderAccountSnapshot)
    ]) {
      const fetchBundler = mock<typeof fetch>()

      const response = await handleTestBundlerRequest(
        new Request("https://shop.test/api/bundler", {
          body: JSON.stringify(body),
          method: "POST"
        }),
        {
          cdpApiKey,
          fetchBundler,
          ...(fetchSenderAccount === undefined ? {} : { fetchSenderAccount })
        }
      )

      expect(response.status).toBe(403)
      expect(fetchBundler).not.toHaveBeenCalled()
    }
  })

  it("enforces sender verification for all calls when required", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const body = createBundlerBody("eth_sendUserOperation", callData)

    const acceptedFetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    )
    const acceptedResponse = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler: acceptedFetchBundler,
        fetchSenderAccount: createSenderAccountFetch(
          kernelSenderAccountSnapshot
        ),
        requireVerifiedSender: true
      }
    )
    expect(acceptedResponse.status).toBe(200)
    expect(acceptedFetchBundler).toHaveBeenCalledTimes(1)

    const rejectedFetchBundler = mock<typeof fetch>()
    const rejectedResponse = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler: rejectedFetchBundler,
        fetchSenderAccount: createSenderAccountFetch(
          unknownSenderAccountSnapshot
        ),
        requireVerifiedSender: true
      }
    )
    expect(rejectedResponse.status).toBe(403)
    expect(rejectedFetchBundler).not.toHaveBeenCalled()
  })

  it("accepts undeployed senders with pinned factory args when verification is required", async () => {
    const callData = encodeSmartWalletExecute({
      target: productsModuleAddress,
      data: encodeSetProductType()
    })
    const body = createBundlerBody("eth_sendUserOperation", callData, {
      factory: sliceKernelBaseV33Addresses.metaFactory,
      factoryData: "0x1234"
    })
    const fetchBundler = mock(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: userOperationHash
      })
    )

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler,
        fetchSenderAccount: createSenderAccountFetch(
          undeployedSenderAccountSnapshot
        ),
        requireVerifiedSender: true
      }
    )

    expect(response.status).toBe(200)
    expect(fetchBundler).toHaveBeenCalledTimes(1)
  })

  it("rejects user operations with too many account calls", async () => {
    const callData = encodeErc7579ExecuteBatch(
      Array.from({ length: 11 }, () => ({
        target: productsModuleAddress,
        data: encodeSetProductType()
      }))
    )
    const body = createBundlerBody("eth_sendUserOperation", callData)
    const fetchBundler = mock<typeof fetch>()

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler
      }
    )

    expect(response.status).toBe(403)
    expect(fetchBundler).not.toHaveBeenCalled()
  })

  it("rejects recovery validation management without root (passkey) validation", async () => {
    const callData = encodeErc7579ExecuteBatch([
      { target: sender, data: encodeInstallValidations() },
      { target: sender, data: encodeGrantAccess() }
    ])
    const body = createBundlerBody("eth_sendUserOperation", callData, {
      nonce: permissionValidationNonce
    })
    const fetchBundler = mock<typeof fetch>()

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler
      }
    )

    expect(response.status).toBe(403)
    expect(fetchBundler).not.toHaveBeenCalled()
  })

  it("rejects recovery validation management that does not target the sender", async () => {
    const callData = encodeErc7579ExecuteBatch([
      { target: arbitraryTargetAddress, data: encodeInstallValidations() }
    ])
    const body = createBundlerBody("eth_sendUserOperation", callData, {
      nonce: rootValidationNonce
    })
    const fetchBundler = mock<typeof fetch>()

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler
      }
    )

    expect(response.status).toBe(403)
    expect(fetchBundler).not.toHaveBeenCalled()
  })

  it("rejects recovery timelock cancellations for other accounts", async () => {
    const body = createBundlerBody(
      "eth_sendUserOperation",
      encodeSmartWalletExecute({
        target: sliceKernelTimelockPolicyAddress,
        data: encodeCancelRecoveryProposal(arbitraryTargetAddress)
      }),
      { nonce: rootValidationNonce }
    )
    const fetchBundler = mock<typeof fetch>()

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey,
        fetchBundler
      }
    )

    expect(response.status).toBe(403)
    expect(fetchBundler).not.toHaveBeenCalled()
  })

  it("returns a JSON-RPC error when CDP is not configured", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getUserOperationReceipt",
      params: [userOperationHash]
    }
    const fetchBundler = mock<typeof fetch>()

    const response = await handleTestBundlerRequest(
      new Request("https://shop.test/api/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      {
        cdpApiKey: " ",
        fetchBundler
      }
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: "Bundler is not configured"
      }
    })
    expect(fetchBundler).not.toHaveBeenCalled()
  })

  it("applies an additional user-operation predicate after the general policy", async () => {
    const body = createBundlerBody(
      "eth_sendUserOperation",
      encodeSmartWalletExecute({
        data: encodeSetProductType(),
        target: productsModuleAddress
      })
    )
    const fetchBundler = mock<typeof fetch>()
    const acceptUserOperation = mock(() => false)

    const response = await handleTestBundlerRequest(
      new Request("https://id.slice.so/v1/bundler", {
        body: JSON.stringify(body),
        method: "POST"
      }),
      { acceptUserOperation, cdpApiKey, fetchBundler }
    )

    expect(response.status).toBe(403)
    expect(acceptUserOperation).toHaveBeenCalledTimes(1)
    expect(fetchBundler).not.toHaveBeenCalled()
  })
})

describe("recovery cancellation user-operation policy", () => {
  const cancellation = () =>
    encodeSmartWalletExecute({
      data: encodeCancelRecoveryProposal(sender),
      target: sliceKernelTimelockPolicyAddress
    })

  const accepts = (callData: Hex, nonce = rootValidationNonce) =>
    isAcceptedSliceRecoveryCancellationUserOperation({
      chainId: base.id,
      userOperation: createBundlerUserOperation(callData, { nonce })
    })

  it("accepts a root-authorized cancellation for the sender", () => {
    expect(accepts(cancellation())).toBe(true)
  })

  it("rejects a non-root nonce", () => {
    expect(accepts(cancellation(), permissionValidationNonce)).toBe(false)
  })

  it("rejects a batch mixing cancellation with commerce", () => {
    const mixed = encodeErc7579ExecuteBatch([
      {
        data: encodeCancelRecoveryProposal(sender),
        target: sliceKernelTimelockPolicyAddress
      },
      { data: encodeSetProductType(), target: productsModuleAddress }
    ])
    expect(accepts(mixed)).toBe(false)
  })

  it("rejects malformed execution calldata", () => {
    expect(accepts("0x1234")).toBe(false)
  })

  it("rejects a nonzero-value cancellation", () => {
    expect(
      accepts(
        encodeSmartWalletExecute({
          data: encodeCancelRecoveryProposal(sender),
          target: sliceKernelTimelockPolicyAddress,
          value: 1n
        })
      )
    ).toBe(false)
  })

  it("rejects a decodable non-cancellation selector at the timelock", () => {
    expect(
      accepts(
        encodeSmartWalletExecute({
          data: encodeGrantAccess(),
          target: sliceKernelTimelockPolicyAddress
        })
      )
    ).toBe(false)
  })

  it("rejects cancellation for a different account", () => {
    expect(
      accepts(
        encodeSmartWalletExecute({
          data: encodeCancelRecoveryProposal(arbitraryTargetAddress),
          target: sliceKernelTimelockPolicyAddress
        })
      )
    ).toBe(false)
  })
})

describe("Slice ID security-operation policy", () => {
  const accepts = (callData: Hex, nonce = permissionValidationNonce) =>
    isAcceptedSliceIdSecurityOperationUserOperation({
      chainId: base.id,
      userOperation: createBundlerUserOperation(callData, { nonce })
    })

  it("accepts device-authorized validation lifecycle calls on the sender", () => {
    expect(
      accepts(
        encodeErc7579ExecuteBatch([
          { data: encodeInstallValidations(), target: sender },
          { data: encodeGrantAccess(), target: sender }
        ])
      )
    ).toBe(true)
  })

  it("accepts direct self-administration only for root validation", () => {
    expect(accepts(encodeGrantAccess(false), rootValidationNonce)).toBe(true)
    expect(accepts(encodeGrantAccess(false), permissionValidationNonce)).toBe(
      false
    )
  })

  it("rejects sponsored administration targeting another account", () => {
    expect(
      accepts(
        encodeSmartWalletExecute({
          data: encodeUninstallValidation(),
          target: arbitraryTargetAddress
        })
      )
    ).toBe(false)
  })
})

describe("Slice ID user-funded revocation policy", () => {
  const registryAbi = [
    {
      inputs: [{ name: "authorizationId", type: "bytes32" }],
      name: "revoke",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    },
    {
      inputs: [],
      name: "advanceEpoch",
      outputs: [{ name: "newEpoch", type: "uint64" }],
      stateMutability: "nonpayable",
      type: "function"
    },
    {
      inputs: [
        { name: "root", type: "address" },
        { name: "authorizationId", type: "bytes32" },
        { name: "signature", type: "bytes" }
      ],
      name: "revokeBySig",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function"
    }
  ] as const
  const revokeData = encodeFunctionData({
    abi: registryAbi,
    args: [zeroHash],
    functionName: "revoke"
  })
  const accepts = ({
    callData = encodeErc7579ExecuteBatch([
      {
        data: revokeData,
        target: sliceIdAuthorizationRevocationRegistryAddress
      }
    ]),
    chainId = 31_337,
    nonce = rootValidationNonce
  }: {
    callData?: Hex
    chainId?: number
    nonce?: Hex
  } = {}) =>
    isAcceptedSliceIdUserFundedRegistryOperationUserOperation({
      chainId,
      userOperation: createBundlerUserOperation(callData, { nonce })
    })

  it("accepts only root-validated registry calls on the authority chain", () => {
    expect(accepts()).toBe(true)
    expect(accepts({ chainId: base.id })).toBe(false)
    expect(accepts({ chainId: 10 })).toBe(false)
    expect(accepts({ nonce: permissionValidationNonce })).toBe(false)
  })

  it("rejects relayed, mixed, and oversized batches", () => {
    const revokeBySig = encodeFunctionData({
      abi: registryAbi,
      args: [sender, zeroHash, "0x"],
      functionName: "revokeBySig"
    })
    expect(
      accepts({
        callData: encodeErc7579ExecuteBatch([
          {
            data: revokeBySig,
            target: sliceIdAuthorizationRevocationRegistryAddress
          }
        ])
      })
    ).toBe(false)
    expect(
      accepts({
        callData: encodeErc7579ExecuteBatch([
          {
            data: revokeData,
            target: sliceIdAuthorizationRevocationRegistryAddress
          },
          { data: "0x", target: arbitraryTargetAddress }
        ])
      })
    ).toBe(false)
    expect(
      accepts({
        callData: encodeErc7579ExecuteBatch(
          Array.from({ length: 11 }, () => ({
            data: revokeData,
            target: sliceIdAuthorizationRevocationRegistryAddress
          }))
        )
      })
    ).toBe(false)
  })
})
