# ERC-5630 ECDH Snap

Implements the draft ERC-5630 JSON-RPC methods:

- `eth_getEncryptionPublicKey` → returns a compressed secp256k1 public key for a given Ethereum account.
- `eth_performECDH` → returns the 32-byte ECDH shared secret x-coordinate for a given account + ephemeral pubkey.

These methods are exposed to dapps via MetaMask Snaps (`wallet_invokeSnap`).

## Install

Once published, dapps can request this snap by Snap ID:

- `npm:erc5630-snap`

DDRP’s demo site has an install/playground UI:

- `https://ddrp.io/#/snap`

## Permissions

This snap uses:

- `endowment:rpc` (`dapps: true`, `snaps: false`) to expose snap RPC methods via `wallet_invokeSnap`
- `snap_dialog` (to show confirmations)
- `snap_getBip32Entropy` (secp256k1, path prefix `m/5630'/0'`) to derive deterministic per-account encryption keys

`snap_getBip32Entropy` is a **high-privilege** permission. Only install/build from sources you trust and only approve
requests from sites you trust.

## Why `m/5630'/0'`?

MetaMask now blocks deriving the Ethereum signing path (`m/44'/60'/...`) from snaps. This snap uses a dedicated
namespace (`m/5630'/0'/...`) for ERC-5630-style encryption keys.

This means:

- Keys are deterministic for the same wallet entropy + account input.
- Keys are snap-scoped and **not** the account transaction-signing key.
- Drops encrypted to recovered transaction pubkeys can fail snap decrypt with `invalid tag` (shared-secret mismatch).

## Limitations

- Derived keys are snap-scoped (from wallet entropy + account string) and are **not** the account signing key.
- If you restore a different wallet seed phrase, derived encryption keys change.
