import { defineConfig } from '@playwright/test'

/**
 * Browser tests against a running Wicker Money (normally the built image from
 * docker/docker-compose.e2e.yml). See DEVELOPMENT.md, "End-to-end tests".
 *
 * Chromium handling matches the hostile plugin suite (apps/web/browser-check/hostile):
 * the same Playwright version (pinned in package.json, one copy in the lockfile)
 * and the same browser choice. That is Playwright's FULL Chromium
 * (`channel: 'chromium'`), not the default headless shell: the plugin frame
 * handshake never completes in the shell, so the dashboard's isolated widgets
 * would not load. An explicit executable (`PW_CHROMIUM_PATH`, or `CHROMIUM_PATH`
 * as the hostile suite spells it) wins, for machines that already have one.
 * Nothing here downloads a browser: a normal `pnpm install` stays as it was.
 */
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:8080'
const chromiumPath = process.env['PW_CHROMIUM_PATH'] ?? process.env['CHROMIUM_PATH']
const hasExecutable = chromiumPath !== undefined && chromiumPath !== ''
const outputRoot = process.env['PW_OUTPUT_DIR'] ?? 'reports'
const inCi = process.env['CI'] !== undefined && process.env['CI'] !== ''

export default defineConfig({
  testDir: 'tests',
  outputDir: `${outputRoot}/results`,
  // The specs share one seeded database. They only add rows under their own
  // marker, and read the rest, but one worker keeps a failure easy to read.
  workers: 1,
  fullyParallel: false,
  retries: inCi ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: `${outputRoot}/html`, open: 'never' }],
    ['junit', { outputFile: `${outputRoot}/junit.xml` }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The seed accounts' time zone (as docs/screenshots/capture.mjs does), so
    // Settings shows no "your browser is in another zone" banner.
    timezoneId: 'UTC',
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        ...(hasExecutable ? {} : { channel: 'chromium' as const }),
        launchOptions: {
          ...(hasExecutable ? { executablePath: chromiumPath } : {}),
          // Root inside a container (the Playwright image, a cloud clone)
          // cannot use Chromium's sandbox.
          chromiumSandbox: process.env['PW_NO_SANDBOX'] !== '1',
        },
      },
    },
  ],
})
