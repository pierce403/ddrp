import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { divider, heading, panel, text } from '@metamask/snaps-sdk';
import type { JsonSLIP10Node } from '@metamask/key-tree';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

type SnapRequest = Readonly<{
  method: string;
  params?: unknown;
}>;

declare const snap: Readonly<{
  request: (args: SnapRequest) => Promise<unknown>;
}>;

const ERC5630_PATH_PURPOSE = 5630;
const ERC5630_PATH_NAMESPACE = 0;
const MAX_BIP32_INDEX = 0x7fffffff;
const ERC5630_PATH_PREFIX = ['m', `${ERC5630_PATH_PURPOSE}'`, `${ERC5630_PATH_NAMESPACE}'`] as const;

/**
 * Converts bytes to a 0x-prefixed lowercase hex string.
 * @param bytes - Bytes to encode.
 * @returns Encoded hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Converts a 0x-prefixed hex string into bytes.
 * @param hex - Hex string to decode.
 * @returns Decoded bytes.
 */
function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) throw new Error('hex must start with 0x');
  const body = hex.slice(2);
  if (body.length % 2 !== 0) throw new Error('hex must have an even length');
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) throw new Error('invalid hex');
    out[i] = byte;
  }
  return out;
}

/**
 * Truncates a long hex string for display in confirmation dialogs.
 * @param value - Value to truncate.
 * @param start - Number of chars to keep at the start.
 * @param end - Number of chars to keep at the end.
 * @returns Truncated string.
 */
function truncateHex(value: string, start = 10, end = 8): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

/**
 * Validates and normalizes an EVM address.
 * @param value - Candidate address value.
 * @returns Normalized address string.
 */
function parseAddress(value: unknown): string {
  if (typeof value !== 'string') throw new Error('account must be a 0x-prefixed hex address string');
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error('account must be a 20-byte hex address');
  return trimmed;
}

/**
 * Reads a positive 31-bit integer from a byte array.
 * @param bytes - Source byte array.
 * @param offset - Byte offset.
 * @returns Integer in range [0, 2^31 - 1].
 */
function readUint31(bytes: Uint8Array, offset: number): number {
  const value =
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0);
  return (value >>> 0) & MAX_BIP32_INDEX;
}

/**
 * Derives a deterministic BIP-32 path for an account within the ERC-5630 snap namespace.
 * @param account - EVM account address.
 * @returns BIP-32 derivation path array.
 */
function deriveAccountPath(account: string): string[] {
  const normalizedAccount = account.toLowerCase();
  const accountDigest = keccak_256(hexToBytes(normalizedAccount));
  const accountIndexA = readUint31(accountDigest, 0);
  const accountIndexB = readUint31(accountDigest, 4);
  return [...ERC5630_PATH_PREFIX, `${accountIndexA}'`, `${accountIndexB}'`];
}

/**
 * Parses params for `eth_getEncryptionPublicKey`.
 * @param params - RPC params in array or object form.
 * @returns Parsed account.
 */
function parseEthGetEncryptionPublicKeyParams(params: unknown): { account: string } {
  if (!params) throw new Error('Missing params. Expected [account].');
  if (Array.isArray(params)) {
    const [account] = params;
    return { account: parseAddress(account) };
  }
  if (typeof params === 'object' && params !== null) {
    const maybe = (params as { account?: unknown }).account;
    return { account: parseAddress(maybe) };
  }
  throw new Error('Invalid params. Expected [account] or { account }.');
}

/**
 * Parses params for `eth_performECDH`.
 * @param params - RPC params in array or object form.
 * @returns Parsed account and ephemeral key.
 */
function parseEthPerformEcdhParams(params: unknown): { account: string; ephemeralKey: string } {
  if (!params) throw new Error('Missing params. Expected [account, ephemeralKey].');
  if (Array.isArray(params)) {
    const [account, ephemeralKey] = params;
    if (typeof ephemeralKey !== 'string') throw new Error('ephemeralKey must be a 0x-prefixed hex string');
    return { account: parseAddress(account), ephemeralKey: ephemeralKey.trim() };
  }
  if (typeof params === 'object' && params !== null) {
    const obj = params as { account?: unknown; ephemeralKey?: unknown };
    if (typeof obj.ephemeralKey !== 'string') throw new Error('ephemeralKey must be a 0x-prefixed hex string');
    return { account: parseAddress(obj.account), ephemeralKey: obj.ephemeralKey.trim() };
  }
  throw new Error('Invalid params. Expected [account, ephemeralKey] or { account, ephemeralKey }.');
}

