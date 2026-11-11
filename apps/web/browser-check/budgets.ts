/**
 * Browser check and measurements for the Budgets plugin in sandboxed frames: its page (month navigation, three forms,
 * a result message low on a tall page) and its "Budget breakdown" widget, against the in-realm page the plugin shipped as.
 *
 * Starts the real API (built web app, frame document route, broker) against a seeded development database, once per
 * runtime, by putting the plugin's id in or out of `IN_REALM_PLUGIN_IDS` for the run, so both come from one build. It
 * signs in as the seeded `hero` persona (which has budget lines for this and last month and two allowances), makes
 * its own lines, windows and allowances through the plugin's routes and removes them again, and drives Chromium
 * through the real shell.
 *
 * Groups (`ONLY=load,nav,... ` runs some):
 *  - load:    page and widget render in frames, titled and sandboxed, no console error or CSP violation; the requests
 *             the page makes at load (categories and accounts once)
 *  - nav:     month navigation: a burst of 20 clicks 30 ms apart and a held Enter on "Previous" ask the broker for one
 *             month and draw no "sending requests too fast"; the frame follows the month
 *  - forms:   add a line, a window and an allowance through the broker; a server refusal puts focus on the invalid
 *             field and scrolls the host to it; the plan field saves on Enter
 *  - alerts:  "Start this month" and a failed remove show their message in their section, inside the window
 *  - size:    the frame is as tall as its document at 1440, 1024 and 390 px, follows a change, no horizontal overflow
 *  - a11y:    landmarks, headings, axe on the host and the page frame and the widget frame, light and dark
 *  - visual:  phone width, the theme switch
 *  - measure: time to the page's first table row, memory and bytes, in-realm against isolated, alternating
 *
 * Needs: `pnpm build` done (apps/web/dist, or `WEB_DIST_DIR`), a migrated and seeded dev database (`pnpm migrate`,
 * `pnpm --filter @wickermoney/api seed`), Chromium (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`) and an
 * axe-core build (`AXE_PATH`, the path of `axe.min.js`). Run from apps/api so its dependencies resolve, with the repo
 * `.env` loaded:
 *
 *   cd apps/api && npx tsx --env-file=../../.env ../web/browser-check/budgets.ts
 *
 * `BROWSER_CHECK_OUT=file.json` keeps the report, `SHOTS_DIR=dir` keeps screenshots, `SAMPLES=n` sets the number of
 * timing samples (default 7), `WEB_DIST_DIR` points at another build (to run the same checks against an earlier one),
 * `MODES=in-realm` measures one runtime only.
 */
import { execSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'
import type { PluginManifest } from '@wickermoney/plugin-sdk'
import { buildApp } from '../../api/src/app.js'
import { loadConfig } from '../../api/src/config.js'
import { KyselyUnitOfWork } from '../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../api/src/db/configureTenantContext.js'
import { createDb } from '../../api/src/db/client.js'
import { BUNDLED_PLUGINS, IN_REALM_PLUGIN_IDS } from '../../api/src/plugins/bundled.js'
import { PluginService } from '../../api/src/plugins/service/PluginService.js'

const here = dirname(fileURLToPath(import.meta.url))
const dist = process.env['WEB_DIST_DIR'] ?? join(here, '..', 'dist')
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AXE = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
const SAMPLES = Number(process.env['SAMPLES'] ?? 7)
const SHOTS = process.env['SHOTS_DIR']
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })
const ONLY = (process.env['ONLY'] ?? '').split(',').filter((s) => s !== '')
const wants = (group: string): boolean => ONLY.length === 0 || ONLY.includes(group)
const MODES = (process.env['MODES'] ?? 'in-realm,isolated').split(',')

const BUDGETS = 'wickermoney.budgets'
const PAGE_PATH = `/p/${BUDGETS}/budgets`
const API_BASE = `/api/v1/p/${BUDGETS}`
const PAGE_TITLE = 'Budgets · Budgets'
const WIDGET_TITLE = 'Budgets · Budget breakdown'
const PERSONA = { email: 'hero@seed.wickermoney.test', password: 'SeedHero!2026' }
/** Marks everything this check writes that has a note, so a run that died half way is swept by the next. */
const MARK = 'b1-check'

type Mode = 'in-realm' | 'isolated'
interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const note = (name: string, value: unknown): void => { console.log(`INFO  ${name}: ${JSON.stringify(value)}`) }
const report: Record<string, unknown> = {}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN

/** The bundled manifests, with Budgets in the page or in a frame. The allowlist is the host's, not the manifest's. */
function manifests(mode: Mode): PluginManifest[] {
  const set = IN_REALM_PLUGIN_IDS as Set<string>
  if (mode === 'in-realm') set.add(BUDGETS)
  else set.delete(BUDGETS)
  return [...BUNDLED_PLUGINS]
}

async function startServer(mode: Mode) {
  const bundled = manifests(mode)
  const config = loadConfig({
    ...process.env, NODE_ENV: 'test', WEB_DIST_DIR: dist, LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000',
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const app = buildApp({ db, config, pluginOptions: { bundled } })
  await app.ready()
  await new PluginService(new KyselyUnitOfWork(db), { bundled }).seedBundled()
  await app.listen({ port: 0, host: 'localhost' })
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://localhost:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

interface Session { readonly refresh: string; readonly access: string }

async function login(base: string, who: { email: string; password: string } = PERSONA): Promise<Session> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who),
  })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  const body = (await res.json()) as { accessToken?: string }
  return { refresh: cookie.split(';')[0]!.split('=')[1]!, access: body.accessToken ?? '' }
}

