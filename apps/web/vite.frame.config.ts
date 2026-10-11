import { federation } from '@module-federation/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Build of the sandboxed plugin frame (`plugin-frame.html`).
 *
 * A second build into the same `dist`, run after the app's (`pnpm build` does
 * both). The API serves the document at `/plugin-frame` with its own CSP and
 * sandbox header, never from the static handler.
 *
 * It is a Module Federation host with its own copy of React: a plugin in the
 * frame loads with the same rules as one in the page, but in a separate realm.
 * The app's assets are not emptied, which is why `emptyOutDir` is off, and the
 * copy of `public/` is off because the first build already made it.
 */
export default defineConfig({
  publicDir: false,
  plugins: [
    react(),
    federation({
      name: 'wickermoney_frame',
      // Under assets/ because the API sends CORS headers for that directory, and a sandboxed frame
      // (opaque origin) fetches its modules in CORS mode.
      filename: 'assets/frameEntry.js',
      remotes: {},
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
      },
    }),
  ],
  build: {
    target: 'esnext',
    emptyOutDir: false,
    rollupOptions: { input: { 'plugin-frame': new URL('./plugin-frame.html', import.meta.url).pathname } },
  },
})
