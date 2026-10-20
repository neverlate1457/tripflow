import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

export default defineConfig({
  integrations: [react()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    // MapLibre loads its worker as an ESM asset; Vite's dependency optimizer
    // otherwise looks for a generated worker file that is not present.
    optimizeDeps: { exclude: ['maplibre-gl'] },
  },
  devToolbar: {
    enabled: false,
  },
});