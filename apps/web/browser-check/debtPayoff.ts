/**
 * Browser check and measurements for the Debt payoff plugin in sandboxed frames: its page (forms, a dialog that has
 * to fill the real window) and its "Debt-free date" widget, against the in-realm page the plugin shipped as.
 *
 * Starts the real API (built web app, frame document route, broker) against a seeded development database, once per
 * runtime, by putting the plugin's id in or out of `IN_REALM_PLUGIN_IDS` for the run, so both come from one build. It
 * signs in as the seeded `household` persona, gives it a list of debts (and removes them again), and drives Chromium
 * through the real shell.
 *
 * Groups (`ONLY=load,dialog,...` runs some):
 *  - load:    page and widget render in frames, titled and sandboxed, no console error or CSP violation
 *  - writes:  every write the page makes goes through the broker and works: create, update with `extraPayment`, the
 *             "In plan" toggle, archive, delete, the extra for all debts, validation errors on the field; the size of
 *             the largest body
 *  - dialog:  the debt dialog in a tall page frame (where it opens, what it covers, focus, Escape, scroll lock,
 *             phone, theme, a hostile frame's use of the channel)
 *  - a11y:    landmarks, headings, Tab order, axe on the host and on the page and widget frames
 *  - measure: time to the page's chart, memory and bytes, in-realm against isolated, alternating
 *
 * Needs: `pnpm build` done (apps/web/dist, or `WEB_DIST_DIR`), a migrated and seeded dev database (`pnpm migrate`,
 * `pnpm --filter @wickermoney/api seed`), Chromium (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`) and an
 * axe-core build (`AXE_PATH`, the path of `axe.min.js`). Run from apps/api so its dependencies resolve, with the repo
 * `.env` loaded:
 *
 *   cd apps/api && npx tsx --env-file=../../.env ../web/browser-check/debtPayoff.ts
 *
 * `BROWSER_CHECK_OUT=file.json` keeps the report, `SHOTS_DIR=dir` keeps screenshots, `SAMPLES=n` sets the number of
 * timing samples (default 7), `WEB_DIST_DIR` points at another build (to measure an earlier one), `MODES=in-realm`
 * measures one runtime only.
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

const DEBT = 'wickermoney.debt-payoff'
const PAGE_PATH = `/p/${DEBT}/debt-payoff`
const API_BASE = `/api/v1/p/${DEBT}`
const PAGE_TITLE = 'Debt Payoff · Debt payoff'
const PERSONA = { email: 'household@seed.wickermoney.test', password: 'SeedHousehold!2026' }
/** Debts given to the persona, enough that the page frame is much taller than the window. */
const DEBT_COUNT = 14

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

/** The bundled manifests, with Debt payoff in the page or in a frame. The allowlist is the host's, not the manifest's. */
function manifests(mode: Mode): PluginManifest[] {
  const set = IN_REALM_PLUGIN_IDS as Set<string>
  if (mode === 'in-realm') set.add(DEBT)
  else set.delete(DEBT)
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
    headers: { authorization: `Bearer ${session.access}`, 'x-wickermoney-plugin': DEBT, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** Removes every debt of the persona (archived ones too), so a run starts and ends clean. */
async function clearDebts(base: string): Promise<void> {
  const s = await login(base)
  const list = (await plugin(base, s, 'GET', '/debts?includeArchived=true')).json as { debts?: Array<{ id: string }> } | null
  for (const d of list?.debts ?? []) await plugin(base, s, 'DELETE', `/debts/${d.id}`)
  await plugin(base, s, 'PUT', '/settings', { extraPayment: '0', strategy: 'avalanche' })
}

async function seedDebts(base: string, count: number): Promise<void> {
  await clearDebts(base)
  const s = await login(base)
  for (let i = 0; i < count; i++) {
    const res = await plugin(base, s, 'POST', '/debts', {
      name: `Debt ${String(i + 1).padStart(2, '0')}`, balance: String(1200 + i * 350), apr: String(6 + (i % 9) * 2.5),
      minimumPayment: String(40 + i * 5),
    })
    if (res.status !== 200 && res.status !== 201) throw new Error(`seeding debt ${i}: ${res.status} ${JSON.stringify(res.json)}`)
  }
  await plugin(base, s, 'PUT', '/settings', { extraPayment: '150', strategy: 'avalanche' })
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

interface OpenOptions { width: number; height: number; scheme?: 'light' | 'dark'; who?: { email: string; password: string }; reducedMotion?: boolean }

async function open(pw: typeof Playwright, base: string, o: OpenOptions): Promise<Opened> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({
    viewport: { width: o.width, height: o.height }, colorScheme: o.scheme ?? 'light',
    ...(o.reducedMotion === true ? { reducedMotion: 'reduce' as const } : {}),
  })
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

/**
 * Waits until the page has loaded its debts, in the page (in-realm) or in the frame, and returns the frame that holds
 * it. With `chart`, until the payoff chart is drawn too (the page has debts in the plan).
 */
async function waitForPage(page: Playwright.Page, mode: Mode, chart = true, timeout = 30_000): Promise<Playwright.Frame> {
  const t0 = Date.now()
  for (;;) {
    const f = mode === 'isolated' ? pageFrame(page) : page.mainFrame()
    if (f !== undefined && (await f.evaluate((withChart) => {
      const root = document.querySelector('.dp')
      if (root === null || root.textContent?.includes('Loading your debts') === true || root.textContent?.includes('Working out the plan') === true) return false
      return !withChart || document.querySelector('.dp-chart svg') !== null
    }, chart).catch(() => false))) return f
    if (Date.now() - t0 > timeout) throw new Error(`the Debt payoff page did not load (${mode})`)
    await sleep(30)
  }
}

async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 1500 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
}

async function gotoPage(opened: Opened, base: string, mode: Mode, chart = true, path = PAGE_PATH): Promise<Playwright.Frame> {
  await opened.page.goto(`${base}${path}`)
  await dismissWizard(opened.page)
  return waitForPage(opened.page, mode, chart)
}

const shot = async (page: Playwright.Page, name: string): Promise<void> => {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// helpers shared by the groups
// ---------------------------------------------------------------------------

/** One request the broker made for the frame, as the browser saw it. */
interface Call { readonly method: string; readonly path: string; readonly bytes: number; status: number; readonly body: unknown }

/** Records the plugin's own API calls (`/api/v1/p/<id>/...`): the frame's, since only the host's broker can make them. */
function trackCalls(page: Playwright.Page): Call[] {
  const calls: Call[] = []
  const byRequest = new Map<Playwright.Request, Call>()
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!u.pathname.startsWith(API_BASE)) return
    const text = r.postData()
    let body: unknown = text
    try { if (text !== null) body = JSON.parse(text) } catch { /* not JSON: keep the text */ }
    const call: Call = { method: r.method(), path: `${u.pathname.slice(API_BASE.length)}${u.search}`, bytes: text === null ? 0 : Buffer.byteLength(text), status: 0, body }
    calls.push(call)
    byRequest.set(r, call)
  })
  page.on('response', (res) => { const c = byRequest.get(res.request()); if (c !== undefined) c.status = res.status() })
  return calls
}
const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET')
const lastWrite = (calls: Call[]): Call | undefined => writes(calls).at(-1)
/** Waits until the newest write has been answered. */
const landed = async (calls: Call[]): Promise<void> => { const t0 = Date.now(); while (Date.now() - t0 < 6000 && (lastWrite(calls)?.status ?? 1) === 0) await sleep(40) }

async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 6000): Promise<T> {
  const t0 = Date.now()
  let v = await read()
  while (!ok(v) && Date.now() - t0 < ms) { await sleep(60); v = await read() }
  return v
}

