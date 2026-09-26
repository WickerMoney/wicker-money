import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The browser half, built as a Module Federation remote.
 *
 * Two exposed modules rather than one: this is the first plugin to contribute
 * both a page and a dashboard widget, which is the combination the SDK was
 * shaped for and the one nothing had exercised end to end until now.
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'wickermoney_budgets',
      filename: 'remoteEntry.js',
      exposes: {
        './BudgetsPage': './src/ui/BudgetsPage.tsx',
        './AtRiskWidget': './src/ui/AtRiskWidget.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    rollupOptions: { input: './src/ui/index.ts' },
    outDir: '../../apps/web/public/plugins/budgets',
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
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    css: true,
  },
})
