import { describe, expect, test } from "bun:test"
import {
  getSliceWalletChainManifest as getProtocolChainManifest,
  getWalletPolicyHash as getProtocolPolicyHash
} from "@slicekit/wallet-protocol"
import { isAcceptedSliceUserOperation as isProtocolUserOperationAccepted } from "@slicekit/wallet-protocol/execution"
import { serializeWalletPolicyDescriptor as serializeProtocolPolicy } from "@slicekit/wallet-protocol/policy"
import { getSliceWalletP256SignerId as getProtocolP256SignerId } from "@slicekit/wallet-protocol/server"
import { isAcceptedSliceUserOperation } from "./execution"
import { getSliceWalletChainManifest, getWalletPolicyHash } from "./index"
import { serializeWalletPolicyDescriptor } from "./policy"
import { getSliceWalletP256SignerId } from "./server"

describe("Wallet protocol compatibility exports", () => {
  test("keeps protocol APIs available from existing Wallet subpaths", () => {
    expect(getSliceWalletChainManifest).toBe(getProtocolChainManifest)
    expect(getWalletPolicyHash).toBe(getProtocolPolicyHash)
    expect(isAcceptedSliceUserOperation).toBe(isProtocolUserOperationAccepted)
    expect(serializeWalletPolicyDescriptor).toBe(serializeProtocolPolicy)
    expect(getSliceWalletP256SignerId).toBe(getProtocolP256SignerId)
  })
})
