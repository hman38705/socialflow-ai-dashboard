/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

// Heavy, infrequently-changing vendor libs split into their own cacheable
// chunks — see docs/performance-budget.md (FE-123). Keeping these out of the
// entry chunk is what the bundle budget check (scripts/check-bundle-budget.mjs)
// relies on.
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
  if (id.includes('framer-motion')) return 'vendor-motion'
  if (id.includes('socket.io-client')) return 'vendor-realtime'
  if (id.includes('dexie')) return 'vendor-storage'
  if (id.includes('@stellar/stellar-sdk')) return 'vendor-blockchain'
  return undefined
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    visualizer({
      filename: 'dist/bundle-report.html',
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@socialflow/shared': path.resolve(__dirname, './packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  // FE-005: no `test` block here — when a sibling vitest.config.ts exists
  // (it does; see that file), Vitest uses it exclusively and ignores this
  // file's `test` config entirely rather than merging the two. A `test`
  // block here was dead, misleading config: it looked authoritative but
  // silently had no effect, and was missing `setupFiles` besides.
})

