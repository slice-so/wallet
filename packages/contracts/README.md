# Slice Wallet Contracts

Smart-account modules and local Kernel provisioning used by Slice Wallet.

## Contracts

- `WeightedECDSASigner`: combines a permission signer with a co-signer.
- `WeightedP256Signer`: combines a passkey-backed permission signer with a co-signer.
- `TimelockPolicy`: provides delayed, guardian-cancellable wallet recovery.
- `Erc6492BootstrapFactory`: decompresses pinned Kernel v4 deployment calldata
  during counterfactual signature verification.

This directory also owns the pinned wallet deployment manifest and the Foundry
scripts that deploy or seed wallet contracts.

## Production deployment

The six Slice-owned contracts use the canonical Foundry CREATE2 deployer, so
they have the same address on Ethereum, Optimism, Base, and Arbitrum. The
deployment scripts are idempotent and do not deploy the upstream EntryPoint,
Kernel, or ZeroDev modules.

`deployments/addresses.json` stores canonical contract addresses once. Each
supported chain records only its observed runtime hashes and verification
evidence; the deployment command updates both after all live checks pass.

## Development

```bash
forge soldeer install
forge build
forge test
```

In the Slice monorepo, `turbo dev` and `turbo staging` prepare this directory
before the local runtime starts. The runtime then runs the wallet seeding or
deployment scripts against Anvil automatically.

## License

This repository is available under the [MIT License](./LICENSE).
