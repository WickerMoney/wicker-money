import { z } from 'zod'

/**
 * Turns off zod's just-in-time parser compilation.
 *
 * zod probes for `new Function` support so it can compile faster parsers. The
 * Content-Security-Policy the API sends has no `'unsafe-eval'`, so the browser
 * refuses that probe. zod catches it and falls back to the ordinary parser, so
 * nothing breaks, but every page load would log a CSP violation. A console
 * error that is always there is one nobody reads when a real one arrives.
 *
 * Imported for its side effect, and first in `main.tsx`, so it runs before any
 * module in the app has a chance to parse anything.
 */
z.config({ jitless: true })
