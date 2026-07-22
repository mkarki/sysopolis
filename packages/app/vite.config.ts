import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the core package straight from source — no build step in dev.
      '@sysopolis/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