/**
 * Prompts the user for explicit confirmation before sensitive actions.
 * @param args - Dialog arguments.
 * @param args.origin - Requesting origin.
 * @param args.title - Dialog title.
 * @param args.body - Dialog body lines.
 * @returns Resolves when the user approves, otherwise throws.
 */
async function confirm(args: {
  origin: string;
  title: string;
  body: string[];
}): Promise<void> {
  const ok = (await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading(args.title),
        text(`Origin: ${args.origin}`),
        divider(),
        ...args.body.map((line) => text(line)),
      ]),
    },
  })) as boolean;
  if (!ok) throw new Error('User rejected request.');
}

/**
 * Derives and returns deterministic per-account private key bytes from snap-managed BIP-32 entropy.
 * @param account - Account address used as key namespace input.
 * @returns Derived private key bytes.
 */
async function getAccountPrivateKey(account: string): Promise<Uint8Array> {
  const path = deriveAccountPath(account);
  const node = (await snap.request({
    method: 'snap_getBip32Entropy',
    params: {
      curve: 'secp256k1',
      path,
    },
  })) as JsonSLIP10Node;

  if (!node.privateKey) throw new Error('private key unavailable for derived account');
  const privateKeyBytes = hexToBytes(node.privateKey);
  if (privateKeyBytes.length !== 32) throw new Error('invalid derived private key length');
  return privateKeyBytes;
}

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  const req = request as { method: string; params?: unknown };

  switch (req.method) {
    case 'erc5630_getInfo':
    case 'eip5630_getInfo': {
      return {
        name: 'ERC-5630 ECDH Snap',
        methods: ['eth_getEncryptionPublicKey', 'eth_performECDH'],
        notes: [
          'This snap implements ERC-5630-style methods via wallet_invokeSnap, not as top-level wallet RPC methods.',
          `It derives per-account keys from snap_getBip32Entropy under ${ERC5630_PATH_PREFIX.join('/')}/...`,
          'Keys are deterministic per wallet entropy source + account string, and are not the account signing key.',
        ],
      };
    }

    case 'eth_getEncryptionPublicKey': {
      const { account } = parseEthGetEncryptionPublicKeyParams(req.params);
      const path = deriveAccountPath(account);
      await confirm({
        origin,
        title: 'ERC-5630: Share encryption public key?',
        body: [
          `Account: ${account}`,
          'This will share a compressed secp256k1 public key for the selected account.',
          `Derivation path: ${path.join('/')}`,
          'This key is snap-derived from wallet entropy and account input, not from your transaction signing path.',
          'Only approve if you trust this site.',
        ],
      });
      const privKey = await getAccountPrivateKey(account);
      const pubkeyCompressed = secp256k1.getPublicKey(privKey, true);
      return bytesToHex(pubkeyCompressed);
    }

    case 'eth_performECDH': {
      const { account, ephemeralKey } = parseEthPerformEcdhParams(req.params);
      const path = deriveAccountPath(account);
      await confirm({
        origin,
        title: 'ERC-5630: Perform ECDH?',
        body: [
          `Account: ${account}`,
          'This will return key material (the ECDH shared secret x-coordinate) for the selected account.',
          `Derivation path: ${path.join('/')}`,
          'This key is snap-derived from wallet entropy and account input, not from your transaction signing path.',
          'Only approve if you trust this site.',
          `Ephemeral key: ${truncateHex(ephemeralKey)}`,
        ],
      });

      const ephBytes = hexToBytes(ephemeralKey);
      if (!secp256k1.utils.isValidPublicKey(ephBytes, true)) throw new Error('Invalid compressed secp256k1 pubkey.');

      const privKey = await getAccountPrivateKey(account);
      const sharedCompressed = secp256k1.getSharedSecret(privKey, ephBytes, true);
      const sharedX = sharedCompressed.slice(1);
      return bytesToHex(sharedX);
    }

    default:
      throw new Error('Method not found.');
  }
};
