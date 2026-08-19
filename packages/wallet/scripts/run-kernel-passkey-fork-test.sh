#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wallet_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${wallet_dir}/../.." && pwd)"
contracts_wallet_dir="${repo_root}/packages/contracts/wallet"

if [[ -f "${repo_root}/.env" ]]; then
  set -a
  source "${repo_root}/.env"
  set +a
fi

if [[ -f "${wallet_dir}/.env" ]]; then
  set -a
  source "${wallet_dir}/.env"
  set +a
fi

if [[ -z "${RPC_URL_BASE:-}" ]]; then
  echo "RPC_URL_BASE is required." >&2
  exit 1
fi

fork_port="${BASE_FORK_PORT:-8547}"
fork_url="http://127.0.0.1:${fork_port}"
bundler_port="${BASE_FORK_BUNDLER_PORT:-4347}"
bundler_url="http://127.0.0.1:${bundler_port}"
fork_submitter_private_key="0x01$(openssl rand -hex 31)"
fork_submitter_address="$(cast wallet address --private-key "${fork_submitter_private_key}")"

(
  cd "${contracts_wallet_dir}"
  forge build src/signers/WeightedECDSASigner.sol
  forge build src/signers/WeightedP256Signer.sol
  forge build src/policies/TimelockPolicy.sol
  forge build src/policies/SlicerRegistryPolicy.sol
)

anvil --fork-url "${RPC_URL_BASE}" --port "${fork_port}" --silent &
anvil_pid="$!"
bundler_pid=""

cleanup() {
  kill "${bundler_pid}" >/dev/null 2>&1 || true
  kill "${anvil_pid}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_rpc() {
  local url="$1"
  for _ in {1..80}; do
    if curl -sS -X POST \
      -H "content-type: application/json" \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
      "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

if ! wait_for_rpc "${fork_url}"; then
  echo "Timed out waiting for anvil fork at ${fork_url}." >&2
  exit 1
fi

cast rpc \
  --rpc-url "${fork_url}" \
  anvil_setBalance \
  "${fork_submitter_address}" \
  0x56bc75e2d63100000 >/dev/null

# Local Alto so the fork test exercises eth_estimateUserOperationGas — the
# stub-signature path that direct handleOps calls never touch. Executor keys
# are anvil defaults (funded even in fork mode).
bunx --no-install @pimlico/alto \
  --entrypoints 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  --rpc-url "${fork_url}" \
  --executor-private-keys 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  --utility-private-key 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
  --safe-mode false \
  --port "${bundler_port}" >/dev/null 2>&1 &
bundler_pid="$!"

if ! wait_for_rpc "${bundler_url}"; then
  echo "Timed out waiting for alto bundler at ${bundler_url}." >&2
  exit 1
fi

cd "${wallet_dir}"
KERNEL_PASSKEY_FORK_RPC_URL="${fork_url}" \
  KERNEL_PASSKEY_FORK_BUNDLER_URL="${bundler_url}" \
  KERNEL_PASSKEY_FORK_SUBMITTER_PRIVATE_KEY="${fork_submitter_private_key}" \
  bun --conditions=development test \
  test/fork/kernelPasskey.fork.test.ts \
  "$@"
