#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wallet_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${wallet_dir}/../.." && pwd)"
contracts_wallet_dir="${repo_root}/packages/contracts/wallet"
contracts_dir="${repo_root}/packages/contracts"

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
fork_executor_private_key="0x02$(openssl rand -hex 31)"
fork_utility_private_key="0x03$(openssl rand -hex 31)"
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/slice-kernel-v4-fork.XXXXXX")"
kernel_release_manifest_json="$(curl -fsSL \
  "https://raw.githubusercontent.com/zerodevapp/kernel/f2a84a332ec5a722e7e95a0d64601905c3c87fe9/releases/v0.4.0.json")"

(
  cd "${contracts_wallet_dir}"
  forge build src/signers/WeightedECDSASigner.sol
  forge build src/signers/WeightedP256Signer.sol
  forge build src/policies/TimelockPolicy.sol
  forge build src/policies/SlicerRegistryPolicy.sol
)

anvil --fork-url "${RPC_URL_BASE}" --no-storage-caching --port "${fork_port}" --silent &
anvil_pid="$!"
bundler_pid=""

cleanup() {
  kill "${bundler_pid}" >/dev/null 2>&1 || true
  kill "${anvil_pid}" >/dev/null 2>&1 || true
  rm -rf "${log_dir}"
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

# The randomized submitter is not one of Anvil's pre-funded accounts.
cast rpc \
  --rpc-url "${fork_url}" \
  anvil_setBalance \
  "${fork_submitter_address}" \
  0x56bc75e2d63100000 >/dev/null

(
  cd "${contracts_wallet_dir}"
  # This node already contains Base state; avoid creating a nested Foundry fork
  # whose selected-fork and broadcast contexts can diverge under concurrency.
  SEED_KERNEL_FROM_ACTIVE_FORK=true \
    KERNEL_V4_RELEASE_MANIFEST_JSON="${kernel_release_manifest_json}" forge script \
    ./script/SeedKernel.s.sol:SeedKernelScript \
    --rpc-url "${fork_url}" --broadcast --unlocked \
    --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
    --no-cache --no-storage-caching --slow -vv
)

# Use fresh accounts because public Anvil accounts can have EIP-7702 code in
# forked state. EntryPoint v0.9 rejects a code-bearing bundler executor.
SLICE_LOCAL_BUNDLER_RPC_URL="${fork_url}" \
  SLICE_LOCAL_BUNDLER_PORT="${bundler_port}" \
  SLICE_LOCAL_BUNDLER_EXECUTOR_PRIVATE_KEY="${fork_executor_private_key}" \
  SLICE_LOCAL_BUNDLER_UTILITY_PRIVATE_KEY="${fork_utility_private_key}" \
  bash "${contracts_dir}/scripts/start-local-bundler.sh" \
  >"${log_dir}/alto.log" 2>&1 &
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
