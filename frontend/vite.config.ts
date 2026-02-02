import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Enable polyfills needed by Solana wallet adapters and Arcium client
      include: ['buffer', 'crypto', 'stream', 'util', 'events', 'vm', 'process', 'string_decoder'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      overrides: {
        // Use browser-compatible implementations
        stream: 'stream-browserify',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'process.env': {},
    // Ensure process.browser is set for libraries that check it
    'process.browser': true,
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    // Include the arcium client for pre-bundling to ensure polyfills are applied
    include: ['@arcium-hq/client', 'stream-browserify'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // Ensure external Node.js modules are properly handled
      external: [],
    },
  },
})
