import {
  type CreateWebAuthnCredentialReturnType,
  createWebAuthnCredential
} from "viem/account-abstraction"
import type { RegisterSliceKernelPasskeyCredentialParameters } from "../../types/accountClient"

type SliceBrowserCredential = {
  id: string
  type: string
}

type SliceBrowserCredentialsContainer = {
  get: (options: {
    publicKey: {
      challenge: Uint8Array
      rpId?: string
      userVerification: "preferred"
    }
  }) => Promise<SliceBrowserCredential | null>
}

type SliceBrowserCrypto = {
  getRandomValues: (array: Uint8Array) => Uint8Array
}

type SliceBrowserGlobal = typeof globalThis & {
  crypto?: SliceBrowserCrypto
  navigator?: {
    credentials?: SliceBrowserCredentialsContainer
  }
}

const getBrowserGlobals = () => globalThis as SliceBrowserGlobal

const getBrowserCredentials = () => {
  const credentials = getBrowserGlobals().navigator?.credentials
  if (credentials === undefined) {
    throw new Error("WebAuthn credentials are only available in the browser.")
  }
  return credentials
}

const getBrowserCrypto = () => {
  const crypto = getBrowserGlobals().crypto
  if (crypto === undefined) {
    throw new Error("WebAuthn credentials require Web Crypto support.")
  }
  return crypto
}

export const registerSliceKernelPasskeyCredential = async ({
  authenticatorSelection,
  excludeCredentialIds,
  name,
  rp,
  timeout
}: RegisterSliceKernelPasskeyCredentialParameters): Promise<CreateWebAuthnCredentialReturnType> => {
  getBrowserCredentials()
  getBrowserCrypto()

  return createWebAuthnCredential({
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "preferred",
      ...authenticatorSelection
    },
    name,
    ...(excludeCredentialIds !== undefined ? { excludeCredentialIds } : {}),
    ...(rp !== undefined ? { rp } : {}),
    ...(timeout !== undefined ? { timeout } : {})
  })
}

export const discoverSliceKernelPasskeyCredentialId = async ({
  rpId
}: {
  rpId?: string
} = {}) => {
  const credentials = getBrowserCredentials()
  const crypto = getBrowserCrypto()

  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)

  const credential = await credentials.get({
    publicKey: {
      challenge,
      ...(rpId === undefined ? {} : { rpId }),
      userVerification: "preferred"
    }
  })

  if (credential === null || credential.type !== "public-key") return null
  return credential.id
}