/** A loan and a credit card account for the persona to link debts to, made once and found again by name. */
async function ensureAccounts(base: string): Promise<{ loan: string; card: string; loanName: string; cardName: string }> {
  const s = await login(base)
  const headers = { authorization: `Bearer ${s.access}`, 'content-type': 'application/json' }
  const list = (await (await fetch(`${base}/api/v1/accounts`, { headers })).json()) as Array<{ id: string; name: string }>
  const find = async (name: string, accountType: string): Promise<string> => {
    const found = list.find((a) => a.name === name)
    if (found !== undefined) return found.id
    const res = await fetch(`${base}/api/v1/accounts`, { method: 'POST', headers, body: JSON.stringify({ name, accountType, initialBalance: '0.00' }) })
    if (res.status !== 201) throw new Error(`account ${name}: ${res.status} ${await res.text()}`)
    return ((await res.json()) as { id: string }).id
  }
  const loanName = 'P3c check loan'
  const cardName = 'P3c check card'
  return { loan: await find(loanName, 'loan'), card: await find(cardName, 'credit_card'), loanName, cardName }
}

/** Fills the debt dialog's text fields; a field left out is not touched. */
async function fillDebt(dialog: Playwright.Locator, v: { name?: string; balance?: string; apr?: string; minimum?: string; extra?: string }): Promise<void> {
  if (v.name !== undefined) await dialog.getByLabel('Name', { exact: true }).fill(v.name)
  if (v.balance !== undefined) await dialog.getByLabel('Balance', { exact: true }).fill(v.balance)
  if (v.apr !== undefined) await dialog.getByLabel('Interest rate', { exact: false }).fill(v.apr)
  if (v.minimum !== undefined) await dialog.getByLabel('Minimum payment', { exact: false }).fill(v.minimum)
  if (v.extra !== undefined) await dialog.getByLabel('Extra each month toward this debt', { exact: false }).fill(v.extra)
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

/** The widget's frame, once it exists. */
function widgetFrame(page: Playwright.Page): Playwright.Frame | undefined {
  return page.frames().find((f) => f !== page.mainFrame() && f.url().includes('kind=widget') && f.url().includes('DebtFreeWidget'))
}

async function loadChecks(pw: typeof Playwright, base: string): Promise<void> {
  await seedDebts(base, 3)
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const calls = trackCalls(o.page)
    const frame = await gotoPage(o, base, 'isolated')
    const iframes = await o.page.locator('iframe').count()
    check('load: one iframe on the page, for the page', iframes === 1, iframes)
    const el = o.page.locator(`iframe[title="${PAGE_TITLE}"]`)
    check('load: the iframe is titled "<plugin name> · <page title>"', (await el.count()) === 1)
    check('load: sandbox is exactly allow-scripts', (await el.getAttribute('sandbox')) === 'allow-scripts', await el.getAttribute('sandbox'))
    check('load: the frame document is the plugin frame, kind=page, module DebtPayoffPage', frame.url().includes('/plugin-frame#') && frame.url().includes('kind=page') && frame.url().includes('module=.%2FDebtPayoffPage'), frame.url())
    check('load: the frame document has an opaque origin', (await frame.evaluate(() => location.origin === 'null' || window.origin === 'null')) === true)
    check('load: the page heading is in the frame', (await frame.locator('h1').allTextContents()).join() === 'Debt payoff')
    check('load: the host shows the frame (visible) and no spinner or alert is left', (await el.evaluate((e) => (e as HTMLElement).style.visibility)) === 'visible' && (await o.page.locator('.plugin-frame__status').count()) === 0)
    check('load: the plugin\'s styles reached the frame (a swatch is drawn)', (await frame.evaluate(() => { const s = document.querySelector('.dp-swatch'); return s !== null && getComputedStyle(s).width === '10px' })) === true)
    await sleep(800)
    check('load: no console error, failed request or CSP violation', o.problems.length === 0, o.problems)
    const reads = calls.filter((c) => c.method === 'GET').map((c) => c.path.replace(/\?.*/, ''))
    note('requests the broker made for the page at load', calls.map((c) => `${c.method} ${c.path} ${c.status}`))
    check('load: the page reads settings, debts, suggestions and the plan, and nothing else', JSON.stringify([...new Set(reads)].sort()) === JSON.stringify(['/account-suggestions', '/debts', '/plan', '/settings']), reads)
    check('load: every one of them answered 200', calls.every((c) => c.status === 200), calls)
    await shot(o.page, 'load-desktop')
  } finally { await o.browser.close() }

  // The widget on the dashboard.
  const w = await open(pw, base, { width: 1280, height: 2400 })
  try {
    await w.page.goto(`${base}/`)
    await dismissWizard(w.page)
    const f = await (async () => { for (let i = 0; i < 300; i++) { const x = widgetFrame(w.page); if (x !== undefined && (await x.evaluate(() => document.querySelector('.dpw') !== null).catch(() => false))) return x; await sleep(50) } return undefined })()
    check('load: the Debt-free date widget runs in a widget frame and draws', f !== undefined)
    if (f !== undefined) {
      const iframe = w.page.locator('iframe[title="Debt Payoff · Debt-free date"]')
      check('load: widget frame is titled and sandboxed', (await iframe.count()) === 1 && (await iframe.getAttribute('sandbox')) === 'allow-scripts')
      const text = await f.locator('.dpw').innerText()
      note('widget text', text.replace(/\s+/g, ' ').slice(0, 160))
      check('load: the widget shows the debt-free date and the next debt', /Debt-free date/.test(text) && /Next in line/.test(text) && /Debt 0\d/.test(text), text)
      await f.getByRole('button', { name: 'Open debt payoff' }).click()
      await w.page.waitForURL(`**${PAGE_PATH}`)
      check('load: "Open debt payoff" in the widget moves the host to the page (ctx.navigate)', new URL(w.page.url()).pathname === PAGE_PATH)
      const page = await waitForPage(w.page, 'isolated')
      check('load: and the page frame is there', (await page.locator('h1').allTextContents()).join() === 'Debt payoff')
    }
    await sleep(500)
    check('load: no console error, failed request or CSP violation on the dashboard and after', w.problems.length === 0, w.problems)
  } finally { await w.browser.close() }
}

// ---------------------------------------------------------------------------
// writes
// ---------------------------------------------------------------------------

