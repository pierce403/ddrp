# AGENTS.md — Notes for future work

## Workflow directive (do this after every task)

- Make a small, descriptive commit, then push to `origin/main`.
- Verify GitHub Actions succeeded via `gh`, e.g.:
  - `gh run list --workflow pages.yml --limit 3`
  - `gh run view <run-id> --json status,conclusion,url -q '.status + \" \" + (.conclusion // \"\") + \" \" + .url'`
- If the deploy failed, fix forward and repeat (commit → push → `gh` verify).

## What surprised us

- **Ethereum address ≠ public key.** For EOAs, the public key generally isn’t available unless you can recover it from a signature (e.g. an outgoing tx). This is a major UX cliff for “encrypt-to-address”.
- **Standard JSON-RPC can’t list “latest tx from address”.** We used a chain explorer API (Blockscout) to find an outgoing tx hash for pubkey recovery.
- **Fast tx-hash lookup**: storing `blockNumber` alongside each drop makes it cheap to find the `DropCreated` log (and thus tx hash) without scanning wide block ranges.

## Decisions and rationale

- **Contract design:** store drops in contract storage + provide `getDropsRange(start,count)` so the frontend can page without heavy log queries (`contracts/DeadDropRegistry.sol`).
- **Capsule v1 format:** fixed header (version + compressed eph pubkey + salt + nonce) + ciphertext/tag. Keeps redundancy low and leaves room for v2 extensions (`src/ddrp/capsuleV1.ts`).
- **Crypto choices:** secp256k1 ECDH → HKDF-SHA256 → XChaCha20-Poly1305. Uses well-reviewed libraries (`@noble/*`) and avoids homebrew crypto.
- **ERC-5630 UX nudge:** decrypt UI includes a wallet ECDH path via `eth_performECDH` with graceful “unsupported” messaging (`src/pages/DropPage.tsx`).
- **Default registry address:** mainnet defaults to `0x26ed9dc854760713Db77aE13DAdf2acc44BFB45f` (override via UI or `VITE_DDRP_REGISTRY_ADDRESS_MAINNET`) (`src/ddrp/registry.ts`).
- **GitHub Pages friendliness:** `HashRouter` + `vite` `base: './'` + `public/CNAME` for `ddrp.io`.
- **Security policy:** keep a root-level `SECURITY.md` with “Supported Versions” + “Reporting a Vulnerability” (GitHub
  recommended), and spell out in-scope vs out-of-scope findings to reduce noise.

## Gotchas / pitfalls

- **Brand-new EOAs can’t receive drops in v1** unless they’ve sent an outgoing tx (nonce > 0). The UI explains this and points at ERC-5630 as the fix.
- **Recipient “live” checks can feel broken if only done on submit.** Preflight the recipient field (checksum/ENS + pubkey recoverability) and debounce the network calls to avoid spamming RPC/explorer APIs.
- **ENS resolution should use a mainnet client.** `getEnsAddress` is a mainnet concern; don’t rely on the currently-selected chain having ENS support.
- **Public RPC defaults can be rate-limited.** `wagmi/chains` mainnet defaults to `eth.merkle.io`, which can 429; configure explicit CORS-friendly RPC fallback for static hosting (`src/wagmi.ts`).
- **Always pass `chainId` for writes.** Wagmi/viem `writeContract` will otherwise send on whatever network the wallet is currently on (e.g. Base), even if the app UI is showing mainnet (`src/pages/HomePage.tsx`).
- **Avoid `height: 100%` on `body` for page backgrounds.** It can clip the background and create a hard horizontal “cutoff” on long pages; prefer `min-height` (or set the background on `html`).
- **Explorer API reliability:** Blockscout endpoints can rate-limit or vary by chain. Add caching/retries or support multiple explorers if needed.
- **Foundry deploys:** `forge create` can default to a dry-run; the deploy helper uses `--broadcast` to actually deploy.
- **In-app deploy bytecode:** the frontend embeds registry creation bytecode for the “Deploy new” button. Keep it in sync with contract changes (`src/ddrp/registryBytecode.ts`).
- **Manual decrypt is dangerous.** Even though it runs locally, users may paste real keys. Keep warnings prominent and consider removing in production deployments.
- **Local plaintext storage:** decrypted messages are saved in `localStorage` for UX (“decrypted locally” filter). Make this explicit and provide a “forget” button (done).

## Next steps / v2 ideas

- **Key publication:** add a minimal key registry contract or read from ENS text records so brand-new EOAs can receive drops without prior tx history.
- **Payload extensions:** standard capsule variant that encrypts a file key and points to IPFS/Arweave payload.
- **Snap integration:** implement the placeholder UI using a MetaMask Snap that performs ECDH/decrypt safely.
- **Better filtering:** switch sender/recipient filters to log-topic queries (since they’re indexed) for faster results at scale.
- **Bundle size:** lazy-load route components and crypto modules; split vendor chunks.
