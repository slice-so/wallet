# Slice Wallet Contracts

The onchain enforcement layer of Slice Wallet. This Foundry project contains
the Slice-owned Kernel modules and registry, their deployment facts, and the
tests and scripts needed to reproduce them. It is maintained alongside
`@slicekit/wallet` in the public
[`slice-so/wallet`](https://github.com/slice-so/wallet) repository, but it is
not an npm workspace member or JavaScript package.

## Scope

This project owns five deployed contracts:

- `AuthorizationRevocationRegistry`: issuer-scoped revocation IDs and monotonic
  epochs for Slice ID's ERC-8128 delegation profile.
- `SlicerRegistryPolicy`: an additional Kernel policy that restricts dynamic
  store-management targets to canonical Slicer contracts and rejects role
  mutation paths.
- `TimelockPolicy`: delayed, guardian-cancellable recovery proposals and
  execution windows.
- `WeightedP256Signer`: fixed-role 2-of-2 checkout authority combining an
  origin-bound P-256 session key with Slice's ECDSA policy co-signer.
- `Erc6492BootstrapFactory`: decompression and forwarding of pinned Kernel v4
  deployment calldata during counterfactual signature verification.

The project also owns `deployments/addresses.json`, Foundry deployment and
local-seeding scripts, invariant/unit tests, and the pinned third-party
Solidity dependencies needed to build the contracts.

It does not own Kernel, EntryPoint, the WebAuthn root validator, or other
upstream account infrastructure. Slice Wallet pins those deployments and
runtime hashes in the manifest, while the source remains upstream.

## Upstream source pins

- Kernel v4 interfaces and constants are pinned to `zerodevapp/kernel` commit
  `f2a84a332ec5a722e7e95a0d64601905c3c87fe9`.
- ERC-4337 interfaces are pinned to the Account Abstraction 0.9 dependency at
  commit `86fcd84cf7263fe384d61d078ee747b16e69a496`, exactly as selected by that
  Kernel release.
- Policy and signer extension baselines are pinned to
  `zerodevapp/kernel-7579-plugins` commit
  `332deed6eeef3d6279cde50aa1d51eff53728bd4`.

Vendored files identify their upstream path and pin in the header. Exact copies
state that there are no source modifications; adapted files enumerate every
intentional deviation before the Solidity source.

## Relationship to the packages

`@slicekit/wallet` consumes `deployments/addresses.json` directly to generate
chain manifests, deployment profiles, and runtime admission facts used by its
protocol and client entry points. The JavaScript package does not duplicate
contract addresses or Solidity behavior.

Contract changes, manifest changes, generated chain facts, and the wallet
runtime therefore move through the same public repository and review history.

## Deployment facts

The five Slice-owned contracts use the canonical Foundry CREATE2 deployer, so
their addresses are chain-invariant across Ethereum, OP Mainnet, Base, and
Arbitrum One. Deployment scripts deploy only the selected missing Slice-owned
modules; they do not deploy upstream EntryPoint or Kernel infrastructure.

`deployments/addresses.json` stores canonical contract addresses once. Each
supported chain records only its observed runtime hashes and verification
evidence. A chain is admitted by the generated Wallet manifest only
when all authority-specific deployment evidence is complete.

## Development

From the public Wallet repository root:

```bash
forge soldeer install
forge build
forge test
```

Or run `forge soldeer install`, `forge build`, and `forge test` directly from
this directory. Foundry-generated `dependencies/`, `cache/`, `out/`, and
`broadcast/` directories are not exported by the repository sync.

## License

The Solidity project is available under the [MIT License](./LICENSE). The npm
packages at the repository root retain their Apache-2.0-or-MIT dual license.
