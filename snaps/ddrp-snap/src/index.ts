import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { divider, heading, panel, text } from '@metamask/snaps-sdk';
import { secp256k1 } from '@noble/curves/secp256k1.js';

type SnapRequest = Readonly<{
  method: string;
  params?: unknown;
}>;

declare const snap: Readonly<{
  request: (args: SnapRequest) => Promise<unknown>;
}>;

const SNAP_ENTROPY_SALT = 'ddrp.io/snap-ecdh/v1';

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

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

function truncateHex(value: string, start = 10, end = 8): string {
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

async function getSnapPrivateKey(): Promise<Uint8Array> {
  const entropyHex = (await snap.request({
    method: 'snap_getEntropy',
    params: { version: 1, salt: SNAP_ENTROPY_SALT },
  })) as string;
  const entropy = hexToBytes(entropyHex);
  return secp256k1.utils.randomSecretKey(entropy);
}

async function confirm(args: { origin: string; title: string; body: string[] }): Promise<void> {
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

function parseEphemeralPubkey(params: unknown): string {
  if (!params) throw new Error('Missing params.');
  if (Array.isArray(params)) {
    const p0 = params[0];
    if (typeof p0 === 'string') return p0;
  }
  if (typeof params === 'object' && params !== null) {
    const maybe = (params as { ephemeralPubkey?: unknown }).ephemeralPubkey;
    if (typeof maybe === 'string') return maybe;
  }
  throw new Error('Invalid params. Expected { ephemeralPubkey } or [ephemeralPubkey].');
}

export const onRpcRequest: OnRpcRequestHandler = async ({ origin, request }) => {
  const req = request as { method: string; params?: unknown };

  switch (req.method) {
    case 'ddrp_getInfo': {
      return {
        name: 'DDRP ECDH Snap (local dev)',
        methods: ['ddrp_getEncryptionPublicKey', 'ddrp_performECDH'],
        note: 'This snap uses snap_getEntropy to derive a demo secp256k1 key. It cannot access MetaMask EOA keys.',
      };
    }

    case 'ddrp_getEncryptionPublicKey': {
      await confirm({
        origin,
        title: 'DDRP Snap: Share encryption public key?',
        body: [
          'This will share a compressed secp256k1 public key derived from snap_getEntropy.',
          'Only approve if you trust this site.',
        ],
      });
      const privKey = await getSnapPrivateKey();
      const pubkeyCompressed = secp256k1.getPublicKey(privKey, true);
      return bytesToHex(pubkeyCompressed);
    }

    case 'ddrp_performECDH': {
      const ephemeralPubkeyHex = parseEphemeralPubkey(req.params);
      await confirm({
        origin,
        title: 'DDRP Snap: Perform ECDH?',
        body: [
          'This will derive key material (the ECDH shared secret x-coordinate) using a snap-derived private key.',
          'Only approve if you trust this site.',
          `Ephemeral key: ${truncateHex(ephemeralPubkeyHex)}`,
        ],
      });

      const ephBytes = hexToBytes(ephemeralPubkeyHex);
      if (!secp256k1.utils.isValidPublicKey(ephBytes, true)) throw new Error('Invalid compressed secp256k1 pubkey.');

      const privKey = await getSnapPrivateKey();
      const sharedCompressed = secp256k1.getSharedSecret(privKey, ephBytes, true);
      const sharedX = sharedCompressed.slice(1);
      return bytesToHex(sharedX);
    }

    default:
      throw new Error('Method not found.');
  }
};