async function writeChecks(pw: typeof Playwright, base: string): Promise<void> {
  const accounts = await ensureAccounts(base)
  await clearDebts(base)
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const calls = trackCalls(o.page)
    const frame = await gotoPage(o, base, 'isolated', false)
    const dialog = frame.getByRole('dialog')
    const row = (name: string): Playwright.Locator => frame.locator('.dp-debts tbody tr').filter({ hasText: name })
    const closed = async (): Promise<boolean> => (await frame.getByRole('dialog').count()) === 0

    // 1. Create, from an account, with an extra for this debt.
    check('writes: with no debts the page says so and offers the linked accounts', (await frame.getByText('No debts yet').count()) === 1 && (await frame.getByRole('button', { name: `Add ${accounts.loanName}` }).count()) === 1)
    await frame.getByRole('button', { name: `Add ${accounts.loanName}` }).click()
    await dialog.waitFor()
    check('writes: the dialog starts from the account (name filled, account chosen)', (await dialog.getByLabel('Name', { exact: true }).inputValue()) === accounts.loanName && (await dialog.getByLabel('Linked account', { exact: false }).inputValue()) === accounts.loan)
    await fillDebt(dialog, { balance: '12000', apr: '6.5', minimum: '250', extra: '100' })
    await dialog.getByRole('button', { name: 'Add debt' }).click()
    await eventually(async () => closed(), (v) => v)
    const created = calls.find((c) => c.method === 'POST' && c.path === '/debts')
    check('writes: create (POST /debts) with accountId and extraPayment went through the broker and answered 200', created !== undefined && created.status === 200 && (created.body as Record<string, unknown>)['extraPayment'] === '100' && (created.body as Record<string, unknown>)['accountId'] === accounts.loan, created)
    check('writes: the dialog closed and the debt is in the list with its extra', (await row(accounts.loanName).count()) === 1 && /100/.test(await row(accounts.loanName).innerText()))
    await waitForPage(o.page, 'isolated')

    // 2. Create a second debt, no extra (sent as "0").
    await frame.getByRole('button', { name: 'Add a debt' }).click()
    await dialog.waitFor()
    await fillDebt(dialog, { name: 'Card B', balance: '3000', apr: '24.99', minimum: '90' })
    await dialog.getByRole('button', { name: 'Add debt' }).click()
    await eventually(async () => closed(), (v) => v)
    const second = calls.filter((c) => c.method === 'POST' && c.path === '/debts').at(-1)
    check('writes: a blank extra is sent as "0"', (second?.body as Record<string, unknown>)['extraPayment'] === '0' && second?.status === 200, second)
    await eventually(async () => row('Card B').count(), (n) => n === 1)

    // 3. The form checks first: nothing is sent for a bad amount, and the problem is on its field.
    const before = calls.length
    await frame.getByRole('button', { name: 'Add a debt' }).click()
    await dialog.waitFor()
    await fillDebt(dialog, { name: 'Bad', balance: 'abc', apr: '5', minimum: '10', extra: '1,00' })
    await dialog.getByRole('button', { name: 'Add debt' }).click()
    await sleep(300)
    check('writes: a bad amount is refused on its field before any request (balance and extra)', (await dialog.locator('.wm-field__error').allTextContents()).length === 2 && calls.length === before, { errors: await dialog.locator('.wm-field__error').allTextContents(), sent: calls.slice(before) })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await eventually(async () => closed(), (v) => v)

    // 4. Update with extraPayment.
    await row('Card B').getByRole('button', { name: 'Edit Card B' }).click()
    await dialog.waitFor()
    await fillDebt(dialog, { extra: '60' })
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await eventually(async () => closed(), (v) => v)
    const upd = lastWrite(calls)
    check('writes: update (PUT /debts/:id) with extraPayment went through the broker', upd?.method === 'PUT' && /^\/debts\/[0-9a-f-]{36}$/.test(upd.path) && (upd.body as Record<string, unknown>)['extraPayment'] === '60' && upd.status === 200, upd)
    check('writes: the list shows the new extra', /60/.test(await eventually(async () => row('Card B').innerText(), (t) => /60/.test(t))))

    // 5. The "In plan" switch, saved at once.
    const sw = row('Card B').getByRole('checkbox', { name: /Include Card B in the payoff plan/ })
    await sw.click()
    await eventually(async () => lastWrite(calls)?.body, (b) => JSON.stringify(b) === '{"included":false}')
    await landed(calls)
    const off = lastWrite(calls)
    check('writes: the toggle sends {"included":false} (PUT) and nothing else', off?.method === 'PUT' && JSON.stringify(off.body) === '{"included":false}' && off.status === 200, off)
    check('writes: the row says Not in plan, and the page says so', /Not in plan/.test(await eventually(async () => row('Card B').innerText(), (t) => /Not in plan/.test(t))))
    await sw.click()
    await eventually(async () => JSON.stringify(lastWrite(calls)?.body), (b) => b === '{"included":true}')
    await landed(calls)
    check('writes: and back: {"included":true}', JSON.stringify(lastWrite(calls)?.body) === '{"included":true}' && lastWrite(calls)?.status === 200)
    const toggleBytes = off?.bytes ?? 0

    // 6. Strategy and the extra for all debts (the settings), and the field problem there.
    await frame.getByRole('button', { name: 'Snowball' }).click()
    await eventually(async () => lastWrite(calls)?.path, (p) => p === '/settings')
    await landed(calls)
    check('writes: choosing Snowball is PUT /settings {"strategy":"snowball"}', lastWrite(calls)?.path === '/settings' && JSON.stringify(lastWrite(calls)?.body) === '{"strategy":"snowball"}' && lastWrite(calls)?.status === 200, lastWrite(calls))
    const extraField = frame.getByLabel('Extra for all debts (follows the strategy)')
    check('writes: the shared extra is labelled "Extra for all debts (follows the strategy)"', (await extraField.count()) === 1)
    await extraField.fill('75')
    await frame.getByRole('button', { name: 'Update plan' }).click()
    await eventually(async () => JSON.stringify(lastWrite(calls)?.body), (b) => b === '{"extraPayment":"75"}')
    await landed(calls)
    check('writes: Update plan is PUT /settings {"extraPayment":"75"}', JSON.stringify(lastWrite(calls)?.body) === '{"extraPayment":"75"}' && lastWrite(calls)?.status === 200, lastWrite(calls))
    await sleep(400)
    const n = calls.length
    await extraField.fill('seventy')
    await frame.getByRole('button', { name: 'Update plan' }).click()
    await sleep(300)
    check('writes: a bad shared extra is refused on its field and nothing is sent', (await frame.locator('.dp-extra .wm-field__error').count()) === 1 && calls.length === n, await frame.locator('.dp-extra .wm-field__error').allTextContents())
    await extraField.fill('75')

    // 7. A problem only the server can see, on its field, through the broker: the account was linked by someone else
    //    after the dialog read the suggestions.
    await frame.getByRole('button', { name: 'Add a debt' }).click()
    await dialog.waitFor()
    const s = await login(base)
    const raced = await plugin(base, s, 'POST', '/debts', { name: 'Raced', balance: '500', apr: '10', minimumPayment: '25', accountId: accounts.card })
    check('writes: (setup) the other writer linked the card account', raced.status === 200 || raced.status === 201, raced)
    // The select was filled from suggestions read before; add the stale option the way the page would have had it.
    await dialog.getByLabel('Linked account', { exact: false }).evaluate((sel, id) => { const opt = document.createElement('option'); opt.value = id as string; opt.textContent = 'Stale card'; (sel as HTMLSelectElement).append(opt) }, accounts.card)
    await fillDebt(dialog, { name: 'Late', balance: '800', apr: '9', minimum: '30' })
    await dialog.getByLabel('Linked account', { exact: false }).selectOption(accounts.card)
    await dialog.getByRole('button', { name: 'Add debt' }).click()
    const fieldErr = await eventually(async () => dialog.locator('.wm-field__error').allTextContents(), (t) => t.length > 0)
    const conflict = lastWrite(calls)
    check('writes: the server\'s 409 reaches the field it is about (accountId), with its own words', conflict?.status === 409 && fieldErr.join('|') === 'That account already has a debt.', { conflict, fieldErr })
    check('writes: and the dialog stays open, with focus on that field', (await dialog.count()) === 1 && (await frame.evaluate(() => document.activeElement?.tagName)) === 'SELECT')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await eventually(async () => closed(), (v) => v)

    // 8. Archive.
    await row('Card B').getByRole('button', { name: 'Edit Card B' }).click()
    await dialog.waitFor()
    await dialog.getByRole('checkbox', { name: /Archive this debt/ }).check()
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await eventually(async () => closed(), (v) => v)
    const arch = lastWrite(calls)
    check('writes: archive is PUT /debts/:id with archived:true', arch?.method === 'PUT' && (arch.body as Record<string, unknown>)['archived'] === true && arch.status === 200, arch)
    check('writes: the archived debt leaves the list', (await eventually(async () => row('Card B').count(), (c) => c === 0)) === 0)
    await frame.getByRole('checkbox', { name: 'Show archived' }).check()
    check('writes: and "Show archived" brings it back (GET /debts?includeArchived=true)', (await eventually(async () => row('Card B').count(), (c) => c === 1)) === 1 && calls.some((c) => c.path === '/debts?includeArchived=true' && c.status === 200))
    await frame.getByRole('checkbox', { name: 'Show archived' }).uncheck()

    // 9. Delete, with the confirmation inside the dialog.
    await row(accounts.loanName).getByRole('button', { name: `Edit ${accounts.loanName}` }).click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Remove this debt' }).click()
    check('writes: removing asks first (nothing sent yet)', (await dialog.getByRole('button', { name: 'Yes, remove it' }).count()) === 1 && lastWrite(calls)?.method !== 'DELETE')
    await dialog.getByRole('button', { name: 'Yes, remove it' }).click()
    await eventually(async () => closed(), (v) => v)
    const del = lastWrite(calls)
    check('writes: delete is DELETE /debts/:id through the broker', del?.method === 'DELETE' && /^\/debts\/[0-9a-f-]{36}$/.test(del.path) && del.status === 200 || del?.status === 204, del)
    check('writes: and the debt is gone', (await eventually(async () => row(accounts.loanName).count(), (c) => c === 0)) === 0)

    // 10. A problem with no field: the limit of 50 debts (409 too_many_debts), shown on the form.
    const filler = (await plugin(base, s, 'GET', '/debts')).json as { debts: Array<{ id: string; archived: boolean }> }
    const active = filler.debts.filter((d) => !d.archived).length
    for (let i = active; i < 50; i++) await plugin(base, s, 'POST', '/debts', { name: `Filler ${i}`, balance: '10', apr: '1', minimumPayment: '1' })
    await o.page.reload()
    await dismissWizard(o.page)
    const f2 = await waitForPage(o.page, 'isolated', false)
    await f2.getByRole('button', { name: 'Add a debt' }).click()
    const d2 = f2.getByRole('dialog')
    await d2.waitFor()
    await fillDebt(d2, { name: 'One too many', balance: '10', apr: '1', minimum: '1' })
    await d2.getByRole('button', { name: 'Add debt' }).click()
    const formErr = await eventually(async () => d2.locator('.wm-form-error, [role="alert"]').allTextContents(), (t) => t.some((x) => /up to 50 debts/.test(x)))
    check('writes: the limit (409 too_many_debts) shows its own message on the form, through the broker', formErr.some((x) => /up to 50 debts/.test(x)) && calls.filter((c) => c.method === 'POST' && c.path === '/debts').at(-1)?.status === 409, formErr)

    const all = writes(calls)
    note('writes made through the broker', all.map((c) => `${c.method} ${c.path} ${c.bytes}B -> ${c.status}`))
    const max = Math.max(...all.map((c) => c.bytes))
    report['writes'] = { count: all.length, methods: [...new Set(all.map((c) => c.method))], maxBodyBytes: max, toggleBytes }
    check('writes: every write was a plain POST, PUT or DELETE under the plugin\'s own path', all.every((c) => ['POST', 'PUT', 'DELETE'].includes(c.method)) && calls.every((c) => c.path.startsWith('/')))
    check(`writes: the largest body is ${max} bytes, far below the broker's 256 KiB cap (262 144)`, max < 4096, max)
    check('writes: no console error or CSP violation through all of it', o.problems.filter((p) => !/409/.test(p)).length === 0, o.problems)
  } finally { await o.browser.close(); await clearDebts(base) }
}

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

