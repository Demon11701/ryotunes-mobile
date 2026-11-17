import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ryotunesProviderDevPlugin } from './viteProviderPlugin';

export default defineConfig({
  plugins: [react(), ryotunesProviderDevPlugin()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    assetsInlineLimit: 4096,
    sourcemap: false,
  },
});
