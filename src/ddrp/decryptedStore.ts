import type { Address } from 'viem';

type StoredDecryption = Readonly<{
  plaintext: string;
  decryptedAt: number;
}>;

function storageKey(args: {
  chainId: number;
  registryAddress: Address;
  dropId: bigint;
}): string {
  return `ddrp.decrypted.${args.chainId}.${args.registryAddress}.${args.dropId.toString()}`;
}

export function getDecryptedPlaintext(args: {
  chainId: number;
  registryAddress: Address;
  dropId: bigint;
}): string | undefined {
  const raw = localStorage.getItem(storageKey(args));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as StoredDecryption;
    if (!parsed || typeof parsed.plaintext !== 'string') return undefined;
    return parsed.plaintext;
  } catch {
    return undefined;
  }
}

export function setDecryptedPlaintext(args: {
  chainId: number;
  registryAddress: Address;
  dropId: bigint;
  plaintext: string;
}): void {
  const value: StoredDecryption = { plaintext: args.plaintext, decryptedAt: Date.now() };
  localStorage.setItem(storageKey(args), JSON.stringify(value));
}

export function clearDecryptedPlaintext(args: {
  chainId: number;
  registryAddress: Address;
  dropId: bigint;
}): void {
  localStorage.removeItem(storageKey(args));
}

