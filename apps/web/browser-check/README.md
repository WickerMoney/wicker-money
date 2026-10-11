# Isolated plugin browser check

Drives a real Chromium against the real API and the built web app, with a
fixture plugin that tries to break out of its frame.

```
pnpm build                                  # apps/web/dist must exist
TEST_ADMIN_DATABASE_URL=... pnpm --filter @wickermoney/web test:browser
```

It needs a PostgreSQL test database (the `TEST_*` variables the integration
tests use), a Chromium (`CHROMIUM_PATH`, default `/opt/pw-browsers/chromium`) and
`playwright-core` (`PLAYWRIGHT_CORE`, default the `playwright-core` package).
It does not download a browser. Set `BROWSER_CHECK_OUT=file.json` to keep the
report, including the frame-per-widget measurements.

It is not part of `pnpm test`: CI has no browser, and the timing numbers vary
by machine. The fixture is not a plugin to copy.
