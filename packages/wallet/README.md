# `@slicekit/wallet`

The low-level Slice Wallet implementation. It constructs and operates
passkey-controlled Kernel v4 smart accounts, implements the trusted signing and
signer-frame protocols, routes policy-scoped execution, exposes a portable
EIP-1193/EIP-5792 provider, and implements wallet recovery.

> [!WARNING]
> `@slicekit/wallet` is in beta and has not been audited. Do not use it in
> production or to secure funds you cannot afford to lose. Expect breaking
> changes before a stable release.

## Package scope

`@slicekit/wallet` owns the full low-level Wallet domain:

- runtime-neutral account, permission, policy, deployment-profile, chain,
  Kernel encoding, hashing, recovery, and execution-admission behavior;
- Kernel v4 smart-account construction and client transports;
- WebAuthn root, device, permission, recovery, and signer-frame ceremonies;
- non-extractable browser P-256 session keys and permission execution;
- the framework-neutral EIP-1193/EIP-5792 provider and low-level permission
  actions;
- checkout, store-management, bundler, paymaster, and recovery execution
  clients used by Slice-owned surfaces; and
- wallet credential-registry clients, proofs, and server-side account
  reconstruction helpers.

It deliberately does not own:

- Wagmi connectors, Wagmi permission actions, application authentication,
  delegated API sessions, or identity UI;
