/**
 * Browser check for toasts raised by real Transactions actions (ADR 0009, U1c-1).
 *
 * Starts the real API (built web app) against a seeded development database,
 * signs in as the seeded `hero` persona and drives the real Transactions page at
 * desktop and phone width, in light and dark. It does real actions (changes a
 * category, edits a merchant in the dialog, deletes a row) and checks that:
 *
 * - each says what happened, in the toast and in the announcer, and `show()`
 *   leaves focus where it was;
 * - a toast raised by saving the edit dialog is delivered after the dialog closed;
 * - axe finds nothing new with the toasts showing (it is compared with the same
 *   page before any toast, because the page itself may have findings of its own);
 * - Escape on a focused toast closes it;
 * - the real height of one-line and two-line toasts, and of a stack, is measured;
 * - with the banner stuck to the top, Shift+Tab up a long list never leaves the
 *   focused control behind the banner (the row scroll margin).
 *
 * Needs: `pnpm build` done (apps/web/dist), a migrated and seeded database
 * (`pnpm migrate`, `pnpm --filter @wickermoney/api seed`), Chromium
 * (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`) and an axe-core build
 * (`AXE_PATH`, the path of `axe.min.js`; not a dependency of the repo). Run from
 * apps/api so its dependencies resolve, with the `.env` loaded:
 *
 *   cd apps/api && AXE_PATH=/path/to/axe.min.js npx tsx --env-file=../../.env ../web/browser-check/transactionsToast.ts
 *
 * `SHOTS_DIR=dir` keeps screenshots, `BROWSER_CHECK_OUT=file.json` keeps the report
 * (checks and measurements).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'
import { buildApp } from '../../api/src/app.js'
import { loadConfig } from '../../api/src/config.js'
import { KyselyUnitOfWork } from '../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../api/src/db/configureTenantContext.js'
import { createDb } from '../../api/src/db/client.js'
import { BUNDLED_PLUGINS } from '../../api/src/plugins/bundled.js'
import { PluginService } from '../../api/src/plugins/service/PluginService.js'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AXE = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
const SHOTS = process.env['SHOTS_DIR']
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })

interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const measurements: Record<string, unknown> = {}
const measure = (name: string, value: unknown): void => { measurements[name] = value; console.log(`MEASURE ${name}  ${JSON.stringify(value)}`) }
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function startServer() {
  const config = loadConfig({
    ...process.env, NODE_ENV: 'test', WEB_DIST_DIR: dist, LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000',
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const bundled = [...BUNDLED_PLUGINS]
  const app = buildApp({ db, config, pluginOptions: { bundled } })
  await app.ready()
  await new PluginService(new KyselyUnitOfWork(db), { bundled }).seedBundled()
  await app.listen({ port: Number(process.env['PORT'] ?? 0), host: '127.0.0.1' })
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://127.0.0.1:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

async function login(base: string, email = 'hero@seed.wickermoney.test', password = 'SeedHero!2026'): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  return cookie.split(';')[0]!.split('=')[1]!
}

interface Axe { violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[] }
async function axeOf(page: Playwright.Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE) // the page's CSP refuses an injected script tag; evaluate does not go through it
  const result = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<Axe> } }).axe.run())
  return result.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.nodes.map((n) => String(n.target[0])).slice(0, 3).join(', ')}`)
}

const ALL_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, limit: 3 },
  { name: 'phone-390', width: 390, height: 844, limit: 2 },
  { name: 'phone-360', width: 360, height: 740, limit: 2 },
] as const
// `ONLY_VIEWPORTS=desktop,phone-390` and `ONLY_SCHEMES=light` narrow a run while iterating.
const VIEWPORTS = ALL_VIEWPORTS.filter((v) => process.env['ONLY_VIEWPORTS'] === undefined || process.env['ONLY_VIEWPORTS'].split(',').includes(v.name))
const SCHEMES = (['light', 'dark'] as const).filter((c) => process.env['ONLY_SCHEMES'] === undefined || process.env['ONLY_SCHEMES'].split(',').includes(c))

const LONG_MERCHANT = 'Quarterly estimated federal and state income tax payment (joint filing, second instalment)'

/** The visible toasts as a person reads them, newest first. */
const toastTexts = (page: Playwright.Page): Promise<string[]> =>
  page.locator('.wm-toast__text').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