interface Geometry { readonly iframeTop: number; readonly iframeLeft: number; readonly iframeW: number; readonly iframeH: number; readonly scrollY: number }

/** Where an element of the page is, in window coordinates, whether the frame is in the flow or lifted. */
async function windowRect(page: Playwright.Page, frame: Playwright.Frame, selector: string, nth = 0): Promise<{ top: number; left: number; width: number; height: number }> {
  const inner = await frame.locator(selector).nth(nth).evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height } })
  const box = await page.locator('iframe').evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left } })
  return { top: Math.round((box.top + inner.top) * 10) / 10, left: Math.round((box.left + inner.left) * 10) / 10, width: inner.width, height: inner.height }
}

async function hostGeometry(page: Playwright.Page): Promise<Geometry> {
  return page.evaluate(() => { const r = document.querySelector('iframe')!.getBoundingClientRect(); return { iframeTop: r.top, iframeLeft: r.left, iframeW: r.width, iframeH: r.height, scrollY: window.scrollY } })
}

/** What is at a point of the window: 'iframe', or the host element's class or tag. */
async function atPoint(page: Playwright.Page, x: number, y: number): Promise<string> {
  return page.evaluate(([px, py]) => { const el = document.elementFromPoint(px as number, py as number); return el === null ? 'none' : el.tagName === 'IFRAME' ? 'iframe' : `${el.tagName.toLowerCase()}.${el.className}` }, [x, y] as const)
}