- Solidity modules and deployment facts — those live in the sibling
  [`contracts`](https://github.com/slice-so/wallet/tree/main/packages/contracts)
  project.

Install this package directly when building a wallet host, signer surface,
recovery surface, custom provider/Viem integration, or wallet infrastructure.

## Installation

```bash
npm install @slicekit/wallet
```

## Security Boundary

- Root passkey operations run only in a visible trusted ceremony.
- Promptless session keys are non-extractable P-256 `CryptoKey` objects owned by the origin-isolated signer frame.
- Parent applications receive public metadata and signatures, never private-key bytes.
- Delegated calls are checked against the same canonical policy descriptor in the ceremony, frame, SDK, and onchain permission.
- Unsupported or opaque calls stay root-confirmed.
- General ERC-8128 API sessions use a separate server-held EOA and receive no onchain wallet authority.
- The account ceremony can exchange one opaque extension value. The host owns
  preparation, parsing, binding, completion, and persistence of any
  [ERC-8128](https://github.com/slice-so/erc8128) session; Wallet does not
  understand authentication claims or delegations.

## Entry Points

- `@slicekit/wallet`: account and credential construction, ceremony clients,
  signer-frame clients, P-256 keys, recovery secret formats, and wallet types.
- `@slicekit/wallet/protocol`: runtime-neutral protocol values, chain
  manifests, account prediction, permissions, authorization, factory
  validation, recovery values, and shared types.
- `@slicekit/wallet/kernel`: Kernel v4 ABIs, constants, deployment profiles,
  nonce and permission encoding, factory derivation, and typed data.
- `@slicekit/wallet/policy`: canonical permission descriptors, hashes,
  serialization, validation, and call matching.
- `@slicekit/wallet/provider`: the portable EIP-1193/EIP-5792 provider,
  canonical configuration, errors, and provider protocol.
- `@slicekit/wallet/permissions`: generic permission request builders,
  EIP-1193 actions, and the Viem wallet-client extension.
- `@slicekit/wallet/frame`: the isolated signer-frame controller, wire
  protocol, and session store.
- `@slicekit/wallet/execution`: Kernel account clients and transports plus
  runtime-neutral admission policies and low-level checkout, management,
  bundler, and paymaster execution helpers.
- `@slicekit/wallet/recovery`: timelock proposal, cancellation, and root
  rotation operations.
- `@slicekit/wallet/server`: server-safe account reconstruction, wallet
  credential classification, registry proof, device, root, and recovery
  helpers plus the protocol server surface. It is not an application request
  verifier.
- `@slicekit/wallet/argon2id`: the Argon2id implementation used to decrypt or
  create advanced recovery bundles without loading it into the default entry
  point.
- `@slicekit/wallet/ceremony-routes`: the canonical embedded-dialog and
  broker-required ceremony route sets.

Server and infrastructure consumers should import only the explicit
`/protocol`, `/kernel`, `/policy`, `/execution`, or `/server` entry point they
need. The package root is the client/account surface and is not an umbrella
barrel for server runtimes.

Bundler and paymaster helpers receive fully resolved upstream URLs. Wallet does
not select or authenticate hosted providers. A host that supports token-funded
sponsorship may pass that provider's approval addresses through
`acceptedTokenApprovalSpenders`; Wallet treats those addresses as auxiliary
approval targets only when the same operation also contains an accepted Slice
intent.

## Provider

Use `createSliceWalletProvider()` from `@slicekit/wallet/provider`. The canonical factory fixes the identity origin and all account security metadata; applications may select admitted chains and override only RPC and bundler transports. A request may supply its own ERC-7677 paymaster URL and canonical JSON-compatible context. Applications using Wagmi can adapt this public provider through a custom connector.

The provider exposes root-confirmed account, signature, and call methods plus Slice's versioned session-permission methods. Slice does not advertise ERC-7710 or ERC-7715 compatibility. Calls that do not match an active Slice permission are sent through the visible root ceremony.

The canonical wallet is admitted on Ethereum, OP Mainnet, Base, and Arbitrum One, with Base as the default chain. Wallet contract addresses and the resulting counterfactual account address are consistent across chains. Slice commerce contracts and policies are Base-only.

The public provider remains a beta surface until the signer contract audit, Base deployment canary, real-browser bridge matrix, API security review, and external-origin rollout gate are complete.

## Deployment profiles

The retained `factoryVersion` field is a deployment-profile selector, not only a Kernel version label. The current immutable profile is `slice-kernel-v4-ep09-r1`: Kernel `0.4.0` behind its pinned ERC-1967 proxy and factory, EntryPoint `0.9`, and the current WebAuthn root validator. Only the exact profile ID is accepted; raw Kernel version labels and unknown values are rejected.

Profiles are immutable. A future deployment is added under a new profile ID and new manifest facts; it does not edit r1 or reinterpret a persisted credential. New credentials and recovery bundles store the canonical profile ID. Fixed-format recovery codes have no selector field and therefore default to the current profile; this is defaulting, not alias resolution.

Recovery restores WebAuthn root authority through the existing timelocked uninstall/install lifecycle. It does not authorize account self-calls, arbitrary module administration, or implementation upgrades. Any future implementation upgrade requires a separate root-authorized ceremony and an independently audited, code-hash-pinned admission target.

`createSliceKernelPasskeyAccount` intentionally remains a current-profile convenience surface for `SliceAccountClient`. Durable credential reconstruction uses the registered-account APIs and passes the persisted `factoryVersion` selector explicitly.

## Generic app permissions

Any HTTPS application can request a generic permission. Loopback HTTP origins are accepted for local development. Integration requires no Slice app registration, API key, app ID, or domain approval; the wallet host handles the visible consent ceremony and metadata persistence.

The application supplies one to 16 rules built from four templates:

- native transfer;
- ERC-20 `transfer`;
- ERC-20 `approve`;
- ERC-20 `transferFrom`.

Every grant has one shared UserOperation rate limit (`count` 1–100 and `intervalSec` from 60 seconds through the grant lifetime) and expires within 30 days. The counter counts delegated UserOperations, not inner calls. One-use access is `count: 1` with an interval equal to the requested lifetime. The wallet keeps one active grant for each exact origin, account, and chain; rotation replaces that grant and revocation disables it onchain.

The browser key is a non-extractable P-256 key isolated by exact origin, account, chain, and grant kind. Generic execution requires its signature plus the standard Kernel-compatible Call, Timestamp, and Rate Limit policies. The Call Policy validates every leg of an atomic batch against the granted rules; value and amount limits apply per inner call, while the rate limit counts the batch as one UserOperation. The consent ceremony displays the canonical origin, chain, expiry, raw target/token and recipient/spender addresses, maximum amount, operation, and rate. The app never supplies a signer, permission ID, policy hash, enable signature, or UserOperation. Registry metadata is not execution authority, so an already installed, locally hydrated grant remains usable through an auth-registry outage.

### Capability discovery and errors

`wallet_getCapabilities` returns a namespaced `slicePermissions` capability for each supported chain:

```ts
{
  slicePermissions: {
    version: "1",
    supportedTemplates: [
      "native-transfer",
      "erc20-transfer",
      "erc20-approve",
      "erc20-transfer-from"
    ]
  }
}
```

This is separate from the `atomic` EIP-5792 capability. A wallet may support EIP-5792 without supporting Slice permissions or promptless execution. The typed actions check `slicePermissions` and throw `SliceWalletPermissionUnsupportedWalletError` with code `SLICE_PERMISSIONS_UNSUPPORTED` when it is absent, including when the wallet does not implement capability discovery. Provider errors otherwise retain their numeric EIP-1193/Slice codes, including `-32602` for invalid input, `4100` for a disconnected account, `4200` for an unsupported method, and `4901`/`4902` for chain errors.

### EIP-1193

```ts
import type { Address } from "viem"
import {
  createSliceWalletPermissionRequest,
  grantPermissions,
  nativeTransferPermission
} from "@slicekit/wallet/permissions"
import { createSliceWalletProvider } from "@slicekit/wallet/provider"

const provider = createSliceWalletProvider({ chainIds: [8453] })
const [account] = (await provider.request({
  method: "eth_requestAccounts"
})) as [Address]

const request = createSliceWalletPermissionRequest({
  expiry: Math.floor(Date.now() / 1_000) + 3_600,
  rateLimit: { count: 5, intervalSec: 3_600 },
  rules: [
    nativeTransferPermission({
      maximumValue: 10_000_000_000_000_000n,
      recipient: "0x1111111111111111111111111111111111111111"
    })
  ]
})

const grant = await grantPermissions(provider, request)

const submitted = await provider.request({
  method: "wallet_sendCalls",
  params: [
    {
      version: "2.0.0",
      from: account,
      chainId: "0x2105",
      atomicRequired: true,
      calls: [
        {
          to: "0x1111111111111111111111111111111111111111",
          data: "0x",
          value: "0x2386f26fc10000"
        }
      ]
    }
  ]
})
```

The lifecycle methods behind the typed actions are `wallet_grantPermissions`, `wallet_getSessionPermissions`, `wallet_rotateSessionPermission`, and `wallet_revokeSessionPermission`. `grantPermissions` may also be requested as a versioned `wallet_connect` capability. A required failure aborts a new connection; `{ optional: true }` may connect without returning the capability. Reconnection only hydrates an existing exact match and never repeats consent or rotates a grant implicitly.

### Viem

```ts
import type { Address } from "viem"
import { createWalletClient, custom } from "viem"
import { base } from "viem/chains"
import {
  createSliceWalletPermissionRequest,
  erc20TransferPermission,
  sliceWalletPermissionActions
} from "@slicekit/wallet/permissions"
import { createSliceWalletProvider } from "@slicekit/wallet/provider"

const provider = createSliceWalletProvider({ chainIds: [base.id] })
const [account] = (await provider.request({
  method: "eth_requestAccounts"
})) as [Address]
const client = createWalletClient({
  account,
  chain: base,
  transport: custom(provider)
}).extend(sliceWalletPermissionActions)

await client.grantPermissions(
  createSliceWalletPermissionRequest({
    expiry: Math.floor(Date.now() / 1_000) + 86_400,
    rateLimit: { count: 10, intervalSec: 3_600 },
    rules: [
      erc20TransferPermission({
        token: "0x2222222222222222222222222222222222222222",
        recipient: "0x3333333333333333333333333333333333333333",
        maximumAmount: 1_000_000n
      })
    ]
  })
)

// Execution and status use Viem's standard EIP-5792 wallet actions.
const { id } = await client.sendCalls({
  calls: [
    {
      to: "0x2222222222222222222222222222222222222222",
      data: "0xa9059cbb000000000000000000000000333333333333333333333333333333333333333300000000000000000000000000000000000000000000000000000000000f4240"
    }
  ]
})
await client.getCallsStatus({ id })

const [current] = await client.getPermissions()
if (current) {
  const rotated = await client.rotatePermission(current.permissionId)
  await client.revokePermission(rotated.permissionId)
}
```

## EIP-5792 execution semantics

EIP-5792 is only the call envelope and status protocol. Applications send the standard version `2.0.0` fields—`from`, `chainId`, `atomicRequired`, and `calls[{to,data,value}]`—through EIP-1193, Viem, or Wagmi. Slice Wallet selects the authority and constructs the Kernel UserOperation internally.

A non-empty request executes without another prompt only when every call matches an active generic descriptor. Matching multi-call requests execute as one atomic UserOperation and consume one rate-limit unit. An empty list is rejected. An unmatched target, selector, recipient, spender, value or amount, an expired grant, or a chain/rate mismatch uses the existing visible root-confirmation path. The wallet never decomposes a multi-call request into separately permissioned operations and never falls through to a checkout or management key.

Paymaster sponsorship is optional and does not change permission scope or validity. A request may use the standard paymaster capability with a canonical JSON-compatible context. Permission deadlines apply equally to self-funded and sponsored operations.

Slice commerce applications do not consume generic grants. Shop, Dashboard, API, and automation flows use their dedicated checkout, management, API, or automation authorities.

## Checkout, allowance, and reservations

Promptless Slice checkout is a separate 2-of-2 authority: the origin-bound browser P-256 key initiates and signs each operation, and the Slice co-signer signs only after independently validating the exact sender, origin, nonce mode, calls, live product prices, payment totals, USD allowance, gas bounds, and expiry. The co-sign challenge lasts at most 120 seconds, and the weighted onchain signer enforces the resulting `validUntil` deadline with or without a paymaster.

ERC-20 checkout uses one atomic, deterministic batch: a fresh aggregate approval for each checkout currency in deterministic token order, then exactly one canonical `ProductsModule.buy` or `ProductsModule.pay`. The frame and co-signer reject missing, duplicate, reordered, or under-approvals. Buffered approvals above the current live requirement are allowed, and their full authorized amounts are reserved against the USD permission. If approval fails or leaves insufficient allowance, settlement reverts.

Checkout allowances use canonical unsigned 128-bit micro-USD strings and either one grant-lifetime window or fixed half-open UTC daily windows. Pending variants sharing one full Kernel nonce reserve only the maximum still-viable quoted amount. A finalized successful inclusion confirms the included quote; a finalized reverted inclusion releases allowance but leaves the nonce consumed; only finalized proof that no variant was included releases the nonce for a new generation. Pending evidence remains fail-closed through RPC or finality outages.

## Recovery

Recovery secrets remain exclusively in the user-held recovery code or encrypted bundle. Recovery can rotate control after its timelock even when hosted wallet services and their databases are unavailable; it does not reverse confirmed transactions. After control is restored, the recovered root can revoke both generic and Slice service permissions onchain, and registry reconciliation records the resulting lifecycle state when services return.

The recovery application is designed to be downloaded as a reproducible,
checksummed release artifact and served from localhost without `id.slice.so`.
The locally served artifact is the preferred recovery surface because a hosted
copy can access decrypted recovery material. Production releases that change
the root ceremony, signer frame, co-signer, or recovery application require
independent two-person approval.
