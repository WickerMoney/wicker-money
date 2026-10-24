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
 * Imported for its side effect, and first in each entry, so it runs before any
 * module has a chance to build a schema: zod makes the `new Function` probe
 * when it builds the first object schema, not when it first parses. The entries
 * are `main.tsx` (the app's page) and `frame/main.tsx` (the sandboxed plugin
 * frame, which serves the same policy minus anything a page may do).
 *
 * zod 4.4 and later keep this setting on `globalThis`, so a plugin built with
 * its own copy of one of those, and loaded into the frame after this has run,
 * follows it. An older copy keeps its own setting and still probes.
 */
z.config({ jitless: true })