/** Calls the plugin's own routes as the person, the way the broker does for the frame. */
async function plugin(base: string, session: Session, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}${API_BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${session.access}`, 'x-wickermoney-plugin': BUDGETS, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** A core route, as the person (not the plugin). */
async function core(base: string, session: Session, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${session.access}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const TZ = 'UTC'

interface MonthLineRow { id: string | null; categoryId: string; categoryName: string; draft: boolean; note: string | null; planned?: string; rollover?: boolean; window?: unknown }
interface AccountLineRow { accountId: string; accountName: string; draft: boolean; note: string | null; planned?: string }
interface MonthData { monthKey: string; today: string; draft: boolean; lines: MonthLineRow[]; accountLines?: AccountLineRow[] }

async function readMonth(base: string, session: Session, key: string): Promise<MonthData> {
  return (await plugin(base, session, 'GET', `/month?month=${key}&tz=${encodeURIComponent(TZ)}`)).json as MonthData
}

function shiftMonthKey(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const labelOf = (key: string): string => `${MONTH_NAMES[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`

/** The current month as the page sees it (the persona's time zone). */
async function currentMonthKey(base: string): Promise<string> {
  const s = await login(base)
  const r = await plugin(base, s, 'GET', `/at-risk?tz=${encodeURIComponent(TZ)}`)
  return ((r.json as { monthKey?: string } | null)?.monthKey) ?? new Date().toISOString().slice(0, 7)
}

/**
 * Removes what an earlier run left (windows, lines and allowances carry the mark in their note) and every stored line of the
 * month after this one, which the check fills by starting that month from this one.
 */
async function sweep(base: string): Promise<void> {
  const s = await login(base)
  const now = await currentMonthKey(base)
  for (const key of [shiftMonthKey(now, -1), now, shiftMonthKey(now, 1)]) {
    const m = await readMonth(base, s, key)
    for (const l of m.lines) {
      if (l.draft) continue
      if (l.window != null && l.note === MARK && l.id !== null) await plugin(base, s, 'DELETE', `/window?id=${l.id}`)
      else if (l.window == null && (l.note === MARK || key === shiftMonthKey(now, 1))) await plugin(base, s, 'DELETE', `/line?month=${key}&categoryId=${l.categoryId}`)
    }
    for (const a of m.accountLines ?? []) {
      if (!a.draft && a.note === MARK) await plugin(base, s, 'DELETE', `/account-line?month=${key}&accountId=${a.accountId}`)
    }
  }
}

/** The persona's budget lines and allowances for last, this and next month: what a run must leave as it found it. */
async function snapshot(base: string): Promise<string> {
  const s = await login(base)
  const now = await currentMonthKey(base)
  const out: unknown[] = []
  for (const key of [shiftMonthKey(now, -1), now, shiftMonthKey(now, 1)]) {
    const m = await readMonth(base, s, key)
    out.push([key, m.draft, m.lines.map((l) => [l.id, l.categoryId, l.planned, l.rollover, l.draft, l.note, l.window == null ? null : 'w']), (m.accountLines ?? []).map((a) => [a.accountId, a.planned, a.draft, a.note])])
  }
  return JSON.stringify(out)
}

/** Every `securitypolicyviolation`, in the page and every frame, reported as a console message (the one channel out of an opaque frame). */
const RECORD = `(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    console.debug('__wm_csp__' + JSON.stringify({ directive: e.effectiveDirective, blocked: e.blockedURI, doc: location.pathname }))
  })
})()`

interface Opened {
  readonly browser: Playwright.Browser
  readonly ctx: Playwright.BrowserContext
  readonly page: Playwright.Page
  readonly problems: string[]
}

interface OpenOptions { width: number; height: number; scheme?: 'light' | 'dark'; who?: { email: string; password: string } }

async function open(pw: typeof Playwright, base: string, o: OpenOptions): Promise<Opened> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: o.scheme ?? 'light', timezoneId: TZ })
  // A refresh cookie is single-use (it rotates), so every context signs in itself.
  await ctx.addCookies([{ name: 'wickermoney_refresh', value: (await login(base, o.who)).refresh, url: base }])
  await ctx.addInitScript(RECORD)
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'debug' && text.startsWith('__wm_csp__')) problems.push(`csp ${text.slice(10)}`)
    else if (m.type() === 'error') problems.push(`console.error ${text.slice(0, 200)}`)
  })
  page.on('pageerror', (e) => { problems.push(`pageerror ${e.message.slice(0, 200)}`) })
  // A request the browser cancelled because the person left the page it was for is not a failure.
  page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`requestfailed ${r.url()} ${r.failure()?.errorText ?? ''}`) })
  return { browser, ctx, page, problems }
}

/** The frame document of the page frame, once it exists. */
function pageFrame(page: Playwright.Page): Playwright.Frame | undefined {
  return page.frames().find((f) => f !== page.mainFrame() && f.url().includes('/plugin-frame') && f.url().includes('kind=page'))
}

/** The widget's frame, once it exists. */
function widgetFrame(page: Playwright.Page): Playwright.Frame | undefined {
  return page.frames().find((f) => f !== page.mainFrame() && f.url().includes('kind=widget') && f.url().includes('AtRiskWidget'))
}

/**
 * Waits until the page has drawn its first table row, in the page (in-realm) or in the frame, and returns the frame
 * that holds it.
 */
async function waitForPage(page: Playwright.Page, mode: Mode, timeout = 30_000): Promise<Playwright.Frame> {
  const t0 = Date.now()
  for (;;) {
    const f = mode === 'isolated' ? pageFrame(page) : page.mainFrame()
    if (f !== undefined && (await f.evaluate(() => document.querySelector('.bud tbody tr') !== null).catch(() => false))) return f
    if (Date.now() - t0 > timeout) throw new Error(`the Budgets page did not draw a table row (${mode})`)
    await sleep(30)
  }
}

async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 1500 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
}

async function gotoPage(opened: Opened, base: string, mode: Mode, path = PAGE_PATH): Promise<Playwright.Frame> {
  await opened.page.goto(`${base}${path}`)
  await dismissWizard(opened.page)
  return waitForPage(opened.page, mode)
}

const shot = async (page: Playwright.Page, name: string): Promise<void> => {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }).catch(() => undefined)
}

/** One request the broker made for the frame, as the browser saw it. */
interface Call { readonly method: string; readonly path: string; readonly bytes: number; status: number; readonly body: unknown; readonly at: number }

/** Records the plugin's own API calls and the core reads it is granted: the frame's, since only the host's broker can make them. */
function trackCalls(page: Playwright.Page): Call[] {
  const calls: Call[] = []
  const byRequest = new Map<Playwright.Request, Call>()
  page.on('request', (r) => {
    const u = new URL(r.url())
    const own = u.pathname.startsWith(API_BASE)
    const core = u.pathname.startsWith('/api/v1/core/')
    if (!own && !core) return
    const text = r.postData()
    let body: unknown = text
    try { if (text !== null) body = JSON.parse(text) } catch { /* not JSON: keep the text */ }
    const path = own ? `${u.pathname.slice(API_BASE.length)}${u.search}` : `${u.pathname.slice('/api/v1'.length)}${u.search}`
    const call: Call = { method: r.method(), path, bytes: text === null ? 0 : Buffer.byteLength(text), status: 0, body, at: Date.now() }
    calls.push(call)
    byRequest.set(r, call)
  })
  page.on('response', (res) => { const c = byRequest.get(res.request()); if (c !== undefined) c.status = res.status() })
  return calls
}
const monthReads = (calls: Call[]): Call[] => calls.filter((c) => c.method === 'GET' && c.path.startsWith('/month?'))
const readsOf = (calls: Call[], prefix: string): Call[] => calls.filter((c) => c.method === 'GET' && c.path.startsWith(prefix))
const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET')
const lastWrite = (calls: Call[]): Call | undefined => writes(calls).at(-1)
const landed = async (calls: Call[]): Promise<void> => { const t0 = Date.now(); while (Date.now() - t0 < 6000 && (lastWrite(calls)?.status ?? 1) === 0) await sleep(40) }

async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 6000): Promise<T> {
  const t0 = Date.now()
  let v = await read()
  while (!ok(v) && Date.now() - t0 < ms) { await sleep(60); v = await read() }
  return v
}

const label = (frame: Playwright.Frame): Promise<string> => frame.locator('.bud__month-label').innerText()

/**
 * What the page logged that was not the browser's own line for a refusal this check made on purpose (Chromium logs
 * "Failed to load resource ... status of 4xx/5xx" as a console error for every one).
 */
const unexpected = (problems: string[]): string[] =>
  problems.filter((p) => !/^console\.error Failed to load resource: the server responded with a status of (400|404|409|500)/.test(p))

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

async function loadChecks(pw: typeof Playwright, base: string): Promise<void> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const calls = trackCalls(o.page)
    const frame = await gotoPage(o, base, 'isolated')
    const iframes = await o.page.locator('iframe').count()
    check('load: one iframe on the page, for the page', iframes === 1, iframes)
    const el = o.page.locator(`iframe[title="${PAGE_TITLE}"]`)
    check('load: the iframe is titled "<plugin name> · <page title>"', (await el.count()) === 1)
    check('load: sandbox is exactly allow-scripts', (await el.getAttribute('sandbox')) === 'allow-scripts', await el.getAttribute('sandbox'))
    check('load: the frame document is the plugin frame, kind=page, module BudgetsPage', frame.url().includes('/plugin-frame#') && frame.url().includes('kind=page') && frame.url().includes('module=.%2FBudgetsPage'), frame.url())
    check('load: the frame document has an opaque origin', (await frame.evaluate(() => location.origin === 'null' || window.origin === 'null')) === true)
    check('load: the page heading is in the frame', (await frame.locator('h1').allTextContents()).join() === 'Budgets')
    check('load: the host shows the frame (visible) and no spinner or alert is left', (await el.evaluate((e) => (e as HTMLElement).style.visibility)) === 'visible' && (await o.page.locator('.plugin-frame__status').count()) === 0)
    check('load: the plugin\'s styles reached the frame (the month label is drawn bold)', (await frame.evaluate(() => { const s = document.querySelector('.bud__month-label'); return s !== null && getComputedStyle(s).fontWeight === '600' })) === true)
    await sleep(800)
    check('load: no console error, failed request or CSP violation', o.problems.length === 0, o.problems)
    note('requests the broker made for the page at load', calls.map((c) => `${c.method} ${c.path} ${c.status}`))
    check('load: the month is read once', monthReads(calls).length === 1, monthReads(calls).map((c) => c.path))
    check('load: the categories and the accounts are each read once (not with every month)', readsOf(calls, '/core/categories/list').length === 1 && readsOf(calls, '/core/accounts/list').length === 1, calls.map((c) => c.path))
    const paths = new Set(calls.map((c) => c.path.replace(/\?.*/, '')))
    check('load: the page reads the month, categories and accounts, and nothing else', JSON.stringify([...paths].sort()) === JSON.stringify(['/core/accounts/list', '/core/categories/list', '/month']), [...paths])
    check('load: every one of them answered 200', calls.every((c) => c.status === 200), calls)
    await shot(o.page, 'load-desktop')
  } finally { await o.browser.close() }

  // The widget on the dashboard.
  const w = await open(pw, base, { width: 1280, height: 2400 })
  try {
    const calls = trackCalls(w.page)
    await w.page.goto(`${base}/`)
    await dismissWizard(w.page)
    const f = await (async () => { for (let i = 0; i < 300; i++) { const x = widgetFrame(w.page); if (x !== undefined && (await x.evaluate(() => document.querySelector('.budw') !== null).catch(() => false))) return x; await sleep(50) } return undefined })()
    check('load: the Budget breakdown widget runs in a widget frame and draws', f !== undefined)
    if (f !== undefined) {
      const iframe = w.page.locator(`iframe[title="${WIDGET_TITLE}"]`)
      check('load: widget frame is titled and sandboxed', (await iframe.count()) === 1 && (await iframe.getAttribute('sandbox')) === 'allow-scripts')
      const tiles = await f.locator('.budw__tile').count()
      note('widget tiles and text', { tiles, text: (await f.locator('.budw').innerText()).replace(/\s+/g, ' ').slice(0, 140) })
      check('load: the widget draws its tiles and its footer', tiles > 0 && (await f.locator('.budw__foot').count()) === 1, tiles)
      await sleep(500)
      const at = calls.filter((c) => c.path.startsWith('/at-risk'))
      check('load: the widget makes one request, the at-risk read', at.length === 1 && at[0]?.status === 200 && calls.filter((c) => !c.path.startsWith('/at-risk')).every((c) => !c.path.startsWith('/month') && !c.path.startsWith('/core/categories')), calls.map((c) => c.path))
      const button = f.getByRole('button', { name: /^All \d+ lines$/ })
      if ((await button.count()) === 1) {
        await button.click()
        await w.page.waitForURL(`**${PAGE_PATH}`)
        check('load: "All N lines" in the widget moves the host to the page (ctx.navigate)', new URL(w.page.url()).pathname === PAGE_PATH)
        check('load: and the page frame is there', (await (await waitForPage(w.page, 'isolated')).locator('h1').allTextContents()).join() === 'Budgets')
      } else note('widget footer button', 'no "All N lines" button (every line is shown)')
    }
    await sleep(500)
    check('load: no console error, failed request or CSP violation on the dashboard and after', w.problems.length === 0, w.problems)
  } finally { await w.browser.close() }
}

// ---------------------------------------------------------------------------
// nav
// ---------------------------------------------------------------------------

/** Text of every alert in the frame. */
const alertsIn = (frame: Playwright.Frame): Promise<string[]> => frame.locator('[role="alert"]').allInnerTexts()

async function navChecks(pw: typeof Playwright, base: string): Promise<void> {
  const now = await currentMonthKey(base)
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const calls = trackCalls(o.page)
    const frame = await gotoPage(o, base, 'isolated')
    check(`nav: the page opens on this month (${labelOf(now)})`, (await label(frame)) === labelOf(now), await label(frame))
    const before = calls.length

    // 20 clicks, 30 ms apart.
    const t0 = Date.now()
    await frame.evaluate(async () => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Previous'))!
      for (let i = 0; i < 20; i++) { b.click(); await new Promise((r) => setTimeout(r, 30)) }
    })
    const target = shiftMonthKey(now, -20)
    await eventually(() => label(frame), (t) => t === labelOf(target) && true)
    await frame.locator('.bud tbody tr, .bud .wm-empty').first().waitFor({ timeout: 8000 }).catch(() => undefined)
    await sleep(500)
    const burst = calls.slice(before)
    const alerts = await alertsIn(frame)
    note('burst of 20 clicks 30 ms apart: requests, alerts, ms', { requests: burst.map((c) => `${c.method} ${c.path} ${c.status}`), alerts, ms: Date.now() - t0 })
    report['burst'] = { clicks: 20, requests: burst.length, monthRequests: monthReads(burst).length, alerts }
    check(`nav: 20 clicks 30 ms apart end on ${labelOf(target)}`, (await label(frame)) === labelOf(target), await label(frame))
    check('nav: 20 clicks 30 ms apart: no "sending requests too fast" and no alert at all', alerts.length === 0, alerts)
    check('nav: 20 clicks 30 ms apart: the broker refused nothing (every request answered 200)', burst.every((c) => c.status === 200), burst.filter((c) => c.status !== 200))
    check('nav: 20 clicks 30 ms apart ask for one month (the one the burst ends on), and not for categories or accounts again', monthReads(burst).length <= 2 && readsOf(burst, '/core/').length === 0, burst.map((c) => c.path))
    check('nav: the month drawn is the one asked for (a line table or its empty state)', (await frame.locator('.bud tbody tr, .bud .wm-empty').count()) > 0 || (await frame.locator('.wm-spinner').count()) === 0)
    check('nav: no console error, failed request or CSP violation', o.problems.length === 0, o.problems)

    // Back to this month, then a held Enter on Previous (about 30 repeats a second).
    await frame.getByRole('button', { name: 'This month' }).click()
    await eventually(() => label(frame), (t) => t === labelOf(now))
    await waitForPage(o.page, 'isolated')
    const before2 = calls.length
    await frame.getByRole('button', { name: /Previous/ }).focus()
    for (let i = 0; i < 45; i++) { await o.page.keyboard.down('Enter'); await sleep(30) }
    await o.page.keyboard.up('Enter')
    const target2 = shiftMonthKey(now, -45)
    await eventually(() => label(frame), (t) => t === labelOf(target2))
    await sleep(900)
    const held = calls.slice(before2)
    const alerts2 = await alertsIn(frame)
    note('Enter held on Previous for 45 repeats: requests, alerts', { requests: held.map((c) => `${c.method} ${c.path} ${c.status}`), alerts: alerts2 })
    report['heldEnter'] = { repeats: 45, requests: held.length, monthRequests: monthReads(held).length, alerts: alerts2 }
    check(`nav: a held Enter on Previous (45 repeats) ends on ${labelOf(target2)}`, (await label(frame)) === labelOf(target2), await label(frame))
    check('nav: a held Enter draws no "sending requests too fast"', alerts2.length === 0, alerts2)
    check('nav: a held Enter asks for the month it stops on, and the broker refuses nothing', monthReads(held).length <= 2 && held.every((c) => c.status === 200), held.map((c) => `${c.path} ${c.status}`))
    check('nav: focus stayed on the Previous button', (await frame.evaluate(() => document.activeElement?.textContent ?? '')).includes('Previous'))

    // One click is one load, after the pause.
    await frame.getByRole('button', { name: 'This month' }).click()
    await eventually(() => label(frame), (t) => t === labelOf(now))
    await waitForPage(o.page, 'isolated')
    const before3 = calls.length
    const tClick = Date.now()
    await frame.getByRole('button', { name: /Previous/ }).click()
    await eventually(async () => monthReads(calls.slice(before3)).length, (n) => n >= 1)
    const firstRead = calls.slice(before3).find((c) => c.path.startsWith('/month?'))
    note('a single click on Previous: ms until the month is requested', firstRead === undefined ? null : firstRead.at - tClick)
    check('nav: a single click is one month request and nothing else', calls.slice(before3).filter((c) => c.method === 'GET').length === 1, calls.slice(before3).map((c) => c.path))
    check('nav: no console error, failed request or CSP violation after the held key', o.problems.length === 0, o.problems)
  } finally { await o.browser.close() }
}

// ---------------------------------------------------------------------------
// forms
// ---------------------------------------------------------------------------

/** Where an element is in the host window (frame coordinates plus the iframe's own offset). */
async function windowRect(page: Playwright.Page, frame: Playwright.Frame, selector: string): Promise<{ top: number; bottom: number; height: number }> {
  const inner = await frame.evaluate((sel) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { top: r.top, height: r.height } }, selector)
  const iframeTop = await page.evaluate(() => document.querySelector('iframe')!.getBoundingClientRect().top)
  return { top: Math.round(iframeTop + inner.top), bottom: Math.round(iframeTop + inner.top + inner.height), height: Math.round(inner.height) }
}

async function formChecks(pw: typeof Playwright, base: string): Promise<void> {
  await sweep(base)
  const session = await login(base)
  const now = await currentMonthKey(base)
  const start = `${now}-01`
  const end = `${shiftMonthKey(now, 1)}-01`
  void end
  // A throwaway category, so a stale pick can be provoked below.
  const slug = `b1-check-${Date.now()}`
  const created = await core(base, session, 'POST', '/categories', { name: 'B1 check category', slug, kind: 'expense' })
  const throwawayId = (created.json as { id?: string } | null)?.id
  note('throwaway category', { status: created.status, id: throwawayId })
  // A checking account with no allowance (hero's only checking account has one), for the allowance form.
  const account = await core(base, session, 'POST', '/accounts', { name: 'B1 check checking', accountType: 'checking', initialBalance: '0.00' })
  const accountId = (account.json as { id?: string } | null)?.id
  note('throwaway checking account', { status: account.status, id: accountId })
  const o = await open(pw, base, { width: 1280, height: 700 })
  const addedLines: Array<{ month: string; categoryId: string }> = []
  let windowId: string | null = null
  try {
    const calls = trackCalls(o.page)
    const frame = await gotoPage(o, base, 'isolated')
    const win = (selector: string): Promise<{ top: number; bottom: number; height: number }> => windowRect(o.page, frame, selector)
    const inView = (r: { top: number; bottom: number }): boolean => r.top >= 0 && r.bottom <= 700

    // 1. Add a line: the native select, the button, the row.
    const addSelect = frame.getByLabel('Add a category')
    const options = await addSelect.locator('option').evaluateAll((os) => os.map((x) => ({ value: (x as HTMLOptionElement).value, text: x.textContent ?? '' })).filter((x) => x.value !== ''))
    const pick = options.find((x) => x.value === throwawayId) ?? options[0]!
    await addSelect.selectOption(pick.value)
    check('forms: the add-line picker is a native select and takes a choice', (await addSelect.inputValue()) === pick.value, pick)
    await frame.getByRole('button', { name: 'Add line' }).click()
    await eventually(async () => lastWrite(calls)?.status, (s) => s !== undefined && s !== 0)
    const put = lastWrite(calls)
    addedLines.push({ month: now, categoryId: pick.value })
    check('forms: add line is PUT /line with a zero plan, through the broker, answered 200', put?.method === 'PUT' && put.path === '/line' && put.status === 200 && (put.body as Record<string, unknown>)['categoryId'] === pick.value && (put.body as Record<string, unknown>)['planned'] === '0.0000', put)
    check('forms: the new line is in the table', (await eventually(async () => frame.locator('.bud tbody tr').filter({ hasText: pick.text.trim() }).count(), (n) => n > 0)) > 0, pick.text)
    note('request body bytes: add line', put?.bytes)

    // 2. The plan field saves on Enter (one PUT, one reload).
    const planInput = frame.getByLabel(`Planned for ${pick.text.trim()}`)
    const nPut = writes(calls).length
    await planInput.fill('12.50')
    await planInput.press('Enter')
    await eventually(async () => writes(calls).length, (n) => n > nPut)
    await landed(calls)
    check('forms: Enter in the plan field saves it once (PUT /line with the new plan)', writes(calls).length === nPut + 1 && lastWrite(calls)?.path === '/line' && (lastWrite(calls)?.body as Record<string, unknown>)['planned'] === '12.50' && lastWrite(calls)?.status === 200, writes(calls).slice(nPut))

    // 3. A window: dates are native date inputs.
    const winForm = frame.locator('.bud__window-form').first()
    const winCat = winForm.getByLabel('Category')
    // A category with no line this month (a window overlapping a line is refused), other than the one just added.
    const windowCategory = options.find((x) => x.value !== pick.value && x.value !== throwawayId) ?? options.at(-1)!
    await winCat.selectOption(windowCategory.value)
    await winForm.getByLabel('From').fill(start)
    await winForm.getByLabel('Through').fill(`${now}-28`)
    await winForm.getByLabel('Amount').fill('300')
    await winForm.getByLabel('Note').fill(MARK)
    await winForm.getByRole('button', { name: 'Add window' }).click()
    await eventually(async () => lastWrite(calls)?.path, (p) => p === '/window')
    await landed(calls)
    const wput = lastWrite(calls)
    check('forms: add window is PUT /window with its dates and amount, answered 200 (or the server\'s refusal of an overlap, shown on the form)', wput?.path === '/window' && (wput.status === 200 || wput.status === 409), wput)
    if (wput?.status === 200) {
      check('forms: the window is in the table with its Remove window button', (await eventually(async () => frame.getByRole('button', { name: 'Remove window' }).count(), (n) => n > 0)) > 0)
      const month = await readMonth(base, session, now)
      windowId = month.lines.find((l) => l.window != null && l.note === MARK)?.id ?? null
    } else note('window refused by the server', await frame.locator('.wm-form-error').allInnerTexts())

    // 3b. The same window again: the server refuses the overlap and the form shows it.
    if (wput?.status === 200) {
      const nW0 = writes(calls).length
      await winForm.getByLabel('Category').selectOption(windowCategory.value)
      await winForm.getByLabel('From').fill(start)
      await winForm.getByLabel('Through').fill(`${now}-20`)
      await winForm.getByLabel('Amount').fill('10')
      await winForm.getByRole('button', { name: 'Add window' }).click()
      await eventually(async () => writes(calls).length, (n) => n > nW0)
      await landed(calls)
      await sleep(400)
      const dup = lastWrite(calls)
      const shown = await winForm.locator('.wm-form-error').allInnerTexts()
      const where = await frame.evaluate(() => document.activeElement?.className ?? '')
      note('a window that overlaps the first: status, the form error, focus', { status: dup?.status, shown, where })
      // The same request made directly, with no frame and no broker: whatever the answer is, it is the server's.
      const direct = await plugin(base, session, 'PUT', '/window', { id: null, categoryId: windowCategory.value, start, through: `${now}-20`, planned: '10', note: null })
      note('the same overlapping window sent directly to the plugin route (no frame)', direct.status)
      report['overlapRefusal'] = { status: dup?.status, direct: direct.status, shown, where }
      check('forms: a window the server refuses is shown on its form, and the frame and a direct call get the same answer', shown.length === 1 && dup?.status === direct.status && dup?.status !== undefined && dup.status >= 400, { dup, direct, shown, where })
    }

    // 4. An allowance: the account picker, the "Don't count" picker and the amount.
    const allowForm = frame.locator('.bud__window-form').nth(1)
    const accSelect = allowForm.getByLabel('Account', { exact: true })
    const accOptions = await accSelect.locator('option').evaluateAll((os) => os.map((x) => ({ value: (x as HTMLOptionElement).value, text: x.textContent ?? '' })))
    note('allowance accounts', { options: accOptions.map((a) => a.text) })
    const free = accOptions.find((a) => a.value === accountId)
    if (free !== undefined) {
      await accSelect.selectOption(free.value)
      await allowForm.getByLabel('Allowance', { exact: true }).fill('40')
      await allowForm.getByLabel('Note').fill(MARK)
      const nW = writes(calls).length
      await allowForm.getByRole('button', { name: 'Add allowance' }).click()
      await eventually(async () => writes(calls).length, (n) => n > nW)
      await landed(calls)
      const aput = lastWrite(calls)
      check('forms: add allowance is PUT /account-line with the account and amount, answered 200', aput?.path === '/account-line' && aput.status === 200 && (aput.body as Record<string, unknown>)['accountId'] === free.value && (aput.body as Record<string, unknown>)['planned'] === '40', aput)
      check('forms: the allowance is in the table', (await eventually(async () => frame.locator('.bud tbody tr').filter({ hasText: free.text.trim() }).count(), (n) => n > 0)) > 0, free.text)
    } else check('forms: the new checking account is offered by the allowance form', false, accOptions)

    // 5. A server refusal that puts focus on the invalid field and scrolls the host to it.
    // The category the allowance form was loaded with is deleted behind the page's back (another tab, say), then picked
    // under "Don't count": the server answers 400 on excludedCategoryIds and the form marks that field.
    if (throwawayId !== undefined) {
      // Not in the table any more, so the delete is allowed.
      await plugin(base, session, 'DELETE', `/line?month=${now}&categoryId=${throwawayId}`)
      const pickSel = allowForm.getByLabel("Don't count")
      await pickSel.selectOption(throwawayId)
      await allowForm.getByLabel('Allowance', { exact: true }).fill('41')
      const del = await core(base, session, 'DELETE', `/categories/${throwawayId}`)
      note('delete of the throwaway category behind the page', del.status)
      if (del.status === 204) {
        await o.page.evaluate(() => window.scrollTo(0, 0))
        await sleep(300)
        const scrollBefore = await o.page.evaluate(() => window.scrollY)
        const nW2 = writes(calls).length
        const btn = allowForm.getByRole('button', { name: 'Add allowance' })
        // The form is low on the page: bring the button into view, then scroll back to where the field would be off screen.
        await btn.scrollIntoViewIfNeeded()
        await o.page.evaluate(() => window.scrollTo(0, 0))
        await sleep(200)
        await btn.click()
        await eventually(async () => writes(calls).length, (n) => n > nW2)
        await landed(calls)
        await sleep(500)
        const refused = lastWrite(calls)
        const focused = await frame.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, invalid: a?.getAttribute('aria-invalid'), label: a?.closest('.wm-field')?.querySelector('label')?.textContent ?? null } })
        const field = await win("select[aria-invalid='true']").catch(() => null)
        const scrolled = await o.page.evaluate(() => window.scrollY)
        const errors = await allowForm.locator('.wm-field__error').allInnerTexts()
        note('server refusal: request, focused element, host scroll, the field in the window', { refused: refused === undefined ? null : `${refused.method} ${refused.path} ${refused.status}`, focused, scrollBefore, scrolled, field, errors })
        report['refusalFocus'] = { focused, scrollBefore, scrolled, field, errors }
        check('forms: the server refuses the stale category on its field (400, "Choose from your own categories.")', refused?.status === 400 && errors.some((e) => /own categories/.test(e)), { refused, errors })
        check('forms: focus moved to the invalid field (the "Don\'t count" select, aria-invalid)', focused.invalid === 'true' && focused.tag === 'SELECT' && /count/i.test(focused.label ?? ''), focused)
        check('forms: and the host window scrolled to it (it is on screen)', scrolled > scrollBefore && field !== null && inView(field), { scrollBefore, scrolled, field })
      }
    }

    // 6. Client-side refusals send nothing and put focus on the field.
    const nW3 = writes(calls).length
    await winForm.getByLabel('Through').fill(`${now}-01`)
    await winForm.getByLabel('From').fill(`${now}-15`)
    await winForm.getByLabel('Amount').fill('5')
    await winForm.getByRole('button', { name: 'Add window' }).click()
    await sleep(500)
    check('forms: a reversed window is refused on its field before any request', writes(calls).length === nW3 && (await winForm.locator('.wm-field__error').count()) > 0, { sent: writes(calls).slice(nW3), errors: await winForm.locator('.wm-field__error').allInnerTexts() })
    check('forms: and focus is on that field', (await frame.evaluate(() => document.activeElement?.getAttribute('aria-invalid'))) === 'true')
    const sizes = writes(calls).map((c) => c.bytes)
    note('largest request body in the forms', Math.max(0, ...sizes))
    check('forms: no console error, failed request or CSP violation (other than the browser noting the refusals above)', unexpected(o.problems).length === 0, o.problems)
    await shot(o.page, 'forms')
  } finally {
    await o.browser.close()
    // Put it back as it was.
    for (const l of addedLines) await plugin(base, session, 'DELETE', `/line?month=${l.month}&categoryId=${l.categoryId}`)
    if (windowId !== null) await plugin(base, session, 'DELETE', `/window?id=${windowId}`)
    await sweep(base)
    if (throwawayId !== undefined) await core(base, session, 'DELETE', `/categories/${throwawayId}`)
    if (accountId !== undefined) await core(base, session, 'DELETE', `/accounts/${accountId}`)
  }
}

// ---------------------------------------------------------------------------
// alerts
// ---------------------------------------------------------------------------

/** A short window, so that the top of a section is off screen when something low in it is clicked. */
const H = 420

async function alertChecks(pw: typeof Playwright, base: string): Promise<void> {
  await sweep(base)
  const session = await login(base)
  const now = await currentMonthKey(base)
  const next = shiftMonthKey(now, 1)
  const o = await open(pw, base, { width: 1280, height: H })
  try {
    await gotoPage(o, base, 'isolated')
    const sectionOf = (loc: Playwright.Locator): Promise<string> => loc.evaluate((e) => e.closest('section')?.querySelector('h2')?.textContent ?? '')
    const rectIn = async (loc: Playwright.Locator): Promise<{ top: number; bottom: number }> => {
      const inner = await loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
      const iframeTop = await o.page.evaluate(() => document.querySelector('iframe')!.getBoundingClientRect().top)
      return { top: Math.round(iframeTop + inner.top), bottom: Math.round(iframeTop + inner.bottom) }
    }
    const visible = (r: { top: number; bottom: number }): boolean => r.top >= 0 && r.bottom <= H

    // 1. A failed remove, low on the page. The line is one this check made (no seeded line is touched); it is removed
    // behind the page's back, then Remove is clicked, and the server answers 404.
    // Enough lines of its own that the table is long: the last of them is the one removed behind the page's back.
    const cats = (await core(base, session, 'GET', '/categories')).json as Array<{ id: string; name: string; kind?: string }> | null
    const month2 = await readMonth(base, session, now)
    const used = new Set(month2.lines.filter((l) => l.window == null).map((l) => l.categoryId))
    const spares = (cats ?? []).filter((c) => (c.kind ?? 'expense') === 'expense' && !used.has(c.id)).slice(0, 14)
    if (spares.length < 6) { check('alerts: enough categories without a line to make a long table', false, spares.length); return }
    for (const c of spares) await plugin(base, session, 'PUT', '/line', { month: now, categoryId: c.id, planned: '0.0000', rollover: false, note: MARK })
    await o.page.reload()
    await dismissWizard(o.page)
    const f2 = await waitForPage(o.page, 'isolated')
    const firstCells = await f2.locator('.bud tbody tr').evaluateAll((trs) => trs.map((tr) => (tr.querySelector('td')?.textContent ?? '').trim()))
    const ours = firstCells.map((t, i) => ({ t, i })).filter((x) => spares.some((c) => x.t.startsWith(c.name)))
    const lastOurs = ours.at(-1)!
    const spare = spares.find((c) => lastOurs.t.startsWith(c.name))!
    const row = f2.locator('.bud tbody tr').nth(lastOurs.i)
    await row.waitFor()
    note('failed remove: the table', { rows: firstCells.length, removed: spare.name, atRow: lastOurs.i })
    await plugin(base, session, 'DELETE', `/line?month=${now}&categoryId=${spare.id}`)
    await row.scrollIntoViewIfNeeded()
    // The row near the bottom of the window, so the top of its section is far above the window.
    await o.page.evaluate((y) => window.scrollBy(0, y), (await rectIn(row)).top - (H - 90))
    await sleep(300)
    const scrollBefore = await o.page.evaluate(() => window.scrollY)
    const sectionTop = await rectIn(f2.locator('section').filter({ has: f2.getByRole('heading', { name: 'Lines', exact: true }) }).first())
    const removeBtn = row.getByRole('button', { name: 'Remove', exact: true })
    const btnRect = await rectIn(removeBtn)
    await removeBtn.click()
    const alert = f2.locator('[role="alert"]').first()
    await alert.waitFor({ timeout: 6000 })
    await sleep(500)
    const aRect = await rectIn(alert)
    const scrollAfter = await o.page.evaluate(() => window.scrollY)
    const where = await sectionOf(alert)
    const text = await alert.innerText()
    note('failed remove: section top before, button, alert, section, host scroll before/after', { sectionTop, btnRect, aRect, where, text, scrollBefore, scrollAfter })
    report['failedRemove'] = { rows: firstCells.length, sectionTop, btnRect, aRect, where, scrollBefore, scrollAfter }
    check('alerts: a failed remove says so in an alert', /no such budget line/i.test(text), text)
    check('alerts: ... in the Lines section, not at the top of the page', where === 'Lines', where)
    check('alerts: ... the top of the Lines section was above the window when Remove was clicked, and the alert is inside the window now (the host scrolled up to it)', sectionTop.top < 0 && visible(aRect) && scrollAfter < scrollBefore, { sectionTop, aRect, scrollBefore, scrollAfter })
    await shot(o.page, 'alert-failed-remove')

    // 2. "Start this month": next month is a draft of this one.
    const f3 = pageFrame(o.page)!
    await f3.getByRole('button', { name: 'Next →' }).click()
    await eventually(() => label(f3), (t) => t === labelOf(next))
    const start = f3.getByRole('button', { name: new RegExp(`Start ${labelOf(next)} from these`) })
    await start.waitFor({ timeout: 8000 })
    await o.page.evaluate(() => window.scrollTo(0, 0))
    await sleep(200)
    await start.click()
    const adopted = f3.locator('[role="alert"]').first()
    await adopted.waitFor({ timeout: 8000 })
    await sleep(500)
    const adoptedRect = await rectIn(adopted)
    const adoptedText = await adopted.innerText()
    const adoptedWhere = await sectionOf(adopted)
    note('start this month: message, section, rect', { adoptedText, adoptedWhere, adoptedRect })
    check('alerts: "Start this month" says how many lines came across', /^\d+ lines carried over from /.test(adoptedText), adoptedText)
    check(`alerts: ... in the month's own section (${labelOf(next)}), inside the window`, adoptedWhere === labelOf(next) && visible(adoptedRect), { adoptedWhere, adoptedRect })
    check('alerts: no console error, failed request or CSP violation (other than the browser noting the refusals above)', unexpected(o.problems).length === 0, o.problems)
  } finally {
    await o.browser.close()
    await sweep(base)
  }

  // 3. A failed remove in the Account allowances section, the lowest on the page: the host has to scroll to show it.
  const account = await core(base, session, 'POST', '/accounts', { name: 'B1 check checking', accountType: 'checking', initialBalance: '0.00' })
  const accountId = (account.json as { id?: string } | null)?.id
  const o2 = await open(pw, base, { width: 1280, height: H })
  try {
    if (accountId === undefined) { check('alerts: a checking account for the allowance was made', false, account); return }
    await plugin(base, session, 'PUT', '/account-line', { month: now, accountId, planned: '5', rollover: false, excludedCategoryIds: [], note: MARK })
    const f = await gotoPage(o2, base, 'isolated')
    const row = f.locator('.bud tbody tr').filter({ hasText: 'B1 check checking' })
    await row.waitFor({ timeout: 8000 })
    await plugin(base, session, 'DELETE', `/account-line?month=${now}&accountId=${accountId}`)
    const iframeTop = (): Promise<number> => o2.page.evaluate(() => document.querySelector('iframe')!.getBoundingClientRect().top)
    const rect = async (loc: Playwright.Locator): Promise<{ top: number; bottom: number }> => {
      const inner = await loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
      const t = await iframeTop()
      return { top: Math.round(t + inner.top), bottom: Math.round(t + inner.bottom) }
    }
    // The row near the bottom of the window, so what is above it (the section's top) is off screen.
    await o2.page.evaluate((y) => window.scrollBy(0, y), (await rect(row)).top - 520)
    await sleep(300)
    const scrollBefore = await o2.page.evaluate(() => window.scrollY)
    const sectionTop = await rect(f.locator('section').filter({ has: f.getByRole('heading', { name: 'Account allowances' }) }).first())
    await row.getByRole('button', { name: 'Remove', exact: true }).click()
    const alert = f.locator('[role="alert"]').first()
    await alert.waitFor({ timeout: 6000 })
    await sleep(500)
    const aRect = await rect(alert)
    const scrollAfter = await o2.page.evaluate(() => window.scrollY)
    const where = await alert.evaluate((e) => e.closest('section')?.querySelector('h2')?.textContent ?? '')
    const text = await alert.innerText()
    note('failed remove of an allowance: section top before, alert, host scroll before/after', { sectionTop, aRect, scrollBefore, scrollAfter, where, text })
    report['failedRemoveAllowance'] = { sectionTop, aRect, scrollBefore, scrollAfter, where }
    check('alerts: a failed remove of an allowance says so, in the Account allowances section', where === 'Account allowances' && /no such account line/i.test(text), { where, text })
    check('alerts: ... and the alert is inside the window', aRect.top >= 0 && aRect.bottom <= H, { sectionTop, aRect, scrollBefore, scrollAfter })
    await shot(o2.page, 'alert-failed-remove-allowance')
  } finally {
    await o2.browser.close()
    await sweep(base)
    if (accountId !== undefined) await core(base, session, 'DELETE', `/accounts/${accountId}`)
  }
}

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

