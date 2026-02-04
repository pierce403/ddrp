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

- `snap_dialog` (to show confirmations)
- `snap_getBip44Entropy` (coinType `60`) to derive MetaMask HD account keys (`m/44'/60'/0'/0/i`)

`snap_getBip44Entropy` is a **high-privilege** permission. Only install/build from sources you trust and only approve
requests from sites you trust.

## Limitations

- Only supports MetaMask HD accounts derived under `m/44'/60'/0'/0/i` (scans the first N indices).
- Imported accounts and hardware wallets are not supported.
