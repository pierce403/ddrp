import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { anvil, mainnet, sepolia } from 'wagmi/chains';
import { fallback } from 'viem';

export const ddrpChains = [mainnet, sepolia, anvil] as const;

export const wagmiConfig = createConfig({
  chains: ddrpChains,
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    // wagmi/chains currently defaults mainnet RPC to `https://eth.merkle.io` which is rate-limited.
    // Provide a resilient, CORS-friendly fallback for static hosting (GitHub Pages).
    [mainnet.id]: fallback([http('https://ethereum.publicnode.com'), http('https://eth.llamarpc.com')]),
    [anvil.id]: http(),
    [sepolia.id]: http(),
  },
});
