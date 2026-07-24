import type { ModularSigner } from "@zerodev/permissions"
import { addressToEmptyAccount, constants } from "@zerodev/sdk"
import {
  type Address,
  bytesToBigInt,
  concat,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  type LocalAccount,
  toHex
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
import { sliceKernelWeightedP256SignerV2Address } from "./execution/utils/sliceKernelAddresses"
import { sliceWalletWebAuthnDummySignature } from "./rootValidator"

const getP256Coordinates = (publicKey: Hex) => {
  const bytes = hexToBytes(publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Expected an uncompressed P-256 session public key.")
  }
  return {
    x: bytesToBigInt(bytes.slice(1, 33)),
    y: bytesToBigInt(bytes.slice(33, 65))
  }
}

export const encodeWeightedP256SignerData = ({
  coSignerAddress,
  publicKey
}: {
  coSignerAddress: Address
  publicKey: Hex
}) => {
  const { x, y } = getP256Coordinates(publicKey)
  return encodeAbiParameters(
    [
      { name: "x", type: "uint256" },
      { name: "y", type: "uint256" },
      { name: "coSigner", type: "address" }
    ],
    [x, y, coSignerAddress]
  )
}

export const weightedP256DummySignature = concat([
  toHex(1n, { size: 32 }),
  toHex(1n, { size: 32 }),
  constants.DUMMY_ECDSA_SIG,
  toHex(1n, { size: 6 })
])

export const toWeightedP256Signer = ({
  coSignerAddress,
  publicKey,
  signerId
}: {
  coSignerAddress: Address
  publicKey: Hex
  signerId: Address
}): ModularSigner => ({
  account: addressToEmptyAccount(signerId),
  getDummySignature: () => weightedP256DummySignature,
  getSignerData: () =>
    encodeWeightedP256SignerData({ coSignerAddress, publicKey }),
  signerContractAddress: sliceKernelWeightedP256SignerV2Address
})

export const toSliceWalletWebAuthnSessionSigner = ({
  publicKey,
  signerId
}: {
  publicKey: Hex
  signerId: Address
}): ModularSigner =>
  toSliceWalletWebAuthnSigner({
    account: addressToEmptyAccount(signerId),
    credentialIdHash: keccak256(publicKey),
    publicKey
  })

export const toSliceWalletWebAuthnSigner = ({
  account,
  credentialIdHash,
  publicKey
}: {
  account: LocalAccount
  credentialIdHash: Hex
  publicKey: Hex
}): ModularSigner => {
  return {
    account,
    getDummySignature: () => sliceWalletWebAuthnDummySignature,
    getSignerData: () =>
      encodeSliceWalletWebAuthnSignerData({ credentialIdHash, publicKey }),
    signerContractAddress: sliceWalletKernelAddresses.webAuthnSignerV004
  }
}

export const encodeSliceWalletWebAuthnSignerData = ({
  credentialIdHash,
  publicKey
}: {
  credentialIdHash: Hex
  publicKey: Hex
}) => {
  const { x, y } = getP256Coordinates(publicKey)
  if (hexToBytes(credentialIdHash).length !== 32) {
    throw new Error("WebAuthn credential id hash must be 32 bytes.")
  }
  return encodeAbiParameters(
    [
      {
        components: [
          { name: "pubKeyX", type: "uint256" },
          { name: "pubKeyY", type: "uint256" }
        ],
        name: "WebAuthnSignerData",
        type: "tuple"
      },
      { name: "authenticatorIdHash", type: "bytes32" }
    ],
    [{ pubKeyX: x, pubKeyY: y }, credentialIdHash]
  )
}
