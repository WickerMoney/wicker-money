import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Built as a Module Federation remote.
 *
 * Output lands in the host's public directory so it is served at the exact URL
 * the manifest advertises (`/plugins/upcoming/remoteEntry.js`) in both
 * dev and production, with no separate origin or proxy rule to keep in sync.
 *
 * react and react-dom are `singleton: true`: two React copies in one page break
 * hooks in ways that surface as baffling runtime errors rather than a clear
 * failure. The plugin declares them as peers so it never bundles its own.
 *
 * The federation name is what `federationName('wickermoney.upcoming')`
 * returns; the host derives the same string when it registers the remote.
 */
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'wickermoney_upcoming',
      filename: 'remoteEntry.js',
      exposes: {
        './UpcomingWidget': './src/UpcomingWidget.tsx',
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
    outDir: '../../apps/web/public/plugins/upcoming',
    emptyOutDir: true,
    target: 'esnext',
    // Module Federation needs the remote's chunks left as ES modules.
    modulePreload: false,
    // No stylesheet is emitted: a remote has no HTML document, so nothing would
    // ever request it. The widget imports its CSS as text and injects it through
    // the SDK's adoptPluginStyles instead.
    cssCodeSplit: false,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    // Pinned so a compiled copy can never be collected as a second suite.
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest stubs CSS by default, so `import css from './x.css?inline'`
    // resolves to an empty string and the style-injection test would pass on a
    // tag with no rules in it. Processing CSS here makes that assertion real.
    css: true,
  },
})
