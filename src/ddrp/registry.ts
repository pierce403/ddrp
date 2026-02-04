import type { Address, Hex } from 'viem';
import { getAddress, isAddress } from 'viem';
import { anvil, sepolia } from 'wagmi/chains';

export const DEAD_DROP_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'MAX_CAPSULE_BYTES',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'createDrop',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'capsule', type: 'bytes' },
    ],
    outputs: [{ name: 'dropId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getDrop',
    stateMutability: 'view',
    inputs: [{ name: 'dropId', type: 'uint256' }],
    outputs: [
      {
        name: 'drop',
        type: 'tuple',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'blockNumber', type: 'uint64' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'capsule', type: 'bytes' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getDropCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getDropsRange',
    stateMutability: 'view',
    inputs: [
      { name: 'start', type: 'uint256' },
      { name: 'count', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'drops',
        type: 'tuple[]',
        components: [
          { name: 'sender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'blockNumber', type: 'uint64' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'capsule', type: 'bytes' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'DropCreated',
    inputs: [
      { name: 'dropId', type: 'uint256', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'blockNumber', type: 'uint64', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
      { name: 'capsule', type: 'bytes', indexed: false },
    ],
  },
] as const;

const STORAGE_KEY_PREFIX = 'ddrp.registryAddress.';

const viteEnv = (import.meta as unknown as { env?: Record<string, string> }).env;

function readEnvAddress(value: unknown): Address | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  if (!isAddress(value)) return undefined;
  return getAddress(value);
}

export const DEFAULT_REGISTRY_ADDRESSES: Partial<Record<number, Address>> = {
  [anvil.id]: readEnvAddress(viteEnv?.VITE_DDRP_REGISTRY_ADDRESS_ANVIL),
  [sepolia.id]: readEnvAddress(viteEnv?.VITE_DDRP_REGISTRY_ADDRESS_SEPOLIA),
};

export function getRegistryAddress(chainId: number): Address | undefined {
  const storageKey = `${STORAGE_KEY_PREFIX}${chainId}`;
  const stored = localStorage.getItem(storageKey);
  if (stored && isAddress(stored)) return getAddress(stored);
  return DEFAULT_REGISTRY_ADDRESSES[chainId];
}

export function setRegistryAddress(chainId: number, address: string): Address {
  if (!isAddress(address)) throw new Error('invalid address');
  const checksummed = getAddress(address);
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${chainId}`, checksummed);
  return checksummed;
}

export function resetRegistryAddress(chainId: number): void {
  localStorage.removeItem(`${STORAGE_KEY_PREFIX}${chainId}`);
}

export function getBlockscoutApiBaseUrl(chainId: number): string | undefined {
  // Expand as needed (Base, OP, Arbitrum, etc).
  if (chainId === sepolia.id) return 'https://eth-sepolia.blockscout.com/api';
  if (chainId === 1) return 'https://eth.blockscout.com/api';
  return undefined;
}

export function blockExplorerTxUrl(chainId: number, txHash: Hex): string | undefined {
  if (chainId === sepolia.id) return `https://eth-sepolia.blockscout.com/tx/${txHash}`;
  if (chainId === 1) return `https://eth.blockscout.com/tx/${txHash}`;
  if (chainId === anvil.id) return undefined;
  return undefined;
}
