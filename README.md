# ddrp.io — DeadDrop Protocol (DDRP)

Tiny demo dapp: a sender posts an **encrypted message drop** for a recipient EOA, and recipients can **discover + decrypt** drops.

The UX is intentionally “nudgy” toward **ERC-5630**: wallet-assisted **secp256k1 ECDH** so dapps can do encryption/decryption without ever seeing private keys.

## What’s in this repo

- `contracts/DeadDropRegistry.sol`: simple on-chain registry (storage + event + range reads).
- `src/`: React + TypeScript frontend (Vite, hash routing for GitHub Pages).
- `TODO.md`: tracked work + next steps.
- `AGENTS.md`: lessons learned, decisions, pitfalls.

## How DDRP v1 works (message-only)

**Capsule v1 (bytes)**

```
[ version:1 ][ ephPubKeyCompressed:33 ][ salt:16 ][ nonce:24 ][ ciphertext+tag:* ]
```

Encryption:
- Sender generates an **ephemeral secp256k1 keypair**
- Performs **ECDH** with recipient secp256k1 pubkey
- `HKDF-SHA256(sharedSecretX, salt)` → 32-byte key
- **XChaCha20-Poly1305** encrypts the UTF-8 message

Decryption supports multiple methods **without changing capsule format**:
- **Wallet ECDH (ERC-5630)**: calls `eth_performECDH` to get the shared secret without exposing keys (not widely supported yet)
- **Manual decrypt (unsafe)**: paste a raw private key (dev-only fallback; big warnings in UI)
- **Snap placeholder**: UI stub for future MetaMask Snap integration

## Important limitation (v1, by design)

**Ethereum address ≠ public key.**

To encrypt to a recipient address in v1, the dapp tries to **recover the recipient’s secp256k1 public key** from their **latest outgoing transaction signature**.

If the recipient has **nonce=0** (no outgoing tx), the dapp can’t recover a pubkey and will show a helpful error explaining why this is hard — and why ERC-5630 matters.

## Local dev quickstart (Anvil)

Prereqs: `pnpm`, Foundry (`anvil`, `forge`).

1) Install deps

```bash
pnpm install
```

2) Start Anvil (terminal A)

```bash
anvil
```

3) Deploy the registry (terminal B)

```bash
pnpm contract:deploy:anvil
```

Copy the printed contract address.

4) Run the frontend (terminal B)

```bash
pnpm dev
```

5) In the UI

- Switch chain to **Anvil (31337)**
- Paste the deployed contract address into **Registry (this chain)** and click **Save**
- Connect a wallet (one of Anvil’s default accounts)

To create a drop to a local recipient:
- The recipient must have at least one outgoing tx (nonce > 0). On Anvil, you can “prime” an account by sending any tx from it (even a 0 ETH transfer).
- Then “Create Drop” will recover their pubkey by scanning recent blocks and encrypt to it.

To decrypt:
- Open the drop detail page and use **Manual decrypt (unsafe)** with the recipient private key (dev-only).
- Or try **Decrypt with wallet** (ERC-5630): most wallets will show “not supported”.

## MetaMask Snap (ERC-5630 helper)

DDRP includes an ERC-5630-style Snap and an in-app installer/playground at `/#/snap` (and a “Decrypt with snap” path on
drop pages).

This snap is intentionally **generic**: it implements the draft ERC-5630 RPC methods
`eth_getEncryptionPublicKey` and `eth_performECDH` (exposed via `wallet_invokeSnap`).

Snap ID (once published/allowlisted): `npm:erc5630-snap`

Important:
- The snap requests `snap_getBip44Entropy` (coinType `60`) to derive the signing key for **MetaMask HD accounts**
  (`m/44'/60'/0'/0/i`). Imported accounts and hardware wallets are not supported.
- This is a **high-privilege** permission. Only install/build from sources you trust.
- To appear in the MetaMask Snaps Directory, the snap must be published to npm and allowlisted (a third-party audit is
  required for key-management APIs like `snap_getBip44Entropy`).

Prereqs:
- MetaMask (Snaps-enabled). For development, MetaMask **Flask** is often required.

Run:

Terminal A (snap):
```bash
pnpm snap:watch
```

Terminal B (site):
```bash
pnpm dev
```

Then open `http://localhost:5173/#/snap`, click **Install / update**, and run the **ECDH round-trip demo**.

## GitHub Pages deploy

- Hash routing is enabled (`HashRouter`), so SPA refreshes won’t 404.
- `public/CNAME` is included for the custom domain `ddrp.io`.

If you use GitHub Actions Pages deploy, the build artifact is `dist/`.

## Security notes

- Security policy / vulnerability reporting: see `SECURITY.md`.
- Manual private-key entry is intentionally labeled unsafe. Do not paste real keys.
- Decrypted plaintext is stored in `localStorage` (client-side) so you can filter “decrypted locally” in the UI.
