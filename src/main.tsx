import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import './index.css';
import App from './App.tsx';
import { RegistryConfigProvider } from './ddrp/RegistryConfigProvider.tsx';
import { wagmiConfig } from './wagmi.ts';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <RegistryConfigProvider>
            <App />
          </RegistryConfigProvider>
        </HashRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
