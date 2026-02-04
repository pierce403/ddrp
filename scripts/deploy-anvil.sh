#!/usr/bin/env bash
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

# Anvil default account #0 private key (deterministic).
# Override with PRIVATE_KEY=... if you prefer.
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

set -o pipefail

forge build >/dev/null

forge create \
  --broadcast \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  contracts/DeadDropRegistry.sol:DeadDropRegistry \
  --json \
  | jq -r '.deployedTo'
