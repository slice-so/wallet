import {
  type CreateWebAuthnCredentialReturnType,
  createWebAuthnCredential
} from "viem/account-abstraction"
import { sliceWalletDefaultRpId } from "./constants"
import type { CreateSliceWalletPasskeyParameters } from "./types"

export const createSliceWalletPasskey = ({
  authenticatorSelection,
  excludeCredentialIds,
  name,
  rpName = "Slice Wallet",
  timeout
}: CreateSliceWalletPasskeyParameters): Promise<CreateWebAuthnCredentialReturnType> =>
  createWebAuthnCredential({
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "preferred",
      ...authenticatorSelection
    },
    ...(excludeCredentialIds === undefined ? {} : { excludeCredentialIds }),
    name,
    rp: { id: sliceWalletDefaultRpId, name: rpName },
    ...(timeout === undefined ? {} : { timeout })
  })
