import type { OnRpcRequestHandler } from '@metamask/snaps-sdk';
import { divider, heading, panel, text } from '@metamask/snaps-sdk';
import type { BIP44AddressKeyDeriver, JsonBIP44CoinTypeNode } from '@metamask/key-tree';
import { getBIP44AddressKeyDeriver } from '@metamask/key-tree';
import { secp256k1 } from '@noble/curves/secp256k1.js';

type SnapRequest = Readonly<{
  method: string;
  params?: unknown;
}>;

declare const snap: Readonly<{
  request: (args: SnapRequest) => Promise<unknown>;
}>;

const ETHEREUM_COIN_TYPE = 60;
const MAX_ACCOUNT_SCAN = 100;

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

function parseAddress(value: unknown): string {
  if (typeof value !== 'string') throw new Error('account must be a 0x-prefixed hex address string');
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error('account must be a 20-byte hex address');
  return trimmed;
}

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

let cachedEthereumDeriverPromise: Promise<BIP44AddressKeyDeriver> | null = null;
const accountIndexByAddress = new Map<string, number>();

async function getEthereumAddressDeriver(): Promise<BIP44AddressKeyDeriver> {
  if (!cachedEthereumDeriverPromise) {
    cachedEthereumDeriverPromise = (async () => {
      const coinTypeNode = (await snap.request({
        method: 'snap_getBip44Entropy',
        params: { coinType: ETHEREUM_COIN_TYPE },
      })) as JsonBIP44CoinTypeNode;
      return await getBIP44AddressKeyDeriver(coinTypeNode, { account: 0, change: 0 });
    })();
  }
  return cachedEthereumDeriverPromise;
}

async function getAccountPrivateKey(account: string): Promise<Uint8Array> {
  const target = account.toLowerCase();
  const deriver = await getEthereumAddressDeriver();

  const cachedIndex = accountIndexByAddress.get(target);
  if (cachedIndex !== undefined) {
    const node = await deriver(cachedIndex);
    if (node.address.toLowerCase() === target) {
      const priv = node.privateKeyBytes;
      if (!priv) throw new Error('private key unavailable for derived account');
      return priv;
    }
    accountIndexByAddress.delete(target);
  }

  for (let index = 0; index < MAX_ACCOUNT_SCAN; index++) {
    const node = await deriver(index);
    if (node.address.toLowerCase() === target) {
      const priv = node.privateKeyBytes;
      if (!priv) throw new Error('private key unavailable for derived account');
      accountIndexByAddress.set(target, index);
      return priv;
    }
  }

  throw new Error(
    `Account not found among the first ${MAX_ACCOUNT_SCAN} MetaMask HD accounts. Imported accounts and hardware wallets are not supported.`,
  );
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
          'It uses snap_getBip44Entropy (coinType 60) to derive the secp256k1 key for MetaMask HD accounts.',
          'Imported accounts and hardware wallets are not supported.',
        ],
      };
    }

    case 'eth_getEncryptionPublicKey': {
      const { account } = parseEthGetEncryptionPublicKeyParams(req.params);
      await confirm({
        origin,
        title: 'ERC-5630: Share encryption public key?',
        body: [
          `Account: ${account}`,
          'This will share a compressed secp256k1 public key for the selected account.',
          `The snap will derive this from your MetaMask HD seed (BIP-44 coinType ${ETHEREUM_COIN_TYPE}).`,
          'Only approve if you trust this site.',
        ],
      });
      const privKey = await getAccountPrivateKey(account);
      const pubkeyCompressed = secp256k1.getPublicKey(privKey, true);
      return bytesToHex(pubkeyCompressed);
    }

    case 'eth_performECDH': {
      const { account, ephemeralKey } = parseEthPerformEcdhParams(req.params);
      await confirm({
        origin,
        title: 'ERC-5630: Perform ECDH?',
        body: [
          `Account: ${account}`,
          'This will return key material (the ECDH shared secret x-coordinate) for the selected account.',
          `The snap will derive the account key from your MetaMask HD seed (BIP-44 coinType ${ETHEREUM_COIN_TYPE}).`,
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
