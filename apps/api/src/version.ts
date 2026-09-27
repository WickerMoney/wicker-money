import { createRequire } from 'node:module'

/**
 * @module
 * The API's own version and the commit it was built from.
 *
 * The release workflow passes the tag's version and the commit SHA into the
 * Docker build as `VERSION`/`GIT_SHA` build-args (`.github/workflows/release.yml`).
 * `docker/stamp-version.mjs` writes `VERSION` into `apps/api/package.json`
 * before `pnpm build` runs, so reading it back here — rather than threading an
 * env var through the whole app — means there is exactly one place the number
 * is written, and it is also what `pnpm -v`, `npm ls`, etc. report on this
 * package. `GIT_SHA` has no equivalent file to live in, so it stays an env var,
 * set on the runtime image (see the Dockerfile).
 *
 * Outside a release build (local dev, CI, a plain `docker build` with no
 * --build-arg) `version` reads back whatever is checked in — normally `0.0.0`
 * — and `gitSha` is `null`. Neither is fatal; this is reporting, not a guard.
 */

/**
 * `createRequire` rather than a JSON import: it resolves identically whether
 * this module runs from `src` via `tsx` or from the compiled `dist` (both sit
 * one directory below `apps/api`, so `../package.json` reaches the same file
 * either way), and needs no `resolveJsonModule`/import-attribute setup to keep
 * in sync with the TypeScript and Node versions.
 */
const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

/** The running API's version, e.g. `1.4.2`, or `0.0.0` outside a release build. */
export const APP_VERSION: string = pkg.version

/**
 * The commit the running image was built from, or `null` when `GIT_SHA` was
 * not set at build time (local dev, or a plain `docker build` with no
 * --build-arg).
 */
export const GIT_SHA: string | null = process.env['GIT_SHA'] || null
