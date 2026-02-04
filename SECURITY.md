# Security Policy

DDRP (ddrp.io) is a **tiny demo dapp** for encrypted on-chain “drops”. It is intended for developer education and
experimentation, not production use, and has **not** received a professional security audit.

If you discover an issue that could put users at risk (loss of funds, key exfiltration, unauthorized decryption, etc.),
please report it privately.

## Supported Versions

| Version | Supported |
| --- | --- |
| `main` / latest deployment (`ddrp.io`) | ✅ |
| Older commits/tags | ❌ |

## Reporting a Vulnerability

Preferred: **GitHub Security Advisories** → this repo → **Security** → **Report a vulnerability**.

Please **do not** file public GitHub issues/discussions for security-sensitive reports.

Include as much of the following as possible:

- A clear description of the issue and why it matters
- Affected area(s): contract, frontend, crypto, wallet interactions, build/deploy, etc.
- Steps to reproduce (ideally a minimal repro)
- Expected vs actual behavior
- Any PoC code, screenshots, logs, or transaction hashes
- Environment details (browser + version, wallet + version, chain/network, RPC provider)

Response expectations (best effort):

- Initial acknowledgement: within ~72 hours
- Status updates: as needed while we work on a fix

No bug bounty program is offered for this repo.

## Security Model (What This Project Tries to Guarantee)

### What DDRP *is*

- A **static** (GitHub Pages) frontend that:
  - Encrypts message plaintext **client-side**
  - Publishes ciphertext + metadata to an on-chain registry contract
  - Lets recipients discover drops and decrypt them locally
- A minimal on-chain registry contract (`contracts/DeadDropRegistry.sol`) that stores and indexes drops.

### Security properties we aim for

- **Plaintext confidentiality**: the plaintext should be computationally infeasible to recover from the on-chain capsule
  without the recipient’s private key (or an equivalent wallet-assisted ECDH method).
- **Ciphertext integrity**: ciphertext modifications should be detected (AEAD).
- **No secret exfiltration by the app**: the dapp must not transmit private keys, seed phrases, or derived secrets off the
  device (even accidentally via analytics, logging, query strings, etc.).
- **Correct-chain safety**: the dapp must not trick users into sending transactions on the wrong chain when the UI is
  indicating a different chain.

### What is always public (by design)

Even with perfect encryption, the blockchain reveals:

- Sender and recipient addresses
- Timestamps, ordering, and on-chain activity patterns
- Ciphertext size (approximate message length)
- The full capsule bytes (ciphertext + parameters)

If you need metadata privacy, DDRP v1 is not the right tool.

### Trust assumptions / limits

DDRP cannot protect users if:

- The user’s device/browser is compromised (malware, malicious extensions, etc.)
- The user pastes a real private key/seed phrase into the “Manual decrypt (unsafe)” UI
- The user installs/approves a malicious MetaMask Snap (or a Snap build is modified). This repo includes an experimental
  local-dev ERC-5630 Snap that requests `snap_getBip44Entropy` (coinType `60`), which is **high-privilege** (it can
  derive MetaMask HD account private keys). Only install/build from sources you trust.
- The user is phished into using a malicious site/domain or a modified build
- A wallet has bugs or is compromised

## Capsule / Crypto Notes (v1)

Capsule v1 is a fixed binary envelope:

- Sender generates an **ephemeral secp256k1 keypair**
- Derives a shared secret via **secp256k1 ECDH** against the recipient secp256k1 public key
- Uses **HKDF-SHA256** to derive a symmetric key
- Encrypts the plaintext message via **XChaCha20-Poly1305**

Decryption can be performed by any method that can compute the same ECDH shared secret:

- Wallet-assisted ECDH (ERC-5630-style `eth_performECDH`) – aspirational
- Manual decrypt using a provided private key (unsafe dev fallback)
- Snap-based wallet ECDH (experimental): this repo includes a local-dev Snap that exposes `eth_getEncryptionPublicKey`
  and `eth_performECDH` via `wallet_invokeSnap`.

### Recipient public key discovery (v1)

To encrypt to an EOA address, v1 recovers the recipient’s secp256k1 public key from an outgoing transaction signature
(requires nonce &gt; 0). This uses:

- An explorer API to locate a recent outgoing tx hash
- An RPC call to fetch the transaction and recover the pubkey locally

If lookup/recovery returns a pubkey that doesn’t correspond to the recipient address, encryption should fail rather than
silently encrypting to the wrong key.

### ERC-5630 / wallet ECDH caveats

