# MetaMask Snaps Directory submission checklist

This snap uses `snap_getBip44Entropy` (coinType `60`), so it requires:

1) publishing to npm, and
2) allowlisting by the MetaMask Snaps team (including a third‑party audit for key-management APIs).

## Key fields

- **Snap name (manifest `proposedName`)**: `EIP-5630 ECDH`
- **npm package name**: `eip5630-snap`
- **Snap ID**: `npm:eip5630-snap`
- **Version**: `0.1.0` (must match `package.json` and `snap.manifest.json`)
- **Source repo**: `https://github.com/pierce403/ddrp` (directory: `snaps/ddrp-snap`)
- **Website**: `https://ddrp.io/#/snap`

## Descriptions (copy/paste)

**Short description**

Implements the draft ERC-5630 wallet encryption RPC methods (`eth_getEncryptionPublicKey`, `eth_performECDH`) via MetaMask Snaps.

**Long description**

This Snap exposes EIP-5630-style encryption/decryption helpers to any dapp via `wallet_invokeSnap`:

- `eth_getEncryptionPublicKey(account)` returns the compressed secp256k1 public key for an Ethereum account.
- `eth_performECDH(account, ephemeralKey)` returns the 32-byte ECDH shared secret x-coordinate.

The snap requests `snap_getBip44Entropy` (coinType `60`) to derive MetaMask HD account keys and shows an explicit confirmation
dialog on every request (including the requesting origin). Only approve requests from sites you trust.

## Permissions

- `snap_dialog` (open permission)
- `snap_getBip44Entropy` (protected permission; audit required)

## Before submitting

- Publish to npm (see MetaMask docs: “Publish a Snap”).
- Publishing options:
  - Local: `cd snaps/ddrp-snap && npm adduser` then `npm publish --access public`
  - GitHub Actions: set repo secret `NPM_TOKEN`, then push a tag like `snap-v0.1.0` (workflow: `publish-snap.yml`)
- Run a security scan with Snapper and address findings.
- Obtain a third‑party audit from an approved auditor (required for `snap_getBip44Entropy`).
- Ensure there are no `console.*` logs, TODOs, or unused permissions.
