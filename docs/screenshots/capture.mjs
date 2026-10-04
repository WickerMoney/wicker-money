// Regenerates the README screenshots in this folder, light and dark.
//
// Needs a running dev stack with seed data (see DEVELOPMENT.md):
//   pnpm --filter @wickermoney/api seed:reset
//   pnpm dev
// then, from any scratch folder outside the repo:
//   npm i playwright@1 && npx playwright install chromium
//   node <repo>/docs/screenshots/capture.mjs
//
// Optional: BASE_URL (default http://localhost:5173), OUT_DIR (default this
// folder). Shrink the output afterwards with `pngquant --ext .png --force
// --quality 80-95 docs/screenshots/*.png`, as the committed set was.
//
// Playwright is deliberately not a workspace dependency: this runs a few times
// a year, and the browser download is not worth adding to every install.

import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Resolve playwright from the current folder, so it can be installed in a
// scratch folder instead of the workspace.
async function loadPlaywright() {
  try {
    return await import('playwright')
  } catch {
    const require = createRequire(pathToFileURL(`${process.cwd()}/`).href)
    return import(pathToFileURL(require.resolve('playwright')).href)
  }
}
const playwright = await loadPlaywright()
const chromium = playwright.chromium ?? playwright.default.chromium

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT_DIR = process.env.OUT_DIR ?? dirname(fileURLToPath(import.meta.url))
// Wide enough that the Transactions table does not wrap its row actions.
const VIEWPORT = { width: 1680, height: 1000 }

// Logins from apps/api/src/db/seed/seedPersonas.ts. `hero` has the longest
// history; `household` has matching and a livelier forecast.
const SHOTS = [
  { persona: 'hero', password: 'SeedHero!2026', pages: [
    { name: 'dashboard', href: '/' },
    { name: 'insights', href: '/', scrollTo: 'Money in and out' },
    { name: 'recurring', href: '/recurring' },
    { name: 'budgets', href: '/p/wickermoney.budgets/budgets' },
    { name: 'plugins', href: '/settings', scrollTo: 'Plugins' },
  ] },
  { persona: 'household', password: 'SeedHousehold!2026', pages: [
    { name: 'transactions', href: '/transactions' },
    { name: 'forecast', href: '/p/wickermoney.forecast/forecast' },
  ] },
]

const browser = await chromium.launch()
try {
  for (const { persona, password, pages } of SHOTS) {
    for (const theme of ['light', 'dark']) {
      // UTC matches the seed accounts' time zone, so Settings shows no
      // "your browser is in another zone" banner.
      const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme, timezoneId: 'UTC' })
      await context.addInitScript(t => {
        try { globalThis.localStorage.setItem('wickermoney.theme', t) } catch { /* private mode */ }
      }, theme)
      const page = await context.newPage()
      await page.goto(BASE_URL)
      await page.getByLabel(/email/i).fill(`${persona}@seed.wickermoney.test`)
      await page.getByLabel(/password/i).first().fill(password)
      await page.getByRole('button', { name: /sign in/i }).first().click()
      await page.locator('nav a[href="/"]').first().waitFor()

      for (const shot of pages) {
        // Navigate in-app: a full page load would spend a refresh-token
        // request per shot and run into the auth rate limit.
        await page.locator(`a[href="${shot.href}"]`).first().click()
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(2000) // chart and widget mounts
        if (shot.scrollTo) {
          await page.getByRole('heading', { name: shot.scrollTo, exact: true }).first().scrollIntoViewIfNeeded()
          await page.getByRole('heading', { name: shot.scrollTo, exact: true }).first().evaluate(el => {
            const card = el.closest('section') ?? el
            globalThis.scrollBy(0, card.getBoundingClientRect().top - 24)
          })
          await page.waitForTimeout(500)
        } else {
          await page.evaluate(() => globalThis.scrollTo(0, 0))
        }
        await page.mouse.move(0, 5)
        const file = `${OUT_DIR}/${shot.name}-${theme}.png`
        await page.screenshot({ path: file })
        console.log(file)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
