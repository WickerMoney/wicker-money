/**
 * Baked in at build time by `vite.config.ts` (`define`), from `package.json`'s
 * `version` -- which the release build stamps from the tag (see
 * `docker/stamp-version.mjs` and `.github/workflows/release.yml`). Outside a
 * release build this is whatever's checked in, normally `0.0.0`.
 */
declare const __APP_VERSION__: string
