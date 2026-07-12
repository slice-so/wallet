import { describe, expect, it } from "bun:test"
import type { Address } from "viem"
import { createErc20TransferCallRule } from "../policy"
import type { SliceWalletProtocolValue } from "../types"
import { parseSliceWalletFrameRequest } from "./protocol"

const account = "0x1000000000000000000000000000000000000001" as Address
const recipient = "0x2000000000000000000000000000000000000002" as Address
const token = "0x3000000000000000000000000000000000000003" as Address

const request = {
  id: "request-1",
  method: "createSession",
  params: {
    policy: {
      account,
      calls: [
        createErc20TransferCallRule({
          maximumAmount: 100n,
          recipient,
          token
        })
      ],
      chainId: 8453,
      grantKind: "generic",
      validAfter: 100,
      validUntil: 200,
      version: 1
    }
  },
  version: 1
} as const satisfies SliceWalletProtocolValue

describe("signer-frame protocol parser", () => {
  it("accepts a canonical request", () => {
    expect(parseSliceWalletFrameRequest(request)).toMatchObject({
      id: "request-1",
      method: "createSession",
      version: 1
    })
  })

  it("rejects unknown top-level and nested policy fields", () => {
    expect(() =>
      parseSliceWalletFrameRequest({ ...request, publicKey: "0x1234" })
    ).toThrow("unknown field")
    expect(() =>
      parseSliceWalletFrameRequest({
        ...request,
        params: {
          policy: {
            ...request.params.policy,
            calls: [
              {
                ...request.params.policy.calls[0],
                callType: "delegatecall"
              }
            ]
          }
        }
      })
    ).toThrow("unknown field")
  })

  it("rejects parent-supplied signer identifiers", () => {
    expect(() =>
      parseSliceWalletFrameRequest({
        ...request,
        params: {
          ...request.params,
          signerId: account
        }
      })
    ).toThrow("unknown field")
  })

  it("accepts only the session key in signing requests", () => {
    const signingRequest = {
      id: "request-2",
      method: "signCheckoutProposal",
      params: {
        callData: "0x",
        nonce: 0n,
        sender: account,
        session: { account, chainId: 8453, grantKind: "checkout" }
      },
      version: 1
    } as const satisfies SliceWalletProtocolValue

    expect(parseSliceWalletFrameRequest(signingRequest)).toMatchObject({
      id: "request-2",
      method: "signCheckoutProposal"
    })
    expect(() =>
      parseSliceWalletFrameRequest({
        ...signingRequest,
        params: {
          ...signingRequest.params,
          session: { ...signingRequest.params.session, expiresAt: 200 }
        }
      })
    ).toThrow("unknown field")
  })
})