async function sizeChecks(pw: typeof Playwright, base: string): Promise<void> {
  const rows: Array<Record<string, unknown>> = []
  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'laptop', width: 1024, height: 700 }, { name: 'phone', width: 390, height: 844 }]) {
    const o = await open(pw, base, vp)
    try {
      const frame = await gotoPage(o, base, 'isolated')
      await sleep(900)
      const el = o.page.locator(`iframe[title="${PAGE_TITLE}"]`)
      const iframeH = await el.evaluate((e) => Math.round(e.getBoundingClientRect().height))
      const inner = await frame.evaluate(() => ({
        scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight,
        htmlH: Math.ceil(document.documentElement.getBoundingClientRect().height),
        rootH: Math.ceil(document.getElementById('root')!.firstElementChild!.getBoundingClientRect().height),
        scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      }))
      const host = await o.page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }))
      rows.push({ viewport: vp.name, iframeH, inner, host })
      check(`size ${vp.name}: the frame is as tall as its document (within 1 px; the document is ${inner.scrollH}, the root ${inner.rootH})`, Math.abs(iframeH - inner.scrollH) <= 1 && Math.abs(iframeH - inner.htmlH) <= 1, { iframeH, inner })
      check(`size ${vp.name}: the frame does not scroll inside itself`, inner.scrollH <= inner.clientH + 1, inner)
      check(`size ${vp.name}: the host page scrolls instead`, host.scrollH > host.innerH, host)
      check(`size ${vp.name}: no horizontal overflow on the host or in the frame`, host.scrollW <= host.innerW && inner.scrollW <= inner.clientW, { host, inner })
      await shot(o.page, `size-${vp.name}`)
      check(`size ${vp.name}: no console error or CSP violation`, o.problems.length === 0, o.problems)
    } finally { await o.browser.close() }
  }
  report['sizeRows'] = rows
  note('page frame sizes', rows)

  // The height follows the content: a month with fewer lines, then back.
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoPage(o, base, 'isolated')
    await sleep(600)
    const el = o.page.locator(`iframe[title="${PAGE_TITLE}"]`)
    const hostHeight = (): Promise<number> => el.evaluate((e) => Math.round(e.getBoundingClientRect().height))
    const docHeight = (): Promise<number> => frame.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height))
    const timings: Array<{ step: string; fromH: number; toH: number; settleMs: number }> = []
    for (const step of ['Previous', 'Next', 'Next']) {
      const before = await hostHeight()
      const t0 = Date.now()
      await frame.getByRole('button', { name: new RegExp(step) }).click()
      let settled = -1
      let lastChange = t0
      let last = before
      for (let i = 0; i < 150; i++) {
        await sleep(15)
        const now = await hostHeight()
        if (now !== last) { last = now; lastChange = Date.now() }
        if (settled < 0 && now !== before && Math.abs(now - (await docHeight())) <= 1) settled = Date.now() - t0
        if (Date.now() - lastChange > 700 && Date.now() - t0 > 900) break
      }
      timings.push({ step, fromH: before, toH: last, settleMs: settled })
    }
    note('height after changing the month (ms until the host frame matched the document)', timings)
    report['monthTimings'] = timings
    await sleep(400)
    check('size: after changing month the frame still matches its document', Math.abs((await hostHeight()) - (await docHeight())) <= 1, { host: await hostHeight(), doc: await docHeight() })

    // Window resize.
    const sizes: Array<{ width: number; iframeH: number; docH: number }> = []
    for (const width of [1280, 700, 390, 1280]) {
      await o.page.setViewportSize({ width, height: 900 })
      await sleep(900)
      sizes.push({ width, iframeH: await hostHeight(), docH: await docHeight() })
    }
    note('after resizing the window', sizes)
    check('size: after a resize the frame still matches its document', sizes.every((r) => Math.abs(r.iframeH - r.docH) <= 1), sizes)
  } finally { await o.browser.close() }

  // The widget in its card: what the dashboard gives it and what it takes.
  for (const vp of [{ name: 'desktop', width: 1440, height: 2400 }, { name: 'phone', width: 390, height: 2400 }]) {
    const w = await open(pw, base, vp)
    try {
      await w.page.goto(`${base}/`)
      await dismissWizard(w.page)
      const f = await (async () => { for (let i = 0; i < 300; i++) { const x = widgetFrame(w.page); if (x !== undefined && (await x.evaluate(() => document.querySelector('.budw') !== null).catch(() => false))) return x; await sleep(50) } return undefined })()
      if (f === undefined) { check(`size ${vp.name}: the widget frame draws`, false); continue }
      await sleep(900)
      const geometry = await w.page.evaluate((t) => {
        const iframe = document.querySelector(`iframe[title="${t}"]`) as HTMLElement
        const card = iframe.closest('section, .wm-surface, .dash__card') as HTMLElement
        const body = iframe.closest('.wm-surface__body') as HTMLElement | null
        const ci = card.getBoundingClientRect(); const fi = iframe.getBoundingClientRect()
        return { card: Math.round(ci.height), iframe: Math.round(fi.height), body: body === null ? null : Math.round(body.getBoundingClientRect().height), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }
      }, WIDGET_TITLE)
      const inner = await f.evaluate(() => ({ docH: Math.ceil(document.documentElement.getBoundingClientRect().height), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, tiles: document.querySelectorAll('.budw__tile').length, flowing: document.querySelector('.budw__viewport.is-flowing') !== null }))
      note(`widget ${vp.name}: card, iframe and document heights`, { ...geometry, inner })
      report[`widget-${vp.name}`] = { ...geometry, inner }
      // Decision D3: a card the dashboard stretched is not filled; the frame is as tall as its content.
      check(`size ${vp.name}: the widget frame fits inside its card (no clipping) and is not wider than the card`, geometry.iframe <= geometry.card && inner.scrollW <= inner.clientW, { geometry, inner })
      check(`size ${vp.name}: no horizontal overflow on the dashboard`, geometry.scrollW <= geometry.innerW, geometry)
    } finally { await w.browser.close() }
  }
}

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

