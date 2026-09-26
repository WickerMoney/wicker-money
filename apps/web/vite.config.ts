import { readFileSync } from 'node:fs'
import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Module Federation host.
 *
 * `remotes` is empty on purpose: plugins are discovered at runtime from the
 * database, so the host cannot know them at build time. They are registered
 * through the MF runtime once /api/v1/plugins has been read.
 *
 * react and react-dom are singletons. Two React copies in one page break hooks
 * with errors that point nowhere near the cause, so this is the one shared
 * config worth being strict about.
 */
// Stamped by the release build (docker/stamp-version.mjs, from the tag) before
// this runs; 0.0.0 otherwise. Read here rather than imported as JSON so no
// tsconfig/resolveJsonModule change is needed for a single string.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  // Baked into the bundle as a literal at build time; see src/vite-env.d.ts and
  // AboutSection.tsx. Vite replaces the identifier textually, so it costs nothing
  // at runtime and needs no fetch back to the API just to show a version number.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    federation({
      name: 'wickermoney_host',
      remotes: {},
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: { target: 'esnext' },
  server: {
    port: 5173,
    proxy: {
      // Dev only: keeps the browser on one origin so there is no CORS to
      // configure and cookies/headers behave as they will in production. The
      // refresh token is an HttpOnly cookie, so the API must stay same-origin
      // for the browser to send it; `cookieDomainRewrite` strips any Domain
      // attribute the API sets, which would otherwise pin the cookie to the
      // API's host instead of the dev server's. `changeOrigin` is deliberately
      // off: the API checks that `Origin` matches `Host` on cookie-bearing requests.
      '/api': { target: 'http://localhost:8080', cookieDomainRewrite: '' },
    },
  },
  test: { environment: 'jsdom', globals: false, setupFiles: ['./vitest.setup.ts'] },
})
