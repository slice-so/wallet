# `@slicekit/wallet`

Portable Kernel wallet primitives for Slice and third-party applications, including account construction, signer-frame and ceremony clients, normalized commerce policies, recovery, React integration, EIP-1193/EIP-6963/EIP-5792 provider support, and a wagmi connector.

## Security Boundary

- Root passkey operations run only in a visible trusted ceremony.
- Promptless session keys are non-extractable P-256 `CryptoKey` objects owned by the origin-isolated signer frame.
- Parent applications receive public metadata and signatures, never private-key bytes.
- Delegated calls are checked against the same canonical policy descriptor in the ceremony, frame, SDK, and onchain permission.
- Unsupported or opaque calls stay root-confirmed.
- General ERC-8128 API sessions use a separate server-held EOA and receive no onchain wallet authority.

## Entry Points

- `@slicekit/wallet`: account, credential, ceremony, frame, registry, and recovery primitives.
- `@slicekit/wallet/execution`: Kernel passkey execution, commerce policies, bundler/paymaster handlers, and execution clients.
- `@slicekit/wallet/react`: the Slice wallet provider and account/session hooks.
- `@slicekit/wallet/frame`: the minimal signer-frame controller, protocol, session store, calls, and policy graph.
- `@slicekit/wallet/policy`: canonical generic policy descriptors and permission ids.
- `@slicekit/wallet/provider`: portable provider and EIP-6963 discovery.
- `@slicekit/wallet/wagmi`: wagmi connector.
- `@slicekit/wallet/recovery`: Timelock recovery operations. The root entry point also exports the primary password-manager recovery-code format and the advanced encrypted-file alternative.
- `@slicekit/wallet/server`: server-only P-256 verification and proposal helpers.

## Provider

Use `sliceWallet()` from `@slicekit/wallet/wagmi`, or `createSliceWalletProvider()` from `@slicekit/wallet/provider`. The canonical factory fixes the identity origin and all account security metadata; applications may select admitted chains and override only RPC and bundler transports. A request may supply its own ERC-7677 paymaster URL and canonical JSON-compatible context.

The provider exposes root-confirmed account, signature, and call methods plus Slice's versioned session-permission methods. Slice does not advertise ERC-7710 or ERC-7715 compatibility. Calls that do not match an active Slice permission are sent through the visible root ceremony.

The canonical wallet is admitted on Ethereum, OP Mainnet, Base, and Arbitrum One, with Base as the default chain. Wallet contract addresses and the resulting counterfactual account address are consistent across chains. Slice commerce contracts and policies are Base-only; admitting a wallet chain does not imply ProductsModule, checkout, pricing, indexing, co-signing, or Slice sponsorship support there.

The public provider remains a beta surface until the signer contract audit, Base deployment canary, real-browser bridge matrix, API security review, and external-origin rollout gate are complete.
