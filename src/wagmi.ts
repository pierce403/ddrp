import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { anvil, mainnet, sepolia } from 'wagmi/chains';

export const ddrpChains = [mainnet, sepolia, anvil] as const;

export const wagmiConfig = createConfig({
  chains: ddrpChains,
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
    [anvil.id]: http(),
    [sepolia.id]: http(),
  },
});
