import { PublicKey, WebAuthnP256 } from "ox"
import {
  type Address,
  bytesToBigInt,
  type Hex,
  hashTypedData,
  hexToBytes,
  isAddressEqual
} from "viem"
import { getCode, readContract } from "viem/actions"
import { assertSliceWalletAccountIndex } from "./accountIndex"
import { predictSliceWalletKernelAccountAddressFromInitConfig } from "./accountPrediction"
import { sliceWalletKernelAddresses } from "./constants"
import { assertSliceWalletFactoryArgs } from "./factoryValidation"
import { decodeSliceWalletWebAuthnAssertion } from "./p256Server"
import { buildSliceWalletPermissionEnableTypedData } from "./permission"
import type { SliceWalletRegisteredRootCredential } from "./types/account"
import type { SliceWalletFrameSession } from "./types/frame"
import type { BuildSliceWalletPermissionEnableTypedDataParameters } from "./types/permission"

const rootValidatorStorageAbi = [
  {
    inputs: [{ name: "kernel", type: "address" }],
    name: "webAuthnValidatorStorage",
    outputs: [
      { name: "pubKeyX", type: "uint256" },
      { name: "pubKeyY", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const

const p256Order =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n

const getRootPublicKeyCoordinates = (
  credential: SliceWalletRegisteredRootCredential
) => {
  const bytes = hexToBytes(credential.publicKey)
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("Root credential must use an uncompressed P-256 key.")
  }
  if (hexToBytes(credential.credentialIdHash).length !== 32) {
    throw new Error("Root credential id hash must be 32 bytes.")
  }
  return {
    x: bytesToBigInt(bytes.slice(1, 33)),
    y: bytesToBigInt(bytes.slice(33, 65))
  }
}

export const assertSliceWalletRootCredentialControlsAccount = async ({
  account,
  accountFactory,
  accountFactoryData,
  accountIndex,
  chainId,
  client,
  credential
}: {
  account: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  accountIndex: number
  chainId: number
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  credential: SliceWalletRegisteredRootCredential
}) => {
  const code = await getCode(client, { address: account })
  if (code === undefined || code === "0x") {
    if (accountFactory === undefined || accountFactoryData === undefined) {
      throw new Error(
        "Undeployed wallet root verification requires factory data."
      )
    }
    const factoryCredential = await assertSliceWalletFactoryArgs({
      chainId,
      client,
      factory: accountFactory,
      factoryData: accountFactoryData
    })
    if (
      factoryCredential.accountIndex !==
        assertSliceWalletAccountIndex(accountIndex) ||
      factoryCredential.credentialIdHash.toLowerCase() !==
        credential.credentialIdHash.toLowerCase() ||
      factoryCredential.publicKey.toLowerCase() !==
        credential.publicKey.toLowerCase()
    ) {
      throw new Error("Wallet factory data does not contain the claimed root.")
    }
    const derived = predictSliceWalletKernelAccountAddressFromInitConfig({
      chainId,
      credential,
      factoryVersion: factoryCredential.factoryVersion,
      index: BigInt(accountIndex),
      initConfig: factoryCredential.initConfig
    })
    if (!isAddressEqual(derived, account)) {
      throw new Error(
        "Wallet factory data does not derive the claimed account."
      )
    }
    return
  }

  const [x, y] = await readContract(client, {
    abi: rootValidatorStorageAbi,
    address: sliceWalletKernelAddresses.webAuthnRootValidator,
    args: [account],
    functionName: "webAuthnValidatorStorage"
  })
  const expected = getRootPublicKeyCoordinates(credential)
  if (x !== expected.x || y !== expected.y) {
    throw new Error("The claimed credential is not the wallet's current root.")
  }
}

export const verifySliceWalletPermissionAuthorization = async ({
  account,
  accountFactory,
  accountFactoryData,
  accountIndex,
  chainId,
  client,
  enableNonce,
  enableSignature,
  idOrigin,
  rootCredential,
  session
}: {
  account: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  accountIndex: number
  chainId: number
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  enableNonce: string
  enableSignature: Hex
  idOrigin: string
  rootCredential: SliceWalletRegisteredRootCredential
  session: SliceWalletFrameSession
}) => {
  const typedData = await buildSliceWalletPermissionEnableTypedData({
    address: account,
    client,
    enableNonce: BigInt(enableNonce),
    session
  })
  return verifySliceWalletRootAuthorization({
    account,
    ...(accountFactory === undefined ? {} : { accountFactory }),
    ...(accountFactoryData === undefined ? {} : { accountFactoryData }),
    accountIndex,
    authorizationSignature: enableSignature,
    chainId,
    challenge: hashTypedData(typedData as Parameters<typeof hashTypedData>[0]),
    client,
    idOrigin,
    rootCredential
  })
}

export const verifySliceWalletRootAuthorization = async ({
  account,
  accountFactory,
  accountFactoryData,
  accountIndex,
  authorizationSignature,
  chainId,
  challenge,
  client,
  idOrigin,
  rootCredential
}: {
  account: Address
  accountFactory?: Address
  accountFactoryData?: Hex
  accountIndex: number
  authorizationSignature: Hex
  chainId: number
  challenge: Hex
  client: BuildSliceWalletPermissionEnableTypedDataParameters["client"]
  idOrigin: string
  rootCredential: SliceWalletRegisteredRootCredential
}) => {
  await assertSliceWalletRootCredentialControlsAccount({
    account,
    ...(accountFactory === undefined ? {} : { accountFactory }),
    ...(accountFactoryData === undefined ? {} : { accountFactoryData }),
    accountIndex,
    chainId,
    client,
    credential: rootCredential
  })
  const assertion = decodeSliceWalletWebAuthnAssertion(authorizationSignature)
  const typeIndex = Number(assertion.responseTypeLocation)
  const expectedTypeIndex = assertion.clientDataJSON.indexOf(
    '"type":"webauthn.get"'
  )
  if (
    !Number.isSafeInteger(typeIndex) ||
    typeIndex !== expectedTypeIndex ||
    assertion.r <= 0n ||
    assertion.r >= p256Order ||
    assertion.s <= 0n ||
    assertion.s > p256Order / 2n
  ) {
    return false
  }
  const origin = new URL(idOrigin).origin
  return WebAuthnP256.verify({
    challenge,
    metadata: {
      authenticatorData: assertion.authenticatorData,
      challengeIndex: assertion.clientDataJSON.indexOf('"challenge"'),
      clientDataJSON: assertion.clientDataJSON,
      typeIndex,
      userVerificationRequired: true
    },
    origin,
    publicKey: PublicKey.fromHex(rootCredential.publicKey),
    rpId: new URL(origin).hostname,
    signature: { r: assertion.r, s: assertion.s }
  })
}
