import { afterEach, describe, expect, it } from "bun:test"
import { discoverSliceKernelPasskeyCredentialId } from "./credential"

const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator"
)
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto")

const restoreGlobal = (
  name: "crypto" | "navigator",
  descriptor: PropertyDescriptor | undefined
) => {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor)
    return
  }
  Reflect.deleteProperty(globalThis, name)
}

afterEach(() => {
  restoreGlobal("navigator", originalNavigator)
  restoreGlobal("crypto", originalCrypto)
})

describe("Slice passkey discovery", () => {
  it("uses the explicit relying-party id for cross-subdomain credentials", async () => {
    let requestedRpId: string | undefined
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          get: async ({ publicKey }: { publicKey: { rpId?: string } }) => {
            requestedRpId = publicKey.rpId
            return null
          }
        }
      }
    })
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (array: Uint8Array) => {
          array.fill(1)
          return array
        }
      }
    })

    const credentialId = await discoverSliceKernelPasskeyCredentialId({
      rpId: "slice.so"
    })

    expect(credentialId).toBeNull()
    expect(requestedRpId).toBe("slice.so")
  })
})
