import type { SnapConfig } from '@metamask/snaps-cli';

const config: SnapConfig = {
  input: 'src/index.ts',
  server: {
    port: 8081,
  },
  polyfills: {
    buffer: true,
  },
  typescript: {
    enabled: true,
  },
};

export default config;
