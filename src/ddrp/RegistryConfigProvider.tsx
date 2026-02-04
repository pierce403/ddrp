import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Address } from 'viem';

import {
  getRegistryAddress as readRegistryAddress,
  resetRegistryAddress as clearStoredRegistryAddress,
  setRegistryAddress as persistRegistryAddress,
} from './registry';
import { useChainId } from 'wagmi';

import { RegistryConfigContext, type RegistryConfig } from './registryConfig';

export function RegistryConfigProvider(props: { children: ReactNode }) {
  const chainId = useChainId();
  const [registryAddress, setRegistryAddressState] = useState<Address | undefined>(() => readRegistryAddress(chainId));

  useEffect(() => {
    setRegistryAddressState(readRegistryAddress(chainId));
  }, [chainId]);

  const value = useMemo<RegistryConfig>(
    () => ({
      chainId,
      registryAddress,
      setRegistryAddress: (address) => {
        const saved = persistRegistryAddress(chainId, address);
        setRegistryAddressState(saved);
        return saved;
      },
      resetRegistryAddress: () => {
        clearStoredRegistryAddress(chainId);
        setRegistryAddressState(readRegistryAddress(chainId));
      },
      refreshRegistryAddress: () => {
        setRegistryAddressState(readRegistryAddress(chainId));
      },
    }),
    [chainId, registryAddress],
  );

  return <RegistryConfigContext.Provider value={value}>{props.children}</RegistryConfigContext.Provider>;
}
