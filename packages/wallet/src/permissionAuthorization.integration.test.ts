import { describe, expect, it } from "bun:test"
import { buildRecoveryPermissionInitConfig } from "@slicekit/wallet-primitives"
import {
  decodeSliceWalletWebAuthnAssertion,
  predictSliceWalletKernelAccountAddress,
  sliceWalletKernelAddresses,
  verifySliceWalletRootAuthorization
} from "@slicekit/wallet-primitives/server"
import {
  type Address,
  bytesToBigInt,
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeErrorResult,
  type Hex,
  hexToBytes,
  RpcRequestError
} from "viem"
import { base } from "viem/chains"
import {
  encodeSliceWalletSyntheticWebAuthnSignature,
  generateSliceWalletP256KeyPair
} from "./p256"
import { createSliceWalletRegisteredKernelAccount } from "./rootValidator"

const account = "0x7100000000000000000000000000000000000001" as Address
const credentialIdHash = `0x${"11".repeat(32)}` as Hex
const challenge = `0x${"22".repeat(32)}` as Hex
const p256Order =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n

const createInstalledRootClient = (publicKey: Hex) => {
  const bytes = hexToBytes(publicKey)
  const x = bytesToBigInt(bytes.slice(1, 33))
  const y = bytesToBigInt(bytes.slice(33, 65))
  return createPublicClient({
    chain: base,
    transport: custom({
      request: async ({ method, params }) => {
        if (method === "eth_getCode") return "0x01"
        if (method === "eth_call") {
          const call = params[0]
          const controlsRequestedAccount = call.data
            ?.toLowerCase()
            .endsWith(account.slice(2).toLowerCase())
          return encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            controlsRequestedAccount ? [x, y] : [0n, 0n]
          )
        }
        throw new Error(`Unexpected RPC method: ${method}`)
      }
    })
  })
}

describe("Slice Wallet root authorization", () => {
  it("accepts the installed WebAuthn root and rejects substituted bindings", async () => {
    const key = await generateSliceWalletP256KeyPair()
    const client = createInstalledRootClient(key.publicKeyHex)
    const authorizationSignature =
      await encodeSliceWalletSyntheticWebAuthnSignature({
        chainId: base.id,
        challenge,
        key: key.privateKey,
        origin: "https://id.slice.so",
        rpId: "id.slice.so"
      })
    const input = {
      account,
      accountIndex: 0,
      authorizationSignature,
      chainId: base.id,
      challenge,
      client,
      idOrigin: "https://id.slice.so",
      rootCredential: {
        credentialIdHash,
        publicKey: key.publicKeyHex
      }
    } as const
    await expect(verifySliceWalletRootAuthorization(input)).resolves.toBe(true)
    await expect(
      verifySliceWalletRootAuthorization({
        ...input,
        challenge: `0x${"33".repeat(32)}`
      })
    ).resolves.toBe(false)
    await expect(
      verifySliceWalletRootAuthorization({
        ...input,
        idOrigin: "https://wrong.slice.so"
      })
    ).resolves.toBe(false)
    await expect(
      verifySliceWalletRootAuthorization({
        ...input,
        account: "0x7100000000000000000000000000000000000002"
      })
    ).rejects.toThrow("current root")

    const substituted = await generateSliceWalletP256KeyPair()
    await expect(
      verifySliceWalletRootAuthorization({
        ...input,
        rootCredential: {
          credentialIdHash,
          publicKey: substituted.publicKeyHex
        }
      })
    ).rejects.toThrow("current root")
  })

  it("accepts a canonical counterfactual root and rejects the wrong account", async () => {
    const key = await generateSliceWalletP256KeyPair()
    const rootCredential = {
      credentialIdHash,
      publicKey: key.publicKeyHex
    }
    const recoverySignerAddress =
      "0x7200000000000000000000000000000000000002" as Address
    const predictedAccount = await predictSliceWalletKernelAccountAddress({
      chainId: base.id,
      credential: rootCredential,
      index: 2n,
      recoverySignerAddress
    })
    const client = createPublicClient({
      chain: base,
      transport: custom({
        request: async ({ method }) => {
          if (method === "eth_getCode") return "0x"
          if (method === "eth_call") {
            const data = encodeErrorResult({
              abi: [
                {
                  inputs: [{ name: "sender", type: "address" }],
                  name: "SenderAddressResult",
                  type: "error"
                }
              ],
              args: [predictedAccount],
              errorName: "SenderAddressResult"
            })
            throw new RpcRequestError({
              body: {},
              error: { code: -32_003, data, message: "execution reverted" },
              url: "http://127.0.0.1"
            })
          }
          throw new Error(`Unexpected RPC method: ${method}`)
        }
      })
    })
    const recovery = await buildRecoveryPermissionInitConfig({
      client,
      recoverySignerAddress
    })
    const counterfactual = await createSliceWalletRegisteredKernelAccount({
      address: predictedAccount,
      chainId: base.id,
      client,
      credential: rootCredential,
      index: 2n,
      initConfig: recovery.initConfig
    })
    const factoryArgs = await counterfactual.getFactoryArgs()
    if (
      factoryArgs.factory === undefined ||
      factoryArgs.factoryData === undefined
    ) {
      throw new Error("Counterfactual factory arguments are missing.")
    }
    const authorizationSignature =
      await encodeSliceWalletSyntheticWebAuthnSignature({
        chainId: base.id,
        challenge,
        key: key.privateKey,
        origin: "https://id.slice.so",
        rpId: "id.slice.so"
      })
    const input = {
      account: predictedAccount,
      accountIndex: 2,
      accountFactory: factoryArgs.factory,
      accountFactoryData: factoryArgs.factoryData,
      authorizationSignature,
      chainId: base.id,
      challenge,
      client,
      idOrigin: "https://id.slice.so",
      rootCredential
    } as const

    await expect(verifySliceWalletRootAuthorization(input)).resolves.toBe(true)
    await expect(
      verifySliceWalletRootAuthorization({
        ...input,
        account: account
      })
    ).rejects.toThrow("derive")
  })

  it("rejects high-s WebAuthn assertions before cryptographic verification", async () => {
    const key = await generateSliceWalletP256KeyPair()
    const client = createInstalledRootClient(key.publicKeyHex)
    const encoded = await encodeSliceWalletSyntheticWebAuthnSignature({
      chainId: base.id,
      challenge,
      key: key.privateKey,
      origin: "https://id.slice.so",
      rpId: "id.slice.so"
    })
    const assertion = decodeSliceWalletWebAuthnAssertion(encoded)
    const highS = encodeAbiParameters(
      [
        { type: "bytes" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bool" }
      ],
      [
        assertion.authenticatorData,
        assertion.clientDataJSON,
        assertion.responseTypeLocation,
        assertion.r,
        p256Order - assertion.s,
        assertion.usePrecompiled
      ]
    )
    await expect(
      verifySliceWalletRootAuthorization({
        account,
        accountIndex: 0,
        authorizationSignature: highS,
        chainId: base.id,
        challenge,
        client,
        idOrigin: "https://id.slice.so",
        rootCredential: {
          credentialIdHash,
          publicKey: key.publicKeyHex
        }
      })
    ).resolves.toBe(false)
    expect(sliceWalletKernelAddresses.webAuthnRootValidator).toMatch(/^0x/)
  })
})
