import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8088',
      '/health': 'http://localhost:8088',
      '/data': 'http://localhost:8088',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
