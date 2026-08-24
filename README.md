# Slice Wallet

The low-level TypeScript and Solidity implementation of the passkey-controlled Kernel v4 wallet.

## Packages

- [`@slicekit/wallet`](./packages/wallet) — Low-level Slice Wallet runtime for Kernel v4 passkey accounts, isolated signing ceremonies, policy-scoped execution, provider integration, and recovery
- [`contracts`](./packages/contracts) — Slice-owned Kernel policies, weighted P-256 signer, authorization revocation registry, and ERC-6492 bootstrap factory, with Foundry tests, deployment scripts, and the canonical address manifest.

## Scope

This repository owns the low-level wallet runtime and its onchain
enforcement modules. It does not own application identity, authentication, or
the Wagmi connector.

See the [Wallet package](./packages/wallet/README.md) and
[contracts](./packages/contracts/README.md) READMEs for APIs, security
boundaries, deployment facts, and package-specific development guidance.

## Application integration

Install `@slicekit/wallet` directly when building a wallet host, signer or
recovery surface, custom EIP-1193/Viem integration, or wallet infrastructure.

## Development

```bash
bun install
bun run build
bun run type-check
bun run test

cd packages/contracts
forge soldeer install
forge build
forge test
```

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](./LICENSE-APACHE))
- MIT license ([LICENSE-MIT](./LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
