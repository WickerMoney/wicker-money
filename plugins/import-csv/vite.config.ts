import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The browser half, built as a Module Federation remote.
 *
 * The plugin's server half is compiled separately by tsc (tsconfig.server.json)
 * and imported by the API as a workspace dependency — one package, two build
 * outputs, because a plugin that stores its own data is not purely a frontend.
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'wickermoney_import_csv',
      filename: 'remoteEntry.js',
      exposes: { './ImportPage': './src/ui/ImportPage.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    rollupOptions: { input: './src/ui/index.ts' },
    outDir: '../../apps/web/public/plugins/import-csv',
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
