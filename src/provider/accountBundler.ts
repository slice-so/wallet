import {
  type Chain,
  type Client,
  http,
  type JsonRpcAccount,
  type LocalAccount,
  type Transport
} from "viem"
import {
  createBundlerClient,
  createPaymasterClient,
  type SmartAccount
} from "viem/account-abstraction"
import type { SliceWalletRequestPaymasterService } from "../types/providerInternal"

export const createSliceWalletAccountBundler = ({
  account,
  bundlerUrl,
  chain,
  client,
  defaultPaymasterUrl,
  paymasterService,
  transportForUrl = http
}: {
  account: SmartAccount
  bundlerUrl: string
  chain: Chain
  client: Client<
    Transport,
    Chain | undefined,
    JsonRpcAccount | LocalAccount | undefined
  >
  defaultPaymasterUrl?: string
  paymasterService?: SliceWalletRequestPaymasterService
  transportForUrl?: (url: string) => Transport
}) => {
  const paymasterUrl = paymasterService?.url ?? defaultPaymasterUrl
  const paymasterClient =
    paymasterUrl === undefined
      ? undefined
      : createPaymasterClient({ transport: transportForUrl(paymasterUrl) })
  return createBundlerClient({
    account,
    chain,
    client,
    ...(paymasterClient === undefined ? {} : { paymaster: paymasterClient }),
    ...(paymasterService?.context === undefined
      ? {}
      : { paymasterContext: paymasterService.context.value }),
    transport: transportForUrl(bundlerUrl)
  })
}
