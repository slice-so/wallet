# @slicekit/wallet

## 0.1.1
### Patch Changes



- [`1055fd7`](https://github.com/slice-so/monorepo/commit/1055fd7361470a978122954eaf209ecf4042a5b9) Thanks [@jacopo-eth](https://github.com/jacopo-eth)! - Remove the Wallet-owned Wagmi integration, consolidate the low-level Wallet protocol into Wallet, and require canonical Kernel deployment-profile identifiers.

## 0.1.0
### Minor Changes



- [`a8dbf83`](https://github.com/slice-so/monorepo/commit/a8dbf83de625cabb976d35c374c77e8938e94138) Thanks [@jacopo-eth](https://github.com/jacopo-eth)! - Upgrade Slice Wallet to Kernel v4 on EntryPoint v0.9 without ZeroDev SDKs.
  
  - `@slicekit/wallet-primitives`: new `@slicekit/wallet-primitives/kernel` entry
    owning the Kernel v4 ABIs and constants, deployment profiles
    (`slice-kernel-v4-ep09-r1`), factory/proxy address derivation, install-package,
    nonce and permission encoding, permission install state, and the
    `InstallPackages` typed data. Permission enable/revocation builders, account
    prediction, recovery init config, and factory validation now encode Kernel v4
    installs; `buildSliceWalletPermissionEnableTypedData` takes `enableNonce` and
    frame sessions/execution descriptors carry `enableNonce`. The
    `@zerodev/permissions` dependency is gone. Adds the ERC-7677 paymaster request
    parser and `sliceKernelConfig` to `@slicekit/wallet-primitives/execution`.
  - `@slicekit/wallet`: Kernel v4 `SmartAccount` implementation with ERC-7739
    signature wrapping and ERC-6492 bootstrap, weighted P-256 and WebAuthn
    modular signers, rewritten recovery/permission accounts, deployment-profile
    aware registration (`factoryVersion`), `allowCdpFallback` for the bundler,
    explicit paymaster upstreams, and no `@zerodev/*` dependencies. Protocol
    builders moved to `@slicekit/wallet-primitives` are no longer exported here.
- [`a8dbf83`](https://github.com/slice-so/monorepo/commit/a8dbf83de625cabb976d35c374c77e8938e94138) Thanks [@jacopo-eth](https://github.com/jacopo-eth)! - Shared-domain ownership refactor for the public Slice repositories.
  
  - `@slicekit/commerce` (new): the commerce domain model previously spread across
    the internal `@slicekit/common` package — types, value sets, pricing math and
    formatting policy, currency/country rules, order status rules, metadata
    schemas, protocol constants, and the product category taxonomy
    (`@slicekit/commerce/categories`).
  - `@slicekit/abi`: new `@slicekit/abi/deployments` entry with chain ids,
    commerce and hook deployment facts, token addresses, wagmi contract configs,
    and hook-manifest lookups generated from canonical JSON inputs.
  - `@slicekit/core`: domain types and helpers now come from `@slicekit/commerce`
    and contract configs from `@slicekit/abi/deployments`; the package no longer
    re-exports them. The API client resolves the Slice API base URL itself.
  - `@slicekit/react`: pagination types come from `@slicekit/commerce`.
  - `@slicekit/wallet-primitives` (renamed from `@slicekit/wallet-protocol`):
    adds app-permission, root/permission authorization, factory validation,
    execution grant, chain policy and allowance primitives.
  - `@slicekit/wallet`: no longer re-exports primitives; import them from
    `@slicekit/wallet-primitives`. The `./policy` subpath is removed.
  - `@slicekit/erc8128`: adds `assertErc8128PrivateKey`.

### Patch Changes

- Updated dependencies [[`711a498`](https://github.com/slice-so/monorepo/commit/711a498c2566732166a36d8b2e8371491d475143)]:
  - @slicekit/wallet-primitives@0.1.1

## 0.0.2
### Patch Changes

- Updated dependencies [[`ce26fc0`](https://github.com/slice-so/monorepo/commit/ce26fc084603fc18de759762673d1c7b2dd219c3)]:
  - @slicekit/abi@0.1.0
  - @slicekit/erc8128@0.4.1
  - @slicekit/wallet-primitives@0.1.0

## 0.0.1
### Patch Changes



- [#55](https://github.com/slice-so/monorepo/pull/55) [`60540a7`](https://github.com/slice-so/monorepo/commit/60540a71c1bb76493bce6c31697313fae2d89d95) Thanks [@jacopo-eth](https://github.com/jacopo-eth)! - Consolidate Slice wallet execution and React account-provider APIs under `@slicekit/wallet`.



- [#55](https://github.com/slice-so/monorepo/pull/55) [`d710fc9`](https://github.com/slice-so/monorepo/commit/d710fc90c907655eed78b04d039ad37a559ab3c1) Thanks [@jacopo-eth](https://github.com/jacopo-eth)! - Align delegated authentication with the final draft schema and deterministic
  CBOR vectors, including issuer-chain revocation batching, permission policy,
  single-use request requirements, and the clean-break local registry deployment.
- Updated dependencies [[`ec7b17f`](https://github.com/slice-so/monorepo/commit/ec7b17f3040bc98c615a4ec1ab5b5476b6df0227), [`f17a2de`](https://github.com/slice-so/monorepo/commit/f17a2de432c9ec0d3c456707ab04df62985b9e0d), [`e46cf70`](https://github.com/slice-so/monorepo/commit/e46cf7058d3538fd29bab42a126c7d14e1481810), [`d710fc9`](https://github.com/slice-so/monorepo/commit/d710fc90c907655eed78b04d039ad37a559ab3c1), [`a86b84b`](https://github.com/slice-so/monorepo/commit/a86b84b6e126ac1ac7a7625f8f8003c4c9c00397), [`803600b`](https://github.com/slice-so/monorepo/commit/803600b221897c501bed09f9eb565af72fe77e7b), [`60540a7`](https://github.com/slice-so/monorepo/commit/60540a71c1bb76493bce6c31697313fae2d89d95)]:
  - @slicekit/abi@0.0.24
  - @slicekit/erc8128@0.4.0
