#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sdk_wallet_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${sdk_wallet_dir}/../.." && pwd)"
contracts_wallet_dir="${repo_root}/packages/contracts/wallet"

if [[ -f "${repo_root}/.env" ]]; then
  set -a
  source "${repo_root}/.env"
  set +a
fi

if [[ -f "${sdk_wallet_dir}/.env" ]]; then
  set -a
  source "${sdk_wallet_dir}/.env"
  set +a
fi

if [[ -z "${RPC_URL_BASE:-}" ]]; then
  echo "RPC_URL_BASE is required to seed the local Kernel deployments." >&2
  exit 1
fi

rpc_port_a="${WALLET_E2E_RPC_PORT_A:-8555}"
rpc_port_b="${WALLET_E2E_RPC_PORT_B:-8556}"
bundler_port_a="${WALLET_E2E_BUNDLER_PORT_A:-4355}"
bundler_port_b="${WALLET_E2E_BUNDLER_PORT_B:-4356}"
rpc_url_a="http://127.0.0.1:${rpc_port_a}"
rpc_url_b="http://127.0.0.1:${rpc_port_b}"
bundler_url_a="http://127.0.0.1:${bundler_port_a}"
bundler_url_b="http://127.0.0.1:${bundler_port_b}"
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/slice-wallet-two-chain.XXXXXX")"
bundler_log_a="${log_dir}/alto-${bundler_port_a}.log"
bundler_log_b="${log_dir}/alto-${bundler_port_b}.log"
kernel_release_manifest_json="$(curl -fsSL \
  "https://raw.githubusercontent.com/zerodevapp/kernel/f2a84a332ec5a722e7e95a0d64601905c3c87fe9/releases/v0.4.0.json")"

anvil --chain-id 31337 --port "${rpc_port_a}" --silent &
anvil_pid_a="$!"
# Exercise a second provisioned deployment profile without weakening lookup.
anvil --chain-id 10 --port "${rpc_port_b}" --silent &
anvil_pid_b="$!"
bundler_pid_a=""
bundler_pid_b=""

cleanup() {
  kill "${bundler_pid_a}" >/dev/null 2>&1 || true
  kill "${bundler_pid_b}" >/dev/null 2>&1 || true
  kill "${anvil_pid_a}" >/dev/null 2>&1 || true
  kill "${anvil_pid_b}" >/dev/null 2>&1 || true
  rm -rf "${log_dir}"
}
trap cleanup EXIT

wait_for_rpc() {
  local url="$1"
  local label="$2"
  local log_file="${3:-}"
  for _ in {1..200}; do
    if curl -sS -X POST -H "content-type: application/json" \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
      "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "${label} did not become ready at ${url}." >&2
  if [[ -n "${log_file}" && -f "${log_file}" ]]; then
    tail -n 100 "${log_file}" >&2
  fi
  return 1
}

wait_for_rpc "${rpc_url_a}" "Anvil chain A"
wait_for_rpc "${rpc_url_b}" "Anvil chain B"

seed_chain() {
  local rpc_url="$1"
  (
    cd "${contracts_wallet_dir}"
    KERNEL_V4_RELEASE_MANIFEST_JSON="${kernel_release_manifest_json}" forge script \
      ./script/SeedKernel.s.sol:SeedKernelScript \
      --rpc-url "${rpc_url}" --broadcast --unlocked \
      --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
      --no-cache --no-storage-caching --slow -vv
  )
}

seed_chain "${rpc_url_a}"
seed_chain "${rpc_url_b}"

start_bundler() {
  local rpc_url="$1"
  local port="$2"
  local pid_variable="$3"
  local log_file="$4"
  bunx --no-install @pimlico/alto \
    --entrypoints 0x433709009B8330FDa32311DF1C2AFA402eD8D009 \
    --rpc-url "${rpc_url}" \
    --executor-private-keys 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
    --utility-private-key 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
    --safe-mode false --port "${port}" >"${log_file}" 2>&1 &
  printf -v "${pid_variable}" '%s' "$!"
}

start_bundler "${rpc_url_a}" "${bundler_port_a}" bundler_pid_a "${bundler_log_a}"
start_bundler "${rpc_url_b}" "${bundler_port_b}" bundler_pid_b "${bundler_log_b}"
wait_for_rpc "${bundler_url_a}" "Alto chain A" "${bundler_log_a}"
wait_for_rpc "${bundler_url_b}" "Alto chain B" "${bundler_log_b}"

cd "${sdk_wallet_dir}"
if ! bun --conditions=development scripts/two-chain-e2e.ts \
  "${rpc_url_a}" "${rpc_url_b}" "${bundler_url_a}" "${bundler_url_b}"; then
  echo "Two-chain wallet test failed. Bundler logs:" >&2
  tail -n 100 "${bundler_log_a}" "${bundler_log_b}" >&2
  exit 1
fi
