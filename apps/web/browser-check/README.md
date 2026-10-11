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

## Insights check

`insights.ts` is the same idea for a real plugin. It runs the API against the
seeded development database (`pnpm migrate`, then `pnpm --filter
@wickermoney/api seed`), signs in as the `hero` persona and drives the real
dashboard with Insights in the page and then in a frame (it puts the plugin's id
in or out of `IN_REALM_PLUGIN_IDS` for the run, so one build serves both).

```
pnpm build
cd apps/api
AXE_PATH=/path/to/axe.min.js npx tsx --env-file=../../.env ../web/browser-check/insights.ts
```

It checks widget sizes (`sm` to `full`) at desktop and phone width, the theme
switch through the app's own control, clipped tooltips, the "Show as table" view,
the loading status region, axe, Tab order and, for a frame, what a frame below
the fold does. It also measures time to the first and last chart, heap, process
memory and the bytes each frame loads, alternating the two runtimes sample by
sample. `ONLY=measure` or `ONLY=check` runs half of it, `MODES=isolated` one
runtime, `SAMPLES=n` sets the number of timing samples, `INSIGHTS_WIDGETS=1` keeps
only the first widget (to price the second frame), `SHOTS_DIR` keeps screenshots.
`AXE_PATH` is not a dependency of the repo; install `axe-core` anywhere and point
at its `axe.min.js`.

## Hostile plugin suite (`hostile/`)

`pnpm --filter @wickermoney/web test:hostile` runs a plugin that is written to misbehave
(`hostile/fixture/Hostile.tsx`) against the real API and Chromium, next to a harmless neighbour frame, and judges every
attempt from evidence the plugin cannot forge: what a server on another origin received (HTTP, bare TCP and UDP), what the
API received (auth kind, status and a marker the fixture puts on every URL it builds), and what the browser logged
(content security policy violations, console, failed requests, new windows, and the net log for DNS).

- `specs.ts` is the table of attempts the browser must stop, with the mechanism it has to name.
- `run.ts` holds the phases: setup, credentials, blocked, broker, malformed, flood, spoof, navigation, residual, tokens and
  lifecycle. `ONLY=broker,flood pnpm --filter @wickermoney/web test:hostile` runs some while iterating.
- The channels the policy does not govern are **pinned** in `RESIDUAL_PINNED`. A browser upgrade that closes one, or opens
  another, fails the suite so the change is noticed and the ADR 0005 table is updated.
- A call made over the DevTools protocol may `eval` where a page may not, so attempts that depend on the policy run from a
  timer inside the page.
