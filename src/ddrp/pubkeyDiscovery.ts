import type { Address, Hash, Hex, PublicClient, Transaction, TransactionSerializable } from 'viem';
import { bytesToHex, getAddress, hexToBytes, isAddress, keccak256, recoverPublicKey, serializeTransaction } from 'viem';

import { getBlockscoutApiBaseUrl } from './registry';

export async function recoverSenderPublicKeyFromTransaction(tx: Transaction): Promise<Hex> {
  const signature = {
    r: tx.r,
    s: tx.s,
    yParity: tx.type === 'legacy' ? legacyVToYParity(tx.v) : tx.yParity,
  };

  const serializable = transactionToSerializable(tx);
  const digest = keccak256(serializeTransaction(serializable));
  return await recoverPublicKey({ hash: digest, signature });
}

function legacyVToYParity(v: bigint): number {
  if (v === 27n) return 0;
  if (v === 28n) return 1;
  if (v >= 35n) return Number((v - 35n) % 2n);
  throw new Error(`unsupported legacy v: ${v.toString()}`);
}

function inferLegacyChainId(v: bigint): number | undefined {
  if (v < 35n) return undefined;
  const yParity = legacyVToYParity(v);
  return Number((v - 35n - BigInt(yParity)) / 2n);
}

function transactionToSerializable(tx: Transaction): TransactionSerializable {
  const base = {
    nonce: tx.nonce,
    gas: tx.gas,
    to: tx.to,
    value: tx.value,
    data: tx.input,
  } as const;

  if (tx.type === 'legacy') {
    const chainId = tx.chainId ?? inferLegacyChainId(tx.v) ?? 0;
    return {
      ...base,
      type: 'legacy',
      chainId,
      gasPrice: tx.gasPrice,
    } as TransactionSerializable;
  }

  if (tx.type === 'eip2930') {
    return {
      ...base,
      type: 'eip2930',
      chainId: tx.chainId,
      gasPrice: tx.gasPrice,
      accessList: tx.accessList,
    } as TransactionSerializable;
  }

  if (tx.type === 'eip1559') {
    return {
      ...base,
      type: 'eip1559',
      chainId: tx.chainId,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      accessList: tx.accessList,
    } as TransactionSerializable;
  }

  if (tx.type === 'eip4844') {
    return {
      ...base,
      type: 'eip4844',
      chainId: tx.chainId,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      maxFeePerBlobGas: tx.maxFeePerBlobGas,
      blobVersionedHashes: tx.blobVersionedHashes,
      accessList: tx.accessList,
    } as TransactionSerializable;
  }

  throw new Error(`unsupported transaction type: ${tx.type}`);
}

type BlockscoutTxListResponse = Readonly<{
  status: string;
  message: string;
  result: Array<{ hash: string; from: string }> | string;
}>;

async function findLatestOutgoingTxHashViaBlockscout(args: {
  chainId: number;
  address: Address;
}): Promise<Hash> {
  const apiBase = getBlockscoutApiBaseUrl(args.chainId);
  if (!apiBase) throw new Error('No explorer API configured for this chainId.');

  const url = new URL(apiBase);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', args.address);
  url.searchParams.set('filter_by', 'from');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '1');

  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`explorer error: HTTP ${res.status}`);
  const data = (await res.json()) as BlockscoutTxListResponse;

  if (data.status !== '1' || !Array.isArray(data.result) || data.result.length === 0) {
    throw new Error(`explorer returned no outgoing tx (status=${data.status}, message=${data.message})`);
  }

  const hash = data.result[0]?.hash;
  if (typeof hash !== 'string' || !hash.startsWith('0x') || hash.length !== 66) throw new Error('invalid tx hash');

  return hash as Hash;
}

async function findLatestOutgoingTxHashViaBlockScan(args: {
  publicClient: PublicClient;
  address: Address;
  maxBlocksToScan: bigint;
}): Promise<Hash> {
  const target = args.address.toLowerCase();
  const latest = await args.publicClient.getBlockNumber();
  const max = args.maxBlocksToScan < latest ? args.maxBlocksToScan : latest;

  for (let i = 0n; i <= max; i++) {
    const blockNumber = latest - i;
    const block = await args.publicClient.getBlock({ blockNumber, includeTransactions: true });
    for (const tx of block.transactions) {
      if (tx.from.toLowerCase() === target) return tx.hash;
    }
  }

  throw new Error(`no outgoing tx found in last ${max.toString()} blocks`);
}

export async function getRecipientPublicKey(args: {
  publicClient: PublicClient;
  chainId: number;
  recipientAddress: Address;
}): Promise<Uint8Array> {
  // "Nonce" is the count of outgoing txs.
  const nonce = await args.publicClient.getTransactionCount({ address: args.recipientAddress });
  if (nonce === 0) {
    throw new Error(
      [
        'Recipient has no outgoing transactions (nonce=0).',
        'Ethereum addresses are not public keys, so v1 cannot recover a secp256k1 pubkey for brand-new EOAs.',
        'This is exactly the UX gap EIP-5630 is trying to solve.',
      ].join(' '),
    );
  }

  const txHash =
    args.chainId === 31337
      ? await findLatestOutgoingTxHashViaBlockScan({
          publicClient: args.publicClient,
          address: args.recipientAddress,
          maxBlocksToScan: 500n,
        })
      : await findLatestOutgoingTxHashViaBlockscout({
          chainId: args.chainId,
          address: args.recipientAddress,
        });

  const tx = await args.publicClient.getTransaction({ hash: txHash });
  if (getAddress(tx.from) !== getAddress(args.recipientAddress)) {
    throw new Error('latest outgoing tx mismatch: explorer/rpc returned a tx from a different address');
  }

  const pubkeyHex = await recoverSenderPublicKeyFromTransaction(tx);
  return hexToBytes(pubkeyHex);
}

export function formatPublicKey(pubkey: Uint8Array): string {
  const hex = bytesToHex(pubkey);
  return `${hex.slice(0, 10)}…${hex.slice(-8)}`;
}

export function parseRecipientAddress(value: string): Address {
  if (!isAddress(value)) throw new Error('invalid address');
  return getAddress(value);
}

