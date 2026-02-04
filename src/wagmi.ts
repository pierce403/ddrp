import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { anvil, sepolia } from 'wagmi/chains';

export const ddrpChains = [anvil, sepolia] as const;

export const wagmiConfig = createConfig({
  chains: ddrpChains,
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [anvil.id]: http(),
    [sepolia.id]: http(),
  },
});