- `eth_performECDH` returns **key material** (the raw ECDH output / x-coordinate). Treat it like a secret:
  - Do not log it, persist it, or transmit it.
  - Always run a KDF with app-specific “info”/domain-separation before using it as a symmetric key.
- **Public key validation matters.** Wallets should validate that the provided ephemeral key is a valid **compressed
  secp256k1** point (SEC1 format) and reject invalid points. DDRP also validates capsule v1 ephemeral pubkeys before
  attempting wallet ECDH.
- `eth_performECDH` can act like an **ECDH oracle**. Wallet implementations should gate it behind explicit user consent
  and implement robust input validation to defend against invalid-curve / “twist”-style issues discussed in the ERC-5630
  thread.
- Snap-based implementations of ERC-5630 may require `snap_getBip44Entropy` to access keys. This is an extremely
  sensitive permission: once installed, **any site** can try to invoke the snap (via `wallet_invokeSnap`) and request
  public keys / ECDH outputs. The snap should display the requesting origin and require explicit confirmation each time,
  and users should only approve requests from sites they trust.
- If/when widely supported, prefer `eth_getEncryptionPublicKey` for encryption key discovery (vs explorer-based pubkey
  recovery), since it avoids explorer dependence and works for brand-new EOAs.

References:

- ERC-5630 (EIP-5630): https://eips.ethereum.org/EIPS/eip-5630
- Discussion: https://ethereum-magicians.org/t/eip-5630-encryption-and-decryption/10761

### Local plaintext storage

For UX, DDRP caches decrypted plaintext in `localStorage` (per-drop) until you click “Forget” (or clear site data).
This is convenient, but increases exposure in the presence of XSS, malicious extensions, or shared devices.

## What Counts as a Security Bug (In Scope)

The following are considered security-impacting issues (examples, not exhaustive):

### Key and secret handling

- Any path where the app **logs**, **stores**, or **transmits** secrets off-device:
  - Private keys, seed phrases, shared secrets, HKDF output keys, decrypted plaintext
- XSS / injection that could read secrets from the DOM, localStorage, clipboard, or input fields

### Crypto correctness

- Bugs that cause encryption to target the **wrong recipient key/address**
- Bugs that allow **unauthorized decryption** of a drop’s plaintext (without the recipient key)
- Any path that lets attacker-controlled capsule bytes cause unsafe wallet interactions (e.g. calling `eth_performECDH`
  with an invalid/unchecked secp256k1 point)
- AEAD misuse (nonce reuse, incorrect key derivation, broken parsing) that materially reduces confidentiality/integrity
- Capsule parsing bugs that allow a malicious capsule to crash the app in a way that could lead to code execution or
  data exfiltration

### Wallet / transaction safety

- Transactions being sent on the **wrong chain** while the UI indicates otherwise
- Incorrect contract calls (wrong address/function/args) that could cause loss of funds or unexpected state changes
- UI flows that could be exploited to trick a user into signing unintended transactions

### Smart contract issues

- Any bug that would allow:
  - Unauthorized state writes or unintended drop mutation
  - Drop ID confusion (e.g., returning the wrong drop for an ID)
  - Storage corruption that breaks discovery/decryption expectations

## Out of Scope / Not a Security Issue (By Design)

We explicitly do **not** consider the following to be security bugs for DDRP v1:

- **Spam / griefing**: anyone can create drops; paying gas is the deterrent
- **Lack of metadata privacy** (sender/recipient/timing/size): on-chain publishing inherently leaks this
- **Censorship / liveness** issues at the mempool, miner/validator, RPC, or explorer layer
- **Chain reorgs** and typical blockchain finality behavior
- **RPC outages/rate limits** or explorer API variability (unless it causes a concrete security issue such as
  mis-encryption to the wrong key)
- UI/UX polish issues that do not plausibly lead to key loss, fund loss, or unauthorized decryption
- Threats requiring a compromised user device (malware) or a compromised wallet, except where the app worsens impact

## Disclosure / Coordinated Fixes

Please give us a reasonable opportunity to investigate and fix issues before public disclosure.
If you are working under a standard disclosure timeline (e.g., ~90 days), include that in your initial report so we can
coordinate.

## Tips for Safe Testing

- Use a **throwaway test wallet/account** for any manual key entry
- Treat decrypted plaintext as sensitive: DDRP stores it in `localStorage` until you click “Forget” (or clear site data)
- When reporting issues, prefer sharing **drop IDs** and **transaction hashes**, not private keys