async function dialogChecks(pw: typeof Playwright, base: string): Promise<void> {
  await seedDebts(base, DEBT_COUNT)
  const o = await open(pw, base, { width: 1280, height: 700 })
  try {
    const frame = await gotoPage(o, base, 'isolated')
    await sleep(500)
    const page = o.page
    const rows: Record<string, unknown> = {}

    // The problem, reproduced and measured before anything is opened: the frame is taller than the window.
    const g0 = await hostGeometry(page)
    check('dialog: the page frame is much taller than the window (so the reproduction is meaningful)', g0.iframeH > 2 * 700, g0)
    const fixedInFrame = await frame.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:50%;left:50%;width:10px;height:10px'; document.body.append(d); const t = d.getBoundingClientRect().top; d.remove(); return Math.round(t) })
    note('a position:fixed, top:50% element in this frame is at frame y', fixedInFrame)
    rows['fixedTop50InFrame'] = fixedInFrame

    // Open the dialog for the last debt, with the window scrolled to it.
    const edit = frame.getByRole('button', { name: 'Edit Debt 14' })
    await edit.scrollIntoViewIfNeeded()
    await sleep(300)
    const opener = await windowRect(page, frame, 'button[aria-label="Edit Debt 14"]')
    const swatch = await windowRect(page, frame, '.dp-debts tbody tr', 3)
    const before = await hostGeometry(page)
    check('dialog: the window is scrolled well down the page when it opens (the case that was broken)', before.scrollY > 300, before)
    await edit.click()
    const dlg = frame.getByRole('dialog')
    await dlg.waitFor()
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === 'true')
    await sleep(200)
    const open = await hostGeometry(page)
    const dr = await windowRect(page, frame, 'dialog')
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    rows['open'] = { before, open, dialog: dr, win }
    note('window and iframe before / while open, and the dialog in window coordinates', { before, open, dialog: dr, win })
    check('dialog: opening it does not move the window (scroll position kept)', open.scrollY === before.scrollY, { before: before.scrollY, open: open.scrollY })
    check('dialog: the dialog fills the window\'s height, from its top to its bottom', Math.abs(dr.top - 0) <= 1 && Math.abs(dr.height - win.h) <= 1, dr)
    check('dialog: and sits at the window\'s right edge (a drawer, as for the app\'s own dialogs)', Math.abs(dr.left + dr.width - win.w) <= 1, dr)
    check('dialog: the lifted frame does not cover the sidebar (starts at the sidebar\'s edge)', Math.abs(open.iframeLeft - 208) <= 1 && open.iframeTop === 0, open)
    const swatchOpen = await windowRect(page, frame, '.dp-debts tbody tr', 3)
    check('dialog: the page behind stays where it was on screen (a row moves by at most 1 px)', Math.abs(swatchOpen.top - swatch.top) <= 1 && Math.abs(swatchOpen.left - swatch.left) <= 1 && Math.abs(swatchOpen.width - swatch.width) <= 1, { before: swatch, open: swatchOpen })
    const openerOpen = await windowRect(page, frame, 'button[aria-label="Edit Debt 14"]')
    check('dialog: the button that opened it is where it was', Math.abs(openerOpen.top - opener.top) <= 1 && Math.abs(openerOpen.left - opener.left) <= 1, { before: opener, open: openerOpen })
    check('dialog: the first field has focus', (await frame.evaluate(() => document.activeElement?.closest('dialog') !== null && document.activeElement?.tagName === 'INPUT')) === true)

    // What the lifted layer covers.
    const navLink = await page.locator('nav a[href="/accounts"]').first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    check('dialog: the navigation link still receives its own clicks while the dialog is open', (await atPoint(page, navLink.x, navLink.y)).startsWith('a.'), await atPoint(page, navLink.x, navLink.y))
    check('dialog: the lifted frame covers the content area (a point in it is the frame)', (await atPoint(page, 600, 300)) === 'iframe')
    // Scroll lock: wheel over the dialog and over the dimmed page.
    await page.mouse.move(1000, 300)
    await page.mouse.wheel(0, 600)
    await sleep(200)
    await page.mouse.move(500, 300)
    await page.mouse.wheel(0, 600)
    await sleep(200)
    const afterWheel = await hostGeometry(page)
    check('dialog: the window does not scroll while the dialog is open (wheel over the drawer and over the page behind)', afterWheel.scrollY === before.scrollY, afterWheel)
    const bodyScroll = await dlg.locator('.wm-dialog__body').evaluate((e) => ({ top: e.scrollTop, can: e.scrollHeight > e.clientHeight }))
    note('the dialog body scrolls on its own', bodyScroll)
    await shot(page, 'dialog-open-desktop')

    // Keyboard: Tab stays inside, Shift+Tab stays inside, a long run of Tabs.
    const seen: string[] = []
    const where = async (): Promise<string> => {
      const host = await page.evaluate(() => { const a = document.activeElement; return a === null || a === document.body ? 'body' : a.tagName === 'IFRAME' ? 'iframe' : `host:${a.tagName.toLowerCase()}` })
      if (host !== 'iframe') return host
      return frame.evaluate(() => { const a = document.activeElement; if (a === null || a === document.body) return 'frame:body'; return a.closest('dialog') === null ? `frame-outside:${a.tagName}` : `dialog:${a.tagName}${a.getAttribute('aria-label') ? `[${a.getAttribute('aria-label')}]` : ''}` })
    }
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Tab'); await sleep(40); seen.push(await where()) }
    const escaped = seen.filter((s) => !s.startsWith('dialog:'))
    note('24 Tab presses from the first field: where focus was', seen)
    rows['tabInDialog'] = seen
    check('dialog: Tab keeps focus inside the dialog (24 presses)', escaped.length === 0, escaped)
    const back: string[] = []
    for (let i = 0; i < 24; i++) { await page.keyboard.press('Shift+Tab'); await sleep(40); back.push(await where()) }
    check('dialog: Shift+Tab keeps focus inside the dialog (24 presses)', back.every((s) => s.startsWith('dialog:')), back.filter((s) => !s.startsWith('dialog:')))

    // Escape: closes, the frame is put back, scroll position and focus return.
    await page.keyboard.press('Escape')
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === null)
    await sleep(300)
    const after = await hostGeometry(page)
    const afterOpener = await windowRect(page, frame, 'button[aria-label="Edit Debt 14"]')
    const lock = await page.evaluate(() => document.documentElement.hasAttribute('data-wm-frame-modal'))
    check('dialog: Escape closes it and the frame goes back into the flow, as tall and as far down as before', (await frame.getByRole('dialog').count()) === 0 && Math.abs(after.iframeTop - before.iframeTop) <= 1 && Math.abs(after.iframeH - before.iframeH) <= 1 && Math.abs(after.iframeLeft - before.iframeLeft) <= 1, { before, after })
    check('dialog: the window is where the person left it, and scrolling works again', after.scrollY === before.scrollY && !lock, { after, lock })
    check('dialog: the page did not move on close (the button is where it was)', Math.abs(afterOpener.top - opener.top) <= 1 && Math.abs(afterOpener.left - opener.left) <= 1, { before: opener, after: afterOpener })
    check('dialog: focus went back to the button that opened it', (await frame.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Edit Debt 14')
    await page.mouse.move(600, 300)
    await page.mouse.wheel(0, 200)
    await sleep(200)
    check('dialog: the window scrolls again after it closes', (await hostGeometry(page)).scrollY !== before.scrollY)
    await page.evaluate((y) => window.scrollTo(0, y), before.scrollY)

    // Click outside the drawer (on the dimmed page) closes it; the close button closes it.
    await edit.click()
    await dlg.waitFor()
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === 'true')
    await sleep(450)
    await page.mouse.click(500, 300)
    await eventually(async () => frame.getByRole('dialog').count(), (c) => c === 0)
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === null)
    check('dialog: a click on the dimmed page behind the drawer closes it', (await frame.getByRole('dialog').count()) === 0 && (await page.locator('.plugin-frame').getAttribute('data-lifted')) === null)
    await edit.click()
    await dlg.waitFor()
    await dlg.getByRole('button', { name: 'Close' }).click()
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === null)
    check('dialog: the Close button closes it and puts the frame back', (await page.locator('.plugin-frame').getAttribute('data-lifted')) === null)

    // The in-dialog confirmation, then a real delete from the lifted frame, through to the list.
    await edit.click()
    await dlg.waitFor()
    await dlg.getByRole('button', { name: 'Remove this debt' }).click()
    const confirmFocus = await eventually(async () => frame.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), (l) => l.startsWith('Remove '))
    check('dialog: the remove confirmation takes focus inside the dialog', confirmFocus === 'Remove Debt 14', confirmFocus)
    await dlg.getByRole('button', { name: 'Keep it' }).click()
    check('dialog: "Keep it" puts focus back on "Remove this debt"', (await eventually(async () => frame.evaluate(() => document.activeElement?.textContent ?? ''), (t) => t === 'Remove this debt')) === 'Remove this debt')
    await page.keyboard.press('Escape')
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === null)

    // The theme, switched from the host's own control while the dialog is open.
    await edit.click()
    await dlg.waitFor()
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === 'true')
    const dlgBg = async (): Promise<string> => frame.evaluate(() => getComputedStyle(document.querySelector('dialog')!).backgroundColor)
    const lightBg = await dlgBg()
    await page.locator('.account__trigger').click()
    await page.getByRole('button', { name: 'Dark' }).click()
    await page.keyboard.press('Escape')
    await sleep(500)
    const darkBg = await dlgBg()
    check('dialog: the theme switch reaches the open dialog (account menu stays usable beside it)', lightBg !== darkBg && darkBg === 'rgb(24, 28, 34)' || (lightBg !== darkBg && /^rgb\((\d+), (\d+), (\d+)\)$/.test(darkBg) && Number(/\d+/.exec(darkBg)![0]) < 80), { lightBg, darkBg })
    check('dialog: it is still open, still lifted, after the menu', (await frame.getByRole('dialog').count()) === 1 && (await page.locator('.plugin-frame').getAttribute('data-lifted')) === 'true')
    await shot(page, 'dialog-open-dark')
    await page.locator('.account__trigger').click()
    await page.getByRole('button', { name: 'Light' }).click()
    await page.keyboard.press('Escape')
    await sleep(300)

    // Resize the window while it is open: the dialog follows, the page behind keeps its place relative to the window's left.
    await page.setViewportSize({ width: 1100, height: 600 })
    await sleep(500)
    const dr2 = await windowRect(page, frame, 'dialog')
    check('dialog: resizing the window while open: the dialog fills the new height and edge', Math.abs(dr2.height - 600) <= 1 && Math.abs(dr2.left + dr2.width - 1100) <= 1 && dr2.top === 0, dr2)
    await page.setViewportSize({ width: 1280, height: 700 })
    await sleep(300)

    // Leaving with the dialog open: the frame goes, the lock goes.
    await page.locator('nav a[href="/accounts"]').first().click()
    await page.waitForURL('**/accounts')
    await sleep(300)
    const gone = await page.evaluate(() => ({ lock: document.documentElement.hasAttribute('data-wm-frame-modal'), frames: document.querySelectorAll('iframe').length, lifted: document.querySelectorAll('[data-lifted]').length }))
    check('dialog: following a link in the sidebar with the dialog open leaves cleanly (no frame, no scroll lock, nothing lifted)', !gone.lock && gone.frames === 0 && gone.lifted === 0, gone)
    await page.goBack()
    await waitForPage(page, 'isolated')
    const back2 = await page.evaluate(() => ({ lock: document.documentElement.hasAttribute('data-wm-frame-modal'), lifted: document.querySelectorAll('[data-lifted]').length }))
    check('dialog: back to the page: a fresh frame, not lifted, not locked', !back2.lock && back2.lifted === 0, back2)

    // find-in-page: indicative only (window.find is not the browser's find bar).
    const found = await page.evaluate(() => (window as unknown as { find: (t: string) => boolean }).find('Debt 03'))
    note('window.find("Debt 03") on the host document with the page frame (indicative; the browser\'s find bar was not driven)', found)
    report['dialog'] = rows
    check('dialog: no console error, failed request or CSP violation through all of it', o.problems.length === 0, o.problems)
  } finally { await o.browser.close() }

  // Phone.
  const ph = await open(pw, base, { width: 390, height: 844 })
  try {
    const frame = await gotoPage(ph, base, 'isolated')
    await sleep(500)
    const page = ph.page
    const edit = frame.getByRole('button', { name: 'Edit Debt 14' }).first()
    // The phone shows cards, not a table: the edit button is still named for the debt.
    await edit.scrollIntoViewIfNeeded()
    await sleep(300)
    const bar = await page.evaluate(() => document.querySelector('.shell__bar')!.getBoundingClientRect().bottom)
    const opener = await windowRect(page, frame, 'button[aria-label="Edit Debt 14"]')
    const before = await hostGeometry(page)
    await edit.click()
    const dlg = frame.getByRole('dialog')
    await dlg.waitFor()
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === 'true')
    await sleep(300)
    const open = await hostGeometry(page)
    const dr = await windowRect(page, frame, 'dialog')
    note('phone: bar bottom, window scroll before/while, the iframe, the dialog', { bar, before: before.scrollY, open, dialog: dr })
    check('phone: the dialog is a sheet filling the window below the top bar (full width, from the bar to the bottom)', Math.abs(dr.top - bar) <= 1 && Math.abs(dr.height - (844 - bar)) <= 1 && Math.abs(dr.left) <= 1 && Math.abs(dr.width - 390) <= 1, { dr, bar })
    check('phone: the top bar and its menu button are not covered', (await atPoint(page, 40, 20)).includes('shell__bar') || (await atPoint(page, 40, 20)).includes('shell__menu-btn') || (await atPoint(page, 40, 20)).startsWith('svg') || (await atPoint(page, 40, 20)).startsWith('path'), await atPoint(page, 40, 20))
    check('phone: the window did not move', open.scrollY === before.scrollY, { before: before.scrollY, open: open.scrollY })
    const openerOpen = await windowRect(page, frame, 'button[aria-label="Edit Debt 14"]')
    check('phone: the page behind stays where it was', Math.abs(openerOpen.top - opener.top) <= 1 && Math.abs(openerOpen.left - opener.left) <= 1, { opener, openerOpen })
    await shot(page, 'dialog-open-phone')
    const overflow = await frame.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    check('phone: no horizontal overflow in the lifted frame', overflow.sw <= overflow.cw, overflow)
    await page.keyboard.press('Escape')
    await eventually(async () => page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === null)
    const after = await hostGeometry(page)
    check('phone: Escape closes it; the frame, the scroll and the focus are back', Math.abs(after.iframeTop - before.iframeTop) <= 1 && after.scrollY === before.scrollY && (await frame.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Edit Debt 14', { before, after })
    check('phone: no console error or CSP violation', ph.problems.length === 0, ph.problems)
  } finally { await ph.browser.close() }
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

/** A short description of the focused element, from the page's point of view, descending into the frame. */
async function describeFocus(page: Playwright.Page): Promise<string> {
  const host = await page.evaluate(() => {
    const el = document.activeElement
    if (el === null || el === document.body) return { kind: 'body' as const }
    if (el.tagName === 'IFRAME') return { kind: 'iframe' as const }
    const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return { kind: 'el' as const, text: `${el.tagName.toLowerCase()}${el.id === 'main' ? '#main' : ''} "${text}"` }
  })
  if (host.kind === 'body') return 'body'
  if (host.kind === 'el') return host.text
  const f = pageFrame(page)
  const inner = await f?.evaluate(() => {
    const el = document.activeElement
    if (el === null || el === document.body) return null
    const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
    return `${el.tagName.toLowerCase()} "${text}"`
  }).catch(() => null)
  return inner === null || inner === undefined ? 'iframe(nothing inside)' : inner
}

async function a11yChecks(pw: typeof Playwright, base: string): Promise<void> {
  await seedDebts(base, 4)
  for (const scheme of ['light', 'dark'] as const) {
    const o = await open(pw, base, { width: 1280, height: 900, scheme })
    try {
      const frame = await gotoPage(o, base, 'isolated')
      await sleep(600)
      const lm = await o.page.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length }))
      const fm = await frame.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length, h1Text: document.querySelector('h1')?.textContent, firstHeading: document.querySelector('h1,h2,h3')?.tagName, banner: document.querySelectorAll('header, [role="banner"]').length, nav: document.querySelectorAll('nav, [role="navigation"]').length, headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName}:${(h.textContent ?? '').trim().slice(0, 30)}`) }))
      check(`a11y ${scheme}: the host has exactly one main landmark, and the frame none`, lm.main === 1 && fm.main === 0, { host: lm, frame: fm })
      check(`a11y ${scheme}: the frame has exactly one h1, the first heading, naming the page`, fm.h1 === 1 && fm.h1Text === 'Debt payoff' && fm.firstHeading === 'H1', fm)
      note(`headings in the page frame (${scheme})`, fm.headings)
      const withAll = await axeRun(frame, [])
      note(`axe in the page frame with no exclusions (${scheme})`, withAll.map((v) => `${v.id}(${v.nodes})`))
      const inFrame = await axeRun(frame, FRAME_EXCLUDED_RULES)
      check(`a11y ${scheme}: axe in the page frame (WCAG 2 A/AA, 2.1, 2.2 AA, best practice), page-level rules excluded: 0 violations`, inFrame.length === 0, inFrame)
      const hostAxe = await axeRun(o.page.mainFrame(), ['page-has-heading-one'])
      check(`a11y ${scheme}: axe on the host document with the page frame in it, page-has-heading-one excluded: 0 violations`, hostAxe.length === 0, hostAxe)

      // With the dialog open: the frame document and the host document.
      await frame.getByRole('button', { name: 'Edit Debt 02' }).click()
      await frame.getByRole('dialog').waitFor()
      await eventually(async () => o.page.locator('.plugin-frame').getAttribute('data-lifted'), (v) => v === 'true')
      await sleep(300)
      const dlgFrame = await axeRun(frame, FRAME_EXCLUDED_RULES)
      check(`a11y ${scheme}: axe in the page frame with the dialog open: 0 violations`, dlgFrame.length === 0, dlgFrame)
      const dlgHost = await axeRun(o.page.mainFrame(), ['page-has-heading-one'])
      check(`a11y ${scheme}: axe on the host with the page frame lifted: 0 violations`, dlgHost.length === 0, dlgHost)
      const role = await frame.evaluate(() => { const d = document.querySelector('dialog')!; return { name: d.getAttribute('aria-labelledby') !== null ? document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent : null, modal: d.matches(':modal') } })
      check(`a11y ${scheme}: the dialog is a modal dialog named by its heading`, role.modal && role.name === 'Edit Debt 02', role)
      await o.page.keyboard.press('Escape')
      await sleep(300)
    } finally { await o.browser.close() }
  }

  // The widget frame, on the dashboard.
  for (const scheme of ['light', 'dark'] as const) {
    const o = await open(pw, base, { width: 1280, height: 2400, scheme })
    try {
      await o.page.goto(`${base}/`)
      await dismissWizard(o.page)
      const f = await (async () => { for (let i = 0; i < 300; i++) { const x = widgetFrame(o.page); if (x !== undefined && (await x.evaluate(() => document.querySelector('.dpw') !== null).catch(() => false))) return x; await sleep(50) } return undefined })()
      if (f === undefined) { check(`a11y ${scheme}: the widget frame draws`, false); continue }
      await sleep(400)
      const fm = await f.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length, headings: document.querySelectorAll('h1,h2,h3,h4').length }))
      check(`a11y ${scheme}: the widget frame has no landmarks and no heading of its own (the card's title is the host's)`, fm.main === 0 && fm.h1 === 0, fm)
      const axe = await axeRun(f, FRAME_EXCLUDED_RULES)
      check(`a11y ${scheme}: axe in the widget frame, page-level rules excluded: 0 violations`, axe.length === 0, axe)
      const hostAxe = await axeRun(o.page.mainFrame(), [])
      note(`axe on the dashboard with the widget frame (${scheme}), no exclusions`, hostAxe.map((v) => `${v.id}(${v.nodes}): ${v.target}`))
      check(`a11y ${scheme}: axe on the dashboard host document: 0 violations`, hostAxe.length === 0, hostAxe)
    } finally { await o.browser.close() }
  }

  // Tab order: the page in the page, and in a frame.
  const sequences: Record<string, string[]> = {}
  for (const mode of ['in-realm', 'isolated'] as Mode[]) {
    const server = await startServer(mode)
    try {
      const o = await open(pw, server.base, { width: 1280, height: 900 })
      try {
        const frame = await gotoPage(o, server.base, mode)
        await sleep(500)
        const describe = mode === 'isolated' ? describeFocus : async (p: Playwright.Page) => p.evaluate(() => { const el = document.activeElement; if (el === null || el === document.body) return 'body'; const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30); return `${el.tagName.toLowerCase()}${el.id === 'main' ? '#main' : ''} "${text}"` })
        void frame
        const first = async (): Promise<string[]> => { const out: string[] = []; for (let i = 0; i < 1; i++) { await o.page.keyboard.press('Tab'); await sleep(90); out.push(await describe(o.page)) } return out }
        const firstStop = (await first())[0]
        check(`a11y [${mode}]: the first Tab stop is the skip link`, firstStop?.includes('Skip to content') === true, firstStop)
        await o.page.keyboard.press('Enter')
        await sleep(100)
        const stops: string[] = []
        for (let i = 0; i < 30; i++) { await o.page.keyboard.press('Tab'); await sleep(90); stops.push(await describe(o.page)) }
        // The page's own stops are those up to the first 'body' (focus leaving the page); the order back is the reverse.
        const own = stops.slice(0, stops.indexOf('body'))
        await o.page.evaluate(() => document.getElementById('main')!.focus())
        for (let i = 0; i < own.length; i++) await o.page.keyboard.press('Tab')
        await sleep(150)
        const backs: string[] = [await describe(o.page)]
        for (let i = 0; i < own.length - 1; i++) { await o.page.keyboard.press('Shift+Tab'); await sleep(90); backs.push(await describe(o.page)) }
        sequences[`${mode} forward`] = own
        sequences[`${mode} backward`] = backs
        note(`Tab from <main> (${mode})`, stops)
        // The end of the page: where focus goes after the last control.
        await o.page.evaluate(() => document.getElementById('main')!.focus())
        const long: string[] = []
        for (let i = 0; i < 90; i++) { await o.page.keyboard.press('Tab'); await sleep(40); long.push(await describe(o.page)); if (long.at(-1) === 'body') break }
        sequences[`${mode} long`] = long
        check(`a11y [${mode}]: Tab leaves the page at its end (focus is not trapped in the last control)`, long.at(-1) === 'body' || long.at(-1)?.startsWith('iframe(') === true, long.slice(-4))
      } finally { await o.browser.close() }
    } finally { await server.close() }
  }
  const a = sequences['in-realm forward']!
  const b = sequences['isolated forward']!
  check('a11y: Tab from <main> visits the same controls, in the same order, in the frame as in the page (its own stops)', JSON.stringify(a) === JSON.stringify(b), { inRealm: a, isolated: b })
  check('a11y: Shift+Tab from the last control walks back through the same controls, in the reverse order, in the frame and in the page', JSON.stringify(sequences['in-realm backward']) === JSON.stringify([...a].reverse()) && JSON.stringify(sequences['isolated backward']) === JSON.stringify([...b].reverse()), { inRealm: sequences['in-realm backward'], isolated: sequences['isolated backward'] })
  report['tabSequences'] = sequences

  // Live regions in the page frame: the status region and the plan summary are in the accessibility tree and speak after a change.
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoPage(o, base, 'isolated')
    await sleep(500)
    const regions = await frame.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live]')].map((e) => ({ role: e.getAttribute('role'), live: e.getAttribute('aria-live'), text: (e.textContent ?? '').trim().slice(0, 60) })))
    note('live regions in the page frame at load', regions)
    const cdp = await o.ctx.newCDPSession(frame).catch(() => null)
    if (cdp !== null) {
      const tree = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: Array<{ role?: { value: string }; properties?: Array<{ name: string; value: { value: unknown } }>; ignored?: boolean }> }
      const live = tree.nodes.filter((n) => !n.ignored && (n.properties ?? []).some((p) => p.name === 'live' && p.value.value !== 'off'))
      note('accessibility tree of the page frame: nodes with a live setting', live.map((n) => ({ role: n.role?.value, live: n.properties!.find((p) => p.name === 'live')!.value.value })))
      check('a11y: the page frame\'s accessibility tree exposes its live regions (polite)', live.length >= 2 && live.every((n) => n.properties!.find((p) => p.name === 'live')!.value.value === 'polite'), live.length)
    } else note('accessibility tree of the page frame', 'the frame has no CDP target of its own')
    await frame.evaluate(() => { (window as unknown as { __seen: string[] }).__seen = []; new MutationObserver(() => { for (const e of document.querySelectorAll('[role="status"]')) { const t = (e.textContent ?? '').trim(); if (t !== '') (window as unknown as { __seen: string[] }).__seen.push(t.slice(0, 70)) } }).observe(document.body, { subtree: true, childList: true, characterData: true }) })
    await frame.getByRole('checkbox', { name: /Include Debt 02 in the payoff plan/ }).click()
    await sleep(900)
    const seen = await frame.evaluate(() => [...new Set((window as unknown as { __seen: string[] }).__seen)])
    note('status texts seen after switching a debt out of the plan', seen)
    check('a11y: the page\'s live region announces the toggle (inside the frame)', seen.some((t) => /Debt 02 left out of the plan/.test(t)), seen)
    await frame.getByRole('checkbox', { name: /Include Debt 02 in the payoff plan/ }).click()
    await sleep(500)
  } finally { await o.browser.close() }
}

// ---------------------------------------------------------------------------
// visual
// ---------------------------------------------------------------------------

async function visualChecks(pw: typeof Playwright, base: string): Promise<void> {
  await seedDebts(base, 4)
  // Phone layout of the page frame: the checkbox size and the table scroll, which are host CSS an in-realm page gets.
  const ph = await open(pw, base, { width: 390, height: 844 })
  try {
    const frame = await gotoPage(ph, base, 'isolated')
    await sleep(600)
    const m = await frame.evaluate(() => {
      const cb = document.querySelector('.dp-debts input[type="checkbox"], .dp input[type="checkbox"]') as HTMLInputElement | null
      const r = cb?.getBoundingClientRect()
      return { checkbox: r === undefined ? null : { w: Math.round(r.width), h: Math.round(r.height) }, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }
    })
    note('phone: the page frame\'s first checkbox and horizontal overflow', m)
    check('phone: tap targets: the page frame\'s checkboxes are 20 px, as they are for an in-realm page', m.checkbox !== null && m.checkbox.w >= 20 && m.checkbox.h >= 20, m)
    check('phone: no horizontal overflow in the page frame or on the host', m.scrollW <= m.clientW && (await ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), m)
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
      const fc = await frame.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim(), scheme: document.documentElement.getAttribute('data-theme') }))
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

/** `surface` is the page (time to the chart) or the dashboard (time to the Debt-free widget's content). */
async function sampleOnce(pw: typeof Playwright, base: string, mode: Mode, surface: 'page' | 'widget'): Promise<Sample> {
  const o = await open(pw, base, { width: 1280, height: surface === 'widget' ? 2400 : 900 })
  try {
    const cdp = await o.ctx.newCDPSession(o.page)
    await cdp.send('Network.enable')
    let transfer = 0
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => { transfer += e.encodedDataLength })
    const t0 = Date.now()
    await o.page.goto(`${base}${surface === 'page' ? PAGE_PATH : '/'}`)
    let frame: Playwright.Frame
    if (surface === 'page') frame = await waitForPage(o.page, mode)
    else {
      frame = o.page.mainFrame()
      for (let i = 0; i < 600; i++) {
        const f = mode === 'isolated' ? widgetFrame(o.page) : o.page.mainFrame()
        if (f !== undefined && (await f.evaluate(() => document.querySelector('.dpw') !== null).catch(() => false))) { frame = f; break }
        await sleep(30)
      }
    }
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

async function bytes(pw: typeof Playwright, base: string, mode: Mode, surface: 'page' | 'widget'): Promise<Array<{ owner: string; url: string; bytes: number; gzip: number }>> {
  const o = await open(pw, base, { width: 1280, height: surface === 'widget' ? 2400 : 900 })
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
    await o.page.goto(`${base}${surface === 'page' ? PAGE_PATH : '/'}`)
    if (surface === 'page') await waitForPage(o.page, mode)
    else for (let i = 0; i < 600; i++) { const f = mode === 'isolated' ? widgetFrame(o.page) : o.page.mainFrame(); if (f !== undefined && (await f.evaluate(() => document.querySelector('.dpw') !== null).catch(() => false))) break; await sleep(30) }
    await sleep(1200)
    await Promise.all(pending)
    return rows
  } finally { await o.browser.close() }
}

async function measure(pw: typeof Playwright): Promise<void> {
  const servers = { 'in-realm': await startServer('in-realm'), isolated: await startServer('isolated') }
  try {
    await seedDebts(servers.isolated.base, 5)
    for (const surface of ['page', 'widget'] as const) {
      const samples: Record<Mode, Sample[]> = { 'in-realm': [], isolated: [] }
      for (let i = 0; i < SAMPLES; i++) {
        for (const mode of (i % 2 === 0 ? ['in-realm', 'isolated'] : ['isolated', 'in-realm']) as Mode[]) {
          if (!MODES.includes(mode)) continue
          manifests(mode)
          const s = await sampleOnce(pw, servers[mode].base, mode, surface)
          samples[mode].push(s)
          console.log(`  ${surface} ${mode} #${i + 1}: ${JSON.stringify(s)}`)
        }
      }
      const rows: Record<string, unknown> = {}
      for (const mode of (['in-realm', 'isolated'] as Mode[]).filter((m) => MODES.includes(m))) {
        const s = samples[mode]
        rows[mode] = {
          n: s.length,
          readyMs: { median: median(s.map((x) => x.readyMs)), min: Math.min(...s.map((x) => x.readyMs)), max: Math.max(...s.map((x) => x.readyMs)) },
          rssMiB: { median: median(s.map((x) => x.rssMiB)), min: Math.min(...s.map((x) => x.rssMiB)), max: Math.max(...s.map((x) => x.rssMiB)) },
          renderers: median(s.map((x) => x.renderers)), mainHeapMiB: median(s.map((x) => x.mainHeapMiB)), frameHeapMiB: median(s.map((x) => x.frameHeapMiB)),
          frames: median(s.map((x) => x.frames)), transferKiB: median(s.map((x) => x.transferKiB)),
        }
      }
      report[`measure-${surface}`] = rows
      console.log(`\nMEASURE ${surface} (median of n, alternating order):`)
      console.log(JSON.stringify(rows, null, 2))
      if (MODES.length < 2) continue
      manifests('in-realm')
      const inr = await bytes(pw, servers['in-realm'].base, 'in-realm', surface)
      manifests('isolated')
      const iso = await bytes(pw, servers.isolated.base, 'isolated', surface)
      const sum = (rs: Array<{ owner: string; bytes: number; gzip: number }>, owner?: string): Record<string, number> => {
        const sel = owner === undefined ? rs : rs.filter((r) => r.owner === owner)
        return { files: sel.length, raw: sel.reduce((a, r) => a + r.bytes, 0), gzip: sel.reduce((a, r) => a + r.gzip, 0) }
      }
      report[`bytes-${surface}`] = { inRealm: sum(inr), isolatedPage: sum(iso, 'page'), isolatedFrame: sum(iso, 'frame'), isolatedAll: sum(iso) }
      console.log(`SCRIPT+STYLE BYTES ${surface}`, JSON.stringify(report[`bytes-${surface}`]))
    }
  } finally {
    await clearDebts(servers.isolated.base).catch(() => undefined)
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
  try {
    if (wants('load')) await loadChecks(pw, isolated.base)
    if (wants('writes')) await writeChecks(pw, isolated.base)
    if (wants('dialog')) await dialogChecks(pw, isolated.base)
    if (wants('a11y')) await a11yChecks(pw, isolated.base)
    if (wants('visual')) await visualChecks(pw, isolated.base)
  } finally {
    await clearDebts(isolated.base).catch(() => undefined)
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
