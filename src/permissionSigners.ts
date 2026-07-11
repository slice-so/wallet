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
  toHex
} from "viem"
import { sliceWalletKernelAddresses } from "./constants"
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
  constants.DUMMY_ECDSA_SIG
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
  signerContractAddress: sliceWalletKernelAddresses.weightedP256Signer
})

export const toSliceWalletWebAuthnSessionSigner = ({
  publicKey,
  signerId
}: {
  publicKey: Hex
  signerId: Address
}): ModularSigner => {
  const { x, y } = getP256Coordinates(publicKey)
  return {
    account: addressToEmptyAccount(signerId),
    getDummySignature: () => sliceWalletWebAuthnDummySignature,
    getSignerData: () =>
      encodeAbiParameters(
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
        [{ pubKeyX: x, pubKeyY: y }, keccak256(publicKey)]
      ),
    signerContractAddress: sliceWalletKernelAddresses.webAuthnSignerV004
  }
}
