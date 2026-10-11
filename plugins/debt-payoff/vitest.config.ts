import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Source only. `dist` holds compiled copies of anything tsc emitted, and a
    // stale one there passes long after the source it came from stopped
    // working.
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
