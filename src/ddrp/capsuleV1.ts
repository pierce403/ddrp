import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const DDRP_CAPSULE_VERSION_V1 = 1 as const;

const SALT_BYTES = 16;
const NONCE_BYTES = 24;
const COMPRESSED_PUBKEY_BYTES = 33;
const V1_HEADER_BYTES = 1 + COMPRESSED_PUBKEY_BYTES + SALT_BYTES + NONCE_BYTES;

const AAD = new TextEncoder().encode('DDRP:v1');

export type CapsuleV1 = Readonly<{
  version: typeof DDRP_CAPSULE_VERSION_V1;
  ephemeralPubkeyCompressed: Uint8Array; // 33 bytes
  salt: Uint8Array; // 16 bytes
  nonce: Uint8Array; // 24 bytes (XChaCha20-Poly1305)
  ciphertext: Uint8Array; // includes AEAD tag
}>;

export function randomBytes(length: number): Uint8Array {
  if (length <= 0 || !Number.isSafeInteger(length)) throw new Error('invalid length');
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function assertLength(bytes: Uint8Array, expected: number, label: string): void {
  if (bytes.length !== expected) throw new Error(`${label} must be ${expected} bytes (got ${bytes.length})`);
}

function normalizeSharedSecretX(shared: Uint8Array): Uint8Array {
  // Wallets / libs vary: some return 32-byte x-coordinate, others a compressed/uncompressed point.
  if (shared.length === 32) return shared;
  if (shared.length === 33) return shared.slice(1);
  if (shared.length === 65) return shared.slice(1, 33);
  throw new Error(`unexpected shared secret length: ${shared.length}`);
}

export function encodeCapsuleV1(parts: Omit<CapsuleV1, 'version'>): Uint8Array {
  assertLength(parts.ephemeralPubkeyCompressed, COMPRESSED_PUBKEY_BYTES, 'ephemeral pubkey');
  assertLength(parts.salt, SALT_BYTES, 'salt');
  assertLength(parts.nonce, NONCE_BYTES, 'nonce');
  if (parts.ciphertext.length === 0) throw new Error('ciphertext is empty');

  const out = new Uint8Array(V1_HEADER_BYTES + parts.ciphertext.length);
  out[0] = DDRP_CAPSULE_VERSION_V1;
  out.set(parts.ephemeralPubkeyCompressed, 1);
  out.set(parts.salt, 1 + COMPRESSED_PUBKEY_BYTES);
  out.set(parts.nonce, 1 + COMPRESSED_PUBKEY_BYTES + SALT_BYTES);
  out.set(parts.ciphertext, V1_HEADER_BYTES);
  return out;
}

export function decodeCapsuleV1(capsule: Uint8Array): CapsuleV1 {
  if (capsule.length < V1_HEADER_BYTES + 1) throw new Error('capsule too short');
  const version = capsule[0];
  if (version !== DDRP_CAPSULE_VERSION_V1) throw new Error(`unsupported capsule version: ${version}`);

  const ephemeralPubkeyCompressed = capsule.slice(1, 1 + COMPRESSED_PUBKEY_BYTES);
  const salt = capsule.slice(1 + COMPRESSED_PUBKEY_BYTES, 1 + COMPRESSED_PUBKEY_BYTES + SALT_BYTES);
  const nonce = capsule.slice(
    1 + COMPRESSED_PUBKEY_BYTES + SALT_BYTES,
    1 + COMPRESSED_PUBKEY_BYTES + SALT_BYTES + NONCE_BYTES,
  );
  const ciphertext = capsule.slice(V1_HEADER_BYTES);

  return {
    version: DDRP_CAPSULE_VERSION_V1,
    ephemeralPubkeyCompressed,
    salt,
    nonce,
    ciphertext,
  };
}

function deriveMessageKey(sharedSecret: Uint8Array, salt: Uint8Array): Uint8Array {
  assertLength(salt, SALT_BYTES, 'salt');
  const ikm = normalizeSharedSecretX(sharedSecret);
  return hkdf(sha256, ikm, salt, AAD, 32);
}

export function encryptMessageV1(args: { recipientPubkey: Uint8Array; message: string }): {
  capsule: Uint8Array;
  ephemeralPubkeyCompressed: Uint8Array;
} {
  const plaintext = new TextEncoder().encode(args.message);
  if (plaintext.length === 0) throw new Error('message is empty');

  const ephPriv = secp256k1.utils.randomSecretKey();
  const ephPubCompressed = secp256k1.getPublicKey(ephPriv, true);

  const shared = secp256k1.getSharedSecret(ephPriv, args.recipientPubkey, true);
  const salt = randomBytes(SALT_BYTES);
  const key = deriveMessageKey(shared, salt);
  const nonce = randomBytes(NONCE_BYTES);

  const ciphertext = xchacha20poly1305(key, nonce, AAD).encrypt(plaintext);
  const capsule = encodeCapsuleV1({
    ephemeralPubkeyCompressed: ephPubCompressed,
    salt,
    nonce,
    ciphertext,
  });

  return { capsule, ephemeralPubkeyCompressed: ephPubCompressed };
}

export function decryptMessageV1(args: { capsule: Uint8Array; recipientPrivateKey: Uint8Array }): string {
  const decoded = decodeCapsuleV1(args.capsule);
  const shared = secp256k1.getSharedSecret(args.recipientPrivateKey, decoded.ephemeralPubkeyCompressed, true);
  const key = deriveMessageKey(shared, decoded.salt);
  const plaintext = xchacha20poly1305(key, decoded.nonce, AAD).decrypt(decoded.ciphertext);
  return new TextDecoder().decode(plaintext);
}

export function decryptMessageV1FromSharedSecret(args: { capsule: Uint8Array; sharedSecret: Uint8Array }): string {
  const decoded = decodeCapsuleV1(args.capsule);
  const key = deriveMessageKey(args.sharedSecret, decoded.salt);
  const plaintext = xchacha20poly1305(key, decoded.nonce, AAD).decrypt(decoded.ciphertext);
  return new TextDecoder().decode(plaintext);
}