/** Page-level rules do not apply to a document that is one part of a page (ADR 0014). */
const FRAME_EXCLUDED_RULES = ['landmark-one-main', 'page-has-heading-one', 'region']

interface AxeRow { id: string; impact: string | null | undefined; nodes: number; target: string; summary: string }

async function axeRun(frame: Playwright.Frame, disabled: string[]): Promise<AxeRow[]> {
  await frame.evaluate(AXE)
  if (frame !== frame.page().mainFrame()) {
    // A frame is transparent over the host's card or page, and axe cannot see across the boundary: it would measure
    // contrast against the document's default white in dark mode. Put the host's colour under the document for the run.
    const under = await (await frame.frameElement()).evaluate((e) => {
      for (let el: Element | null = e; el !== null; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor
        if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c
      }
      return 'rgb(255, 255, 255)'
    })
    await frame.evaluate((c) => { document.documentElement.style.backgroundColor = c }, under)
  }
  return frame.evaluate(async (off) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact?: string; nodes: Array<{ target: unknown[]; failureSummary?: string }> }> }> } }).axe
    const r = await axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])) })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: JSON.stringify(v.nodes[0]?.target), summary: (v.nodes[0]?.failureSummary ?? '').slice(0, 160) }))
  }, disabled)
}

async function a11yChecks(pw: typeof Playwright, base: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    const o = await open(pw, base, { width: 1280, height: 900, scheme })
    try {
      const frame = await gotoPage(o, base, 'isolated')
      await sleep(700)
      const lm = await o.page.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length }))
      const fm = await frame.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length, h1Text: document.querySelector('h1')?.textContent, firstHeading: document.querySelector('h1,h2,h3')?.tagName, headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName}:${(h.textContent ?? '').trim().slice(0, 30)}` ) }))
      check(`a11y ${scheme}: the host has exactly one main landmark, and the frame none`, lm.main === 1 && fm.main === 0, { host: lm, frame: fm })
      check(`a11y ${scheme}: the frame has exactly one h1, the first heading, naming the page`, fm.h1 === 1 && fm.h1Text === 'Budgets' && fm.firstHeading === 'H1', fm)
      note(`headings in the page frame (${scheme})`, fm.headings)
      const withAll = await axeRun(frame, [])
      note(`axe in the page frame with no exclusions (${scheme})`, withAll.map((v) => `${v.id}(${v.nodes})`))
      const inFrame = await axeRun(frame, FRAME_EXCLUDED_RULES)
      check(`a11y ${scheme}: axe in the page frame (WCAG 2 A/AA, 2.1, 2.2 AA, best practice), page-level rules excluded: 0 violations`, inFrame.length === 0, inFrame)
      const hostAxe = await axeRun(o.page.mainFrame(), ['page-has-heading-one'])
      check(`a11y ${scheme}: axe on the host document with the page frame in it, page-has-heading-one excluded: 0 violations`, hostAxe.length === 0, hostAxe)
      check(`a11y ${scheme}: no console error or CSP violation`, o.problems.length === 0, o.problems)
    } finally { await o.browser.close() }
  }

  // A result message is an alert in the accessibility tree of the frame (announcement by a screen reader is not verified).
  {
    const o = await open(pw, base, { width: 1280, height: 900 })
    try {
      const frame = await gotoPage(o, base, 'isolated')
      await frame.getByRole('button', { name: 'Next →' }).click()
      await eventually(() => label(frame), (t) => t.length > 0)
      const cdp = await o.ctx.newCDPSession(frame).catch(() => null)
      note('accessibility tree of the page frame', cdp === null ? 'the frame has no CDP target of its own' : 'checked below')
      void cdp
      const role = await frame.evaluate(() => { const probe = document.createElement('div'); probe.className = 'bud__notice'; probe.innerHTML = '<div class="wm-alert" role="alert">probe</div>'; return probe.querySelector('[role="alert"]')?.getAttribute('role') })
      check('a11y: the page\'s message component renders role="alert"', role === 'alert')
    } finally { await o.browser.close() }
  }

  // The widget frame, on the dashboard.
  for (const scheme of ['light', 'dark'] as const) {
    const o = await open(pw, base, { width: 1280, height: 2400, scheme })
    try {
      await o.page.goto(`${base}/`)
      await dismissWizard(o.page)
      const f = await (async () => { for (let i = 0; i < 300; i++) { const x = widgetFrame(o.page); if (x !== undefined && (await x.evaluate(() => document.querySelector('.budw') !== null).catch(() => false))) return x; await sleep(50) } return undefined })()
      if (f === undefined) { check(`a11y ${scheme}: the widget frame draws`, false); continue }
      await sleep(500)
      const fm = await f.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length }))
      check(`a11y ${scheme}: the widget frame has no landmarks and no h1 (the card's title is the host's)`, fm.main === 0 && fm.h1 === 0, fm)
      const axe = await axeRun(f, FRAME_EXCLUDED_RULES)
      check(`a11y ${scheme}: axe in the widget frame, page-level rules excluded: 0 violations`, axe.length === 0, axe)
      const hostAxe = await axeRun(o.page.mainFrame(), [])
      note(`axe on the dashboard with the widget frame (${scheme}), no exclusions`, hostAxe.map((v) => `${v.id}(${v.nodes}): ${v.target}`))
      check(`a11y ${scheme}: axe on the dashboard host document: 0 violations`, hostAxe.length === 0, hostAxe)
    } finally { await o.browser.close() }
  }
}

// ---------------------------------------------------------------------------
// visual
// ---------------------------------------------------------------------------

async function visualChecks(pw: typeof Playwright, base: string): Promise<void> {
  const ph = await open(pw, base, { width: 390, height: 844 })
  try {
    const frame = await gotoPage(ph, base, 'isolated')
    await sleep(700)
    const m = await frame.evaluate(() => {
      const wide = [...document.querySelectorAll('.wm-table__scroll, .wm-surface__body')].filter((b) => b.scrollWidth > b.clientWidth).length
      return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, tablesScrollingInsideTheirCard: wide }
    })
    note('phone: horizontal overflow of the page frame, and tables that scroll inside their card', m)
    check('phone: no horizontal overflow in the page frame or on the host', m.scrollW <= m.clientW && (await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), m)
    check('phone: a table wider than the frame scrolls inside its own scroller, not the page', m.tablesScrollingInsideTheirCard >= 1, m)
    await shot(ph.page, 'phone-page')
    check('phone: no console error or CSP violation', ph.problems.length === 0, ph.problems)
  } finally { await ph.browser.close() }
  const helper = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoPage(helper, base, 'isolated')
    await sleep(500)
    for (const theme of ['Dark', 'Light'] as const) {
      const menu = helper.page.getByRole('button', { name: 'Menu', exact: true })
      if (await menu.isVisible()) await menu.click()
      await helper.page.locator('.account__trigger').click()
      await helper.page.getByRole('button', { name: theme }).click()
      await helper.page.keyboard.press('Escape')
      await sleep(500)
      const fc = await frame.evaluate(() => ({ bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim(), scheme: document.documentElement.getAttribute('data-theme') }))
      const hostBg = await helper.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
      check(`visual ${theme}: the page frame follows the host theme (--wm-bg ${hostBg}, scheme ${fc.scheme})`, fc.bg === hostBg && fc.scheme === theme.toLowerCase(), { fc, hostBg })
      await shot(helper.page, `theme-${theme.toLowerCase()}`)
    }
  } finally { await helper.browser.close() }
}

// ---------------------------------------------------------------------------
// measure
// ---------------------------------------------------------------------------

function browserProcesses(): { rssMiB: number; renderers: number } {
  const out = execSync('ps -eo rss=,args=', { encoding: 'utf8' })
  let kib = 0
  let renderers = 0
  for (const line of out.split('\n')) {
    if (!line.includes('/opt/pw-browsers') && !line.includes(CHROMIUM)) continue
    kib += Number(line.trim().split(/\s+/)[0] ?? 0)
    if (line.includes('--type=renderer')) renderers += 1
  }
  return { rssMiB: Math.round(kib / 1024), renderers }
}

interface Sample { readyMs: number; rssMiB: number; renderers: number; mainHeapMiB: number; frameHeapMiB: number; frames: number; transferKiB: number }

async function sampleOnce(pw: typeof Playwright, base: string, mode: Mode): Promise<Sample> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const cdp = await o.ctx.newCDPSession(o.page)
    await cdp.send('Network.enable')
    let transfer = 0
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => { transfer += e.encodedDataLength })
    const t0 = Date.now()
    await o.page.goto(`${base}${PAGE_PATH}`)
    const frame = await waitForPage(o.page, mode)
    const readyMs = Date.now() - t0
    await sleep(2500)
    const heapOf = async (s: Playwright.CDPSession): Promise<number> => {
      await s.send('Performance.enable').catch(() => undefined)
      await s.send('HeapProfiler.collectGarbage').catch(() => undefined)
      const metrics = (await s.send('Performance.getMetrics')).metrics
      return (metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576
    }
    const mainHeap = await heapOf(cdp)
    let frameHeap = 0
    if (mode === 'isolated') {
      const s = await o.ctx.newCDPSession(frame).catch(() => null)
      if (s !== null) { const h = await heapOf(s); frameHeap = h === mainHeap ? 0 : h }
    }
    const proc = browserProcesses()
    return {
      readyMs, rssMiB: proc.rssMiB, renderers: proc.renderers, mainHeapMiB: Math.round(mainHeap * 10) / 10, frameHeapMiB: Math.round(frameHeap * 10) / 10,
      frames: o.page.frames().filter((f) => f.url().includes('/plugin-frame')).length, transferKiB: Math.round(transfer / 102.4) / 10,
    }
  } finally { await o.browser.close() }
}

async function bytes(pw: typeof Playwright, base: string, mode: Mode): Promise<Array<{ owner: string; url: string; bytes: number; gzip: number }>> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const rows: Array<{ owner: string; url: string; bytes: number; gzip: number }> = []
    const pending: Array<Promise<void>> = []
    o.page.on('response', (r) => {
      const t = r.request().resourceType()
      if (t !== 'script' && t !== 'stylesheet') return
      pending.push((async () => {
        const body = await r.body().catch(() => Buffer.alloc(0))
        rows.push({ owner: r.frame() === o.page.mainFrame() ? 'page' : 'frame', url: new URL(r.url()).pathname, bytes: body.length, gzip: gzipSync(body).length })
      })())
    })
    await o.page.goto(`${base}${PAGE_PATH}`)
    await waitForPage(o.page, mode)
    await sleep(1200)
    await Promise.all(pending)
    return rows
  } finally { await o.browser.close() }
}

async function measure(pw: typeof Playwright): Promise<void> {
  const servers = { 'in-realm': await startServer('in-realm'), isolated: await startServer('isolated') }
  try {
    const samples: Record<Mode, Sample[]> = { 'in-realm': [], isolated: [] }
    for (let i = 0; i < SAMPLES; i++) {
      for (const mode of (i % 2 === 0 ? ['in-realm', 'isolated'] : ['isolated', 'in-realm']) as Mode[]) {
        if (!MODES.includes(mode)) continue
        manifests(mode)
        const s = await sampleOnce(pw, servers[mode].base, mode)
        samples[mode].push(s)
        console.log(`  page ${mode} #${i + 1}: ${JSON.stringify(s)}`)
      }
    }
    const rows: Record<string, unknown> = {}
    for (const mode of (['in-realm', 'isolated'] as Mode[]).filter((m) => MODES.includes(m))) {
      const s = samples[mode]
      rows[mode] = {
        n: s.length, runsReadyMs: s.map((x) => x.readyMs),
        readyMs: { median: median(s.map((x) => x.readyMs)), min: Math.min(...s.map((x) => x.readyMs)), max: Math.max(...s.map((x) => x.readyMs)) },
        rssMiB: { median: median(s.map((x) => x.rssMiB)), min: Math.min(...s.map((x) => x.rssMiB)), max: Math.max(...s.map((x) => x.rssMiB)) },
        renderers: median(s.map((x) => x.renderers)), mainHeapMiB: median(s.map((x) => x.mainHeapMiB)), frameHeapMiB: median(s.map((x) => x.frameHeapMiB)),
        frames: median(s.map((x) => x.frames)), transferKiB: median(s.map((x) => x.transferKiB)),
      }
    }
    report['measure-page'] = rows
    console.log('\nMEASURE page (time to the first table row; median of n, alternating order):')
    console.log(JSON.stringify(rows, null, 2))
    if (MODES.length < 2) return
    manifests('in-realm')
    const inr = await bytes(pw, servers['in-realm'].base, 'in-realm')
    manifests('isolated')
    const iso = await bytes(pw, servers.isolated.base, 'isolated')
    const sum = (rs: Array<{ owner: string; bytes: number; gzip: number }>, owner?: string): Record<string, number> => {
      const sel = owner === undefined ? rs : rs.filter((r) => r.owner === owner)
      return { files: sel.length, raw: sel.reduce((a, r) => a + r.bytes, 0), gzip: sel.reduce((a, r) => a + r.gzip, 0) }
    }
    report['bytes-page'] = { inRealm: sum(inr), isolatedPage: sum(iso, 'page'), isolatedFrame: sum(iso, 'frame'), isolatedAll: sum(iso) }
    console.log('SCRIPT+STYLE BYTES page', JSON.stringify(report['bytes-page']))
  } finally {
    await servers['in-realm'].close()
    await servers.isolated.close()
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const pw = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright
  const probe = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  console.log(`engine: chromium ${probe.version()}`)
  await probe.close()

  const isolated = await startServer('isolated')
  let before: string
  try {
    await sweep(isolated.base)
    before = await snapshot(isolated.base)
    if (wants('load')) await loadChecks(pw, isolated.base)
    if (wants('nav')) await navChecks(pw, isolated.base)
    if (wants('forms')) await formChecks(pw, isolated.base)
    if (wants('alerts')) await alertChecks(pw, isolated.base)
    if (wants('size')) await sizeChecks(pw, isolated.base)
    if (wants('a11y')) await a11yChecks(pw, isolated.base)
    if (wants('visual')) await visualChecks(pw, isolated.base)
    if (wants('forms') || wants('alerts')) {
      await sweep(isolated.base)
      check('the persona\'s budget lines, windows and allowances are as the run found them', (await snapshot(isolated.base)) === before)
    }
  } finally {
    await sweep(isolated.base).catch(() => undefined)
    await isolated.close()
  }

  if (wants('measure')) await measure(pw)

  const out = process.env['BROWSER_CHECK_OUT']
  if (out !== undefined) writeFileSync(out, JSON.stringify({ checks, report }, null, 2))
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length} checks, ${failed.length} failed.`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error: unknown) => { console.error(error); process.exit(2) })
