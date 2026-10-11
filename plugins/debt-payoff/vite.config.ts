import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The browser half, built as a Module Federation remote.
 *
 * Two exposed modules: a page and a dashboard widget. The server half and the
 * shared planner are compiled separately by tsc (`tsconfig.server.json`) and
 * are not part of this bundle, apart from the few constants and types the page
 * imports.
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'wickermoney_debt_payoff',
      filename: 'remoteEntry.js',
      exposes: {
        './DebtPayoffPage': './src/ui/DebtPayoffPage.tsx',
        './DebtFreeWidget': './src/ui/DebtFreeWidget.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    rollupOptions: { input: './src/ui/index.ts' },
    outDir: '../../apps/web/public/plugins/debt-payoff',
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    // No stylesheet is emitted; see adoptPluginStyles in the SDK.
    cssCodeSplit: false,
  },
  test: {
    // Source only. `dist` holds compiled copies of anything tsc emitted, and a
    // stale one there passes long after the source it came from stopped
    // working.
    include: ['src/**/*.test.{ts,tsx}'],
    // The planner and server tests are pure; the UI tests need a DOM, and the
    // pure ones run unchanged in it.
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
  },
})
