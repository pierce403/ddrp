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
- The user is phished into using a malicious site/domain or a modified build
- A wallet has bugs or is compromised

## Capsule / Crypto Notes (v1)

Capsule v1 is a fixed binary envelope:

- Sender generates an **ephemeral secp256k1 keypair**
- Derives a shared secret via **secp256k1 ECDH** against the recipient secp256k1 public key
- Uses **HKDF-SHA256** to derive a symmetric key
- Encrypts the plaintext message via **XChaCha20-Poly1305**

Decryption can be performed by any method that can compute the same ECDH shared secret:

- Wallet-assisted ECDH (EIP-5630-style `eth_performECDH`) – aspirational
- Manual decrypt using a provided private key (unsafe dev fallback)
- Future Snap-based decrypt (placeholder)

## What Counts as a Security Bug (In Scope)

The following are considered security-impacting issues (examples, not exhaustive):

### Key and secret handling

- Any path where the app **logs**, **stores**, or **transmits** secrets off-device:
  - Private keys, seed phrases, shared secrets, HKDF output keys, decrypted plaintext
- XSS / injection that could read secrets from the DOM, localStorage, clipboard, or input fields

### Crypto correctness

- Bugs that cause encryption to target the **wrong recipient key/address**
- Bugs that allow **unauthorized decryption** of a drop’s plaintext (without the recipient key)
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
- Treat decrypted plaintext as sensitive: it may be stored locally by your browser until you clear it
- When reporting issues, prefer sharing **drop IDs** and **transaction hashes**, not private keys

