# Slice Wallet Contracts

Smart-account modules and local Kernel provisioning used by Slice Wallet.

## Contracts

- `WeightedECDSASigner`: combines a permission signer with a co-signer.
- `WeightedP256Signer`: combines a passkey-backed permission signer with a co-signer.
- `TimelockPolicy`: provides delayed, guardian-cancellable wallet recovery.
- `Erc6492BootstrapFactory`: decompresses pinned Kernel v4 deployment calldata
  during counterfactual signature verification.

The package also owns the pinned wallet deployment manifest and the scripts that deploy or seed wallet contracts for local development and staging forks.

## Production deployment

The six Slice-owned contracts use the canonical Foundry CREATE2 deployer, so
they have the same address on Ethereum, Optimism, Base, and Arbitrum. From the
repository root, one command builds them, deploys anything missing, verifies
the live runtime and explorer sources, updates `deployments/addresses.json`,
and regenerates the wallet chain manifest:

```bash
SLICEGLOBAL_INTERNAL_ALCHEMY_ID=... PRIVATE_KEY=0x... ETHERSCAN_API_KEY=... bun run deploy:wallet-contracts
```

The command is idempotent and never redeploys the upstream EntryPoint, Kernel,
or ZeroDev modules. Run `bash scripts/deploy-wallet-contracts.sh --dry-run`
from the repository root for a read-only address calculation.

`deployments/addresses.json` stores canonical contract addresses once. Each
supported chain records only its observed runtime hashes and verification
evidence; the deployment command updates both after all live checks pass.

## Development

```bash
forge soldeer install
forge build
forge test
```

From the repository root, `turbo dev` and `turbo staging` prepare this package before the local runtime starts. The runtime then runs the wallet seeding or deployment scripts against Anvil automatically.

## License

This repository is available under the [MIT License](./LICENSE).