/** The height of each visible toast and of the whole banner, in px. */
const bannerHeights = (page: Playwright.Page): Promise<{ toasts: number[]; banner: number }> =>
  page.evaluate(() => ({
    toasts: [...document.querySelectorAll('.wm-toast')].map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10),
    banner: Math.round((document.querySelector('[aria-label="Notifications"]')?.getBoundingClientRect().height ?? 0) * 10) / 10,
  }))

async function waitToast(page: Playwright.Page, text: RegExp | string): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    if ((await toastTexts(page)).some((t) => (typeof text === 'string' ? t === text : text.test(t)))) return true
    await sleep(50)
  }
  return false
}

async function run(pw: typeof Playwright, base: string): Promise<void> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  try {
    for (const vp of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        const tag = `${vp.name}/${scheme}`
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme })
        await ctx.addCookies([{ name: 'wickermoney_refresh', value: await login(base), url: base }])
        const page = await ctx.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(String(e)))
        page.on('dialog', (d) => { void d.accept() })
        const shot = async (name: string): Promise<void> => { if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}-${vp.name}-${scheme}.png`) }) }

        await page.goto(`${base}/transactions`)
        await page.locator('.txn-table tbody tr').first().waitFor()
        const rows = (): Playwright.Locator => page.locator('.txn-table tbody tr:not(.wm-table__detail)')
        const announcer = (): Promise<string> => page.evaluate(() => document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '')

        const baseline = await axeOf(page)
        check(`${tag}: no toast yet, banner not drawn`, (await page.locator('[aria-label="Notifications"]').count()) === 0)

        // 1. A category change on a row: real select, real request. Focus stays on the select.
        const select = rows().first().locator('select.cat-cell__select')
        const merchant1 = (await rows().first().locator('td[data-col="merchant"]').innerText()).trim()
        const current = await select.inputValue()
        const options = await select.locator('option').evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
        const next = options.find((o) => o.value !== '' && o.value !== current)!
        await select.focus()
        await select.selectOption(next.value)
        check(`${tag}: a category change says what it did`, await waitToast(page, `Set '${merchant1}' to ${next.text}.`), await toastTexts(page))
        check(`${tag}: the toast did not take focus from the select`, await select.evaluate((el) => el === document.activeElement))
        await sleep(200)
        measure(`${tag}: one category toast`, await bannerHeights(page))
        check(`${tag}: the announcer carries the same words`, (await announcer()).includes(`Set '${merchant1}'`), await announcer())

        // 2. Saving the edit dialog: the toast is delivered after the dialog has closed.
        const editLong = async (n: number): Promise<void> => {
          await rows().nth(n).getByRole('button', { name: 'Edit', exact: true }).click()
          const dialog = page.getByRole('dialog')
          await dialog.getByLabel('Merchant').fill(LONG_MERCHANT)
          await dialog.getByRole('button', { name: 'Save' }).click()
          await dialog.waitFor({ state: 'detached' })
        }
        await editLong(1)
        check(`${tag}: saving an edit says so after the dialog closed`, await waitToast(page, `Updated '${LONG_MERCHANT}'.`), await toastTexts(page))
        await sleep(200)
        measure(`${tag}: category toast + long edit toast`, await bannerHeights(page))

        // 3. Delete a row: names it, no Undo anywhere. Earlier toasts are closed first: on a phone only two show
        // and a third waits for a slot, because nothing is evicted.
        const dismissAll = async (): Promise<void> => {
          for (let i = 0; i < 6 && (await page.locator('.wm-toast').count()) > 0; i++) {
            const all = page.getByRole('button', { name: 'Dismiss all' })
            if (await all.count() > 0) await all.click()
            else await page.locator('.wm-toast__close').first().click()
            await sleep(120)
          }
        }
        await dismissAll()
        check(`${tag}: everything can be closed`, (await page.locator('.wm-toast').count()) === 0)
        const third = rows().nth(2)
        const merchant3 = (await third.locator('td[data-col="merchant"]').innerText()).trim()
        await third.getByRole('button', { name: 'Delete' }).click()
        check(`${tag}: a delete names what was deleted`, await waitToast(page, new RegExp(`^Deleted '${merchant3.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' \\(.+\\)\\.$`)), await toastTexts(page))
        check(`${tag}: nothing offers Undo`, (await page.getByRole('button', { name: /undo/i }).count()) === 0)
        await sleep(350)
        measure(`${tag}: one delete toast`, await bannerHeights(page))
        await shot('transactions-toast')

        // axe with the toast showing: nothing the page did not already have.
        const withToasts = await axeOf(page)
        const fresh = withToasts.filter((v) => !baseline.includes(v))
        check(`${tag}: axe finds nothing new with a toast showing (page had ${baseline.length} before)`, fresh.length === 0, fresh)
        if (baseline.length > 0) measure(`${tag}: axe before any toast`, baseline)

        // Nothing dismisses itself.
        await sleep(2000)
        check(`${tag}: nothing dismisses itself`, (await page.locator('.wm-toast').count()) === 1)

        // 4. Escape on a focused toast closes it.
        const text = (await toastTexts(page))[0]!
        await page.locator('.wm-toast__close').first().focus()
        await page.keyboard.press('Escape')
        await sleep(150)
        check(`${tag}: Escape closes the focused toast`, !(await toastTexts(page)).includes(text), await toastTexts(page))

        // 5. A full stack (every family raised, one with a long name), then the keyboard: the banner is stuck to
        // the top, and Shift+Tab up the list must not leave the focused control behind it.
        await select.selectOption(options.find((o) => o.value !== '' && o.value !== next.value)!.value)
        await editLong(3)
        await rows().nth(4).getByRole('button', { name: 'Delete' }).click()
        await sleep(500)
        const stack = await bannerHeights(page)
        measure(`${tag}: full stack (${vp.limit} show)`, { ...stack, texts: await toastTexts(page) })
        check(`${tag}: ${vp.limit} toasts at most show at once`, stack.toasts.length <= vp.limit && stack.toasts.length >= 2, stack)
        await shot('transactions-stack')
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await sleep(200)
        await rows().last().getByRole('button', { name: 'Edit', exact: true }).focus()
        let hidden: unknown = null
        let steps = 0
        const covered = (): Promise<{ id: string; top: number; bannerBottom: number; margin: string; clear: string } | null> => page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          const banner = document.querySelector('[aria-label="Notifications"]')
          if (el === null || banner === null) return null
          const bar = document.querySelector('.shell__bar') as HTMLElement | null
          const barBottom = bar !== null && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().bottom : 0
          const bannerBottom = banner.getBoundingClientRect().bottom
          const top = el.getBoundingClientRect().top
          const hiddenBehind = window.scrollY > 0 && top < Math.max(bannerBottom, barBottom) - 0.5 && !banner.contains(el)
          return hiddenBehind ? {
            id: el.getAttribute('aria-label') ?? el.tagName, top, bannerBottom,
            margin: getComputedStyle(el).scrollMarginTop, clear: document.querySelector<HTMLElement>('.txn-list')?.style.getPropertyValue('--txn-toast-clear') ?? '',
          } : null
        })
        // Up through 60 tab stops, which crosses the rows on screen and those above it.
        for (; steps < 60 && hidden === null; steps++) {
          await page.keyboard.press('Shift+Tab')
          await sleep(30)
          hidden = await covered()
        }
        check(`${tag}: Shift+Tab up the list never leaves the focus behind the banner (${steps} stops)`, hidden === null, hidden)
        await shot('transactions-keyboard')

        await ctx.close()
        check(`${tag}: no page errors`, errors.length === 0, errors)
      }
    }
  } finally { await browser.close() }
}

async function main(): Promise<void> {
  const mod = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright & { default?: typeof Playwright }
  const pw = mod.chromium === undefined && mod.default !== undefined ? mod.default : mod
  const server = await startServer()
  try { await run(pw, server.base) } finally { await server.close() }
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  console.log(JSON.stringify(measurements, null, 2))
  const report = process.env['BROWSER_CHECK_OUT']
  if (report !== undefined) writeFileSync(report, JSON.stringify({ checks, measurements }, null, 2))
  if (failed.length > 0) process.exit(1)
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
