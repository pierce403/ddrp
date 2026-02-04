import { createContext, useContext } from 'react';
import type { Address } from 'viem';

export type RegistryConfig = Readonly<{
  chainId: number;
  registryAddress: Address | undefined;
  setRegistryAddress: (address: string) => Address;
  resetRegistryAddress: () => void;
  refreshRegistryAddress: () => void;
}>;

export const RegistryConfigContext = createContext<RegistryConfig | null>(null);

export function useRegistryConfig(): RegistryConfig {
  const ctx = useContext(RegistryConfigContext);
  if (!ctx) throw new Error('useRegistryConfig must be used within <RegistryConfigProvider>');
  return ctx;
}

