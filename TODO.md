# TODO

Tracking for building **ddrp.io** (DeadDrop Protocol demo dapp).

## v1 — Core Demo

- [x] Scaffold Vite + React + TypeScript
  - Status: done (`pnpm dev`, `pnpm build`)
- [x] Hash routing for GitHub Pages
  - Status: done (`src/main.tsx`, `vite.config.ts`)
- [x] Smart contract: `DeadDropRegistry` (storage + event + paging)
  - Status: done (`contracts/DeadDropRegistry.sol`)
- [x] Foundry config + local deploy helper
  - Status: done (`foundry.toml`, `scripts/deploy-anvil.sh`, `pnpm contract:*`)
- [x] UI button: deploy a new registry contract
  - Status: done (`src/components/WalletBar.tsx`, `src/ddrp/registryBytecode.ts`)
- [x] Default mainnet registry address
  - Status: done (`src/ddrp/registry.ts`)
- [x] Capsule v1 crypto (secp256k1 ECDH + HKDF-SHA256 + XChaCha20-Poly1305)
  - Status: done (`src/ddrp/capsuleV1.ts`)
- [x] Recipient pubkey discovery (latest outgoing tx → pubkey recovery)
  - Status: done (Blockscout API for Sepolia/mainnet, block-scan for Anvil) (`src/ddrp/pubkeyDiscovery.ts`)
- [x] Home page: create drop + “Recent Drops (10)” table
  - Status: done (`src/pages/HomePage.tsx`)
- [x] Create Drop: recipient input preflight (checksum/ENS + pubkey-live badge)
  - Status: done (`src/pages/HomePage.tsx`)
- [x] All Drops page: paging + filters
  - Status: done (`src/pages/AllDropsPage.tsx`)
- [x] Drop detail page: metadata + capsule fields + multi-method decrypt UI
  - Status: done (EIP-5630 path + unsafe manual + Snap placeholder) (`src/pages/DropPage.tsx`)
- [x] GitHub Pages custom-domain support
  - Status: done (`public/CNAME`)

## v1 — Polish / Follow-ups

- [x] Add GH Pages deploy workflow
  - Status: done (`.github/workflows/pages.yml`)
- [x] Fix background “cutoff” band on long pages
  - Status: done (use `min-height` instead of `height: 100%`) (`src/index.css`)
- [x] Fix ENS resolution RPC (avoid merkle.io rate limits)
  - Status: done (`src/wagmi.ts`)
- [x] Tx notice: show full hash + Etherscan link
  - Status: done (`src/pages/HomePage.tsx`, `src/ddrp/registry.ts`)
- [ ] Reduce main bundle size
  - Status: pending (current build warns >500kB chunk)
  - Ideas: code-split routes, lazy-load crypto/decrypt code.
- [ ] Add more chain support for pubkey discovery
  - Status: pending
  - Notes: needs explorer API mapping (Blockscout/Etherscan/etc) per chain.

## v2 Ideas (placeholders)

- [ ] Key registry for brand-new EOAs (publish encryption pubkey via contract/ENS)
- [ ] Message type that points to IPFS blob + wraps a file key
- [ ] MetaMask Snap integration (ECDH/decrypt without key exposure)
- [ ] Optional “turnkey” / backend-assisted decrypt flow (explicitly opt-in)
