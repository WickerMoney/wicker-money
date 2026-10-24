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

## Eval-violation check (`hostile/evalViolations.ts`)

The hostile fixture evals on purpose; this is the check that the code Wicker Money ships does not. `test:hostile` runs it
last. It starts the API with the bundled plugins only (no fixture), loads the dashboard with Insights and Spending Trends in
their frames, and fails on any `securitypolicyviolation` event with `blockedURI` `eval`, or any other CSP violation, from the
page or any frame. It also fails when a widget's frame or chunk never loaded, and a canary (an `eval` from a timer in each
frame) must be seen, so a broken recorder cannot read as a clean page. `EVAL_VIOLATIONS_OUT=file.json` keeps the evidence,
with the script, line and column of each violation. The cause it was written for is zod 4's `new Function("")` probe; see
`src/configureZod.ts`.

## Remote-origin check (`hostile/remote.ts`)

`test:hostile` runs it after the hostile suite. It serves a real federated build over https from a second origin (a throwaway
self-signed certificate, so it needs `openssl`), allowlists that origin, lists the build as a third-party plugin with an
integrity pin, and drives Chromium: a build that matches its pin loads in the frame and only there; a changed chunk and a
changed entry are refused before any of their code runs; an origin that is not allowlisted is blocked and receives no request;
and crafted manifests (server code, `isolated: false`, no pin, an origin that is not allowlisted) are refused or still isolated.
A frame opened by hand with no pin is covered by the unit tests (`src/frame/verifyPinnedFiles.test.ts`), because the browser only
reaches that check after the host handshake.
