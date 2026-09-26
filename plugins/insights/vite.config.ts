import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Built as a Module Federation remote.
 *
 * Output lands in the host's public directory so it is served at the exact URL
 * the manifest advertises (`/plugins/insights/remoteEntry.js`) in both dev and
 * production, with no separate origin or proxy rule to keep in sync.
 *
 * react and react-dom are `singleton: true`: two React copies in one page break
 * hooks in ways that surface as baffling runtime errors rather than a clear
 * failure. The plugin declares them as peers so it never bundles its own.
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'wickermoney_insights',
      filename: 'remoteEntry.js',
      exposes: {
        './TrendWidget': './src/TrendWidget.tsx',
        './DonutWidget': './src/DonutWidget.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    // No index.html — a remote is a library, so Vite needs an explicit input.
    rollupOptions: { input: './src/index.ts' },
    outDir: '../../apps/web/public/plugins/insights',
    emptyOutDir: true,
    target: 'esnext',
    // Module Federation needs the remote's chunks left as ES modules.
    modulePreload: false,
    // No stylesheet is emitted: a remote has no HTML document, so nothing would
    // ever request it. Widgets import their CSS as text and inject it through
    // the SDK's adoptPluginStyles instead.
    cssCodeSplit: false,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    // Vitest stubs CSS by default, so `import css from './viz.css?inline'`
    // resolves to an empty string and the style-injection test would pass on a
    // tag with no rules in it. Processing CSS here makes that assertion real.
    css: true,
  },
})
