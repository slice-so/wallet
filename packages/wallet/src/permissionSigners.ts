import {
  type SliceKernelModularSigner,
  sliceKernelWeightedP256SignerAddress,
  sliceWalletKernelAddresses
} from "@slicekit/wallet-primitives"
import { kernelDummyEcdsaSignature } from "@slicekit/wallet-primitives/kernel"
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
import { toAccount } from "viem/accounts"
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

const toEmptySignerAccount = (address: Address) =>
  toAccount({
    address,
    async signMessage() {
      throw new Error("The Slice signer frame must provide this signature.")
    },
    async signTransaction() {
      throw new Error("A modular signer does not sign transactions.")
    },
    async signTypedData() {
      throw new Error("The Slice signer frame must provide this signature.")
    }
  })

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
  kernelDummyEcdsaSignature,
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
}): SliceKernelModularSigner => ({
  account: toEmptySignerAccount(signerId),
  address: sliceKernelWeightedP256SignerAddress,
  data: encodeWeightedP256SignerData({ coSignerAddress, publicKey }),
  stubSignature: weightedP256DummySignature
})

export const toSliceWalletWebAuthnSessionSigner = ({
  publicKey,
  signerId
}: {
  publicKey: Hex
  signerId: Address
}): SliceKernelModularSigner =>
  toSliceWalletWebAuthnSigner({
    account: toEmptySignerAccount(signerId),
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
}): SliceKernelModularSigner => ({
  account,
  address: sliceWalletKernelAddresses.webAuthnSignerV004,
  data: encodeSliceWalletWebAuthnSignerData({ credentialIdHash, publicKey }),
  stubSignature: sliceWalletWebAuthnDummySignature
})

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
