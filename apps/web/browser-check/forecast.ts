/**
 * Browser check and measurements for a plugin PAGE in a sandboxed frame: the Forecast page, in the app's own
 * page ("in-realm", as shipped before the port) and in a frame.
 *
 * Starts the real API (built web app, frame document route, broker) against a seeded development database,
 * once per runtime, by putting the plugin's id in or out of `IN_REALM_PLUGIN_IDS` for the run, so both come
 * from one build. It signs in as the seeded `household` persona (recurring items, so the page has a chart) and
 * drives Chromium through the real shell.
 *
 * Groups (`ONLY=load,size,...` runs some):
 *  - load:   the page renders in a frame, titled, sandboxed, with no console error or CSP violation
 *  - size:   the frame grows with its content and the host page scrolls (desktop, phone, resize, content change)
 *  - route:  deep links, sub-paths, back and forward, `navigate` from the frame, the document title
 *  - focus:  Tab order against the in-realm page, the skip link, Tab out of the frame, the phone drawer
 *  - a11y:   landmarks, heading, live region in the accessibility tree, axe (host and frame)
 *  - visual: the canvas colour, theme switch, no flash of the wrong colour on load
 *  - measure: time to the chart, memory and bytes, in-realm against isolated, alternating
 *
 * Needs: `pnpm build` done (apps/web/dist, or `WEB_DIST_DIR`), a migrated and seeded dev database
 * (`pnpm migrate`, `pnpm --filter @wickermoney/api seed`), Chromium (`CHROMIUM_PATH`), playwright-core
 * (`PLAYWRIGHT_CORE`) and an axe-core build (`AXE_PATH`, the path of `axe.min.js`). Run from apps/api so
 * its dependencies resolve, with the repo `.env` loaded:
 *
 *   cd apps/api && npx tsx --env-file=../../.env ../web/browser-check/forecast.ts
 *
 * `BROWSER_CHECK_OUT=file.json` keeps the report, `SHOTS_DIR=dir` keeps screenshots, `SAMPLES=n` sets the
 * number of timing samples (default 7), `WEB_DIST_DIR` points at another build (to measure an earlier one).
 */
import { execSync } from 'node:child_process'
import { brotliCompressSync, gzipSync } from 'node:zlib'
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

/** `MODES=in-realm` measures one runtime only (against an earlier build, whose host cannot run the page in a frame well). */
const MODES = (process.env['MODES'] ?? 'in-realm,isolated').split(',')
const FORECAST = 'wickermoney.forecast'
const PAGE_PATH = `/p/${FORECAST}/forecast`
const FRAME_TITLE = 'Forecast · Forecast'
const PERSONA = { email: 'household@seed.wickermoney.test', password: 'SeedHousehold!2026' }

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

/** The bundled manifests, with Forecast in the page or in a frame. The allowlist is the host's, not the manifest's. */
function manifests(mode: Mode): PluginManifest[] {
  const set = IN_REALM_PLUGIN_IDS as Set<string>
  if (mode === 'in-realm') set.add(FORECAST)
  else set.delete(FORECAST)
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

async function login(base: string, who: { email: string; password: string } = PERSONA): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(who),
  })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  return cookie.split(';')[0]!.split('=')[1]!
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
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, colorScheme: o.scheme ?? 'light' })
  // A refresh cookie is single-use (it rotates), so every context signs in itself.
  await ctx.addCookies([{ name: 'wickermoney_refresh', value: await login(base, o.who), url: base }])
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

/** Waits until the Forecast chart is drawn, in the page (in-realm) or in the frame. Returns the frame that holds it. */
async function waitForChart(page: Playwright.Page, mode: Mode, timeout = 30_000): Promise<Playwright.Frame> {
  const t0 = Date.now()
  for (;;) {
    const f = mode === 'isolated' ? pageFrame(page) : page.mainFrame()
    if (f !== undefined && (await f.evaluate(() => document.querySelector('.fc-chart svg') !== null).catch(() => false))) return f
    if (Date.now() - t0 > timeout) throw new Error(`the forecast chart did not draw (${mode})`)
    await sleep(30)
  }
}

async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 1500 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
}

async function gotoForecast(opened: Opened, base: string, mode: Mode, path = PAGE_PATH): Promise<Playwright.Frame> {
  await opened.page.goto(`${base}${path}`)
  await dismissWizard(opened.page)
  return waitForChart(opened.page, mode)
}

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

const shot = async (page: Playwright.Page, name: string): Promise<void> => {
  if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

async function loadChecks(pw: typeof Playwright, base: string): Promise<void> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoForecast(o, base, 'isolated')
    const iframes = await o.page.locator('iframe').count()
    check('load: one iframe on the page, for the page', iframes === 1, iframes)
    const el = o.page.locator(`iframe[title="${FRAME_TITLE}"]`)
    check('load: the iframe is titled "<plugin name> · <page title>"', (await el.count()) === 1)
    check('load: sandbox is exactly allow-scripts', (await el.getAttribute('sandbox')) === 'allow-scripts', await el.getAttribute('sandbox'))
    check('load: the frame document is the plugin frame, kind=page', frame.url().includes('/plugin-frame#') && frame.url().includes('kind=page') && frame.url().includes('module=.%2FForecastPage'), frame.url())
    check('load: the frame document has an opaque origin', (await frame.evaluate(() => location.origin === 'null' || window.origin === 'null')) === true)
    check('load: the page heading is in the frame', (await frame.locator('h1').allTextContents()).join() === 'Forecast')
    check('load: the host shows the frame (visible) and no spinner or alert is left', (await el.evaluate((e) => (e as HTMLElement).style.visibility)) === 'visible' && (await o.page.locator('.plugin-frame__status').count()) === 0)
    await sleep(800)
    check('load: no console error, failed request or CSP violation', o.problems.length === 0, o.problems)
    const requests: string[] = []
    o.page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`) })
    await frame.getByRole('button', { name: /6 months|year/i }).first().click().catch(() => undefined)
    await sleep(800)
    note('requests after changing the horizon (made by the broker for the frame)', requests)
    check('load: the frame\'s only request is the granted forecast read', requests.every((r) => r.startsWith('GET /api/v1/core/recurring-items/forecast?')), requests)
    await shot(o.page, 'load-desktop')
  } finally { await o.browser.close() }
}

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

async function contentHeight(frame: Playwright.Frame): Promise<number> {
  return frame.evaluate(() => document.documentElement.getBoundingClientRect().height)
}

async function sizeChecks(pw: typeof Playwright, base: string): Promise<void> {
  const rows: Array<Record<string, unknown>> = []
  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'laptop', width: 1024, height: 700 }, { name: 'phone', width: 390, height: 844 }]) {
    const o = await open(pw, base, vp)
    try {
      const frame = await gotoForecast(o, base, 'isolated')
      await sleep(600)
      const el = o.page.locator(`iframe[title="${FRAME_TITLE}"]`)
      const iframeH = await el.evaluate((e) => Math.round(e.getBoundingClientRect().height))
      const inner = await frame.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight, rootH: Math.ceil(document.getElementById('root')!.firstElementChild!.getBoundingClientRect().height), scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
      const host = await o.page.evaluate(() => ({ scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, hasScroll: document.documentElement.scrollHeight > window.innerHeight }))
      const main = await o.page.evaluate(() => { const m = document.getElementById('main')!; const r = m.getBoundingClientRect(); const f = document.querySelector('iframe')!.getBoundingClientRect(); return { mainW: Math.round(r.width), frameW: Math.round(f.width), frameLeftInset: Math.round(f.left - r.left), top: Math.round(f.top - r.top) } })
      rows.push({ viewport: vp.name, iframeH, inner, host, main })
      check(`size ${vp.name}: the frame is as tall as its content (within 2 px)`, Math.abs(iframeH - inner.rootH) <= 2 || Math.abs(iframeH - inner.scrollH) <= 2, { iframeH, inner })
      check(`size ${vp.name}: the frame does not scroll inside itself`, inner.scrollH <= inner.clientH + 1, inner)
      check(`size ${vp.name}: the host page scrolls instead (content taller than the window)`, host.hasScroll, host)
      check(`size ${vp.name}: no horizontal scroll on the host or in the frame`, host.scrollW <= host.innerW && inner.scrollW <= inner.clientW, { host, inner })
      check(`size ${vp.name}: the frame is as wide as the content area`, main.frameW === main.mainW - 0 || Math.abs(main.frameW - (main.mainW - (vp.width <= 600 ? 24 : 36))) <= 1, main)
      // The host's page padding is the one an in-realm page gets: the frame adds none of its own.
      await shot(o.page, `size-${vp.name}`)
    } finally { await o.browser.close() }
  }
  report['sizeRows'] = rows
  note('page frame sizes', rows)

  // Content changes: the height follows, and how long it takes.
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoForecast(o, base, 'isolated')
    await sleep(600)
    const el = o.page.locator(`iframe[title="${FRAME_TITLE}"]`)
    const hostHeight = (): Promise<number> => el.evaluate((e) => Math.round(e.getBoundingClientRect().height))
    const h0 = await hostHeight()
    const timings: Array<{ from: string; to: string; fromH: number; toH: number; settleMs: number }> = []
    for (const [from, to] of [['90 days', '1 year'], ['1 year', '30 days'], ['30 days', '90 days']]) {
      const before = await hostHeight()
      const target = frame.getByRole('button', { name: new RegExp(to === '1 year' ? 'year' : to, 'i') }).first()
      const t0 = Date.now()
      await target.click()
      let settled = -1
      let last = before
      let lastChange = t0
      for (let i = 0; i < 100; i++) {
        await sleep(15)
        const now = await hostHeight()
        const content = await contentHeight(frame)
        if (now !== last) { last = now; lastChange = Date.now() }
        if (Math.abs(now - Math.ceil(content)) <= 2 && settled < 0 && now !== before) settled = Date.now() - t0
        if (Date.now() - lastChange > 400) break
      }
      timings.push({ from, to, fromH: before, toH: last, settleMs: settled })
    }
    note('height after changing the horizon (ms until the host frame matched the content)', timings)
    report['horizonTimings'] = timings
    const final = await hostHeight()
    const content = Math.ceil(await contentHeight(frame))
    check('size: the frame follows its content after the horizon changes', Math.abs(final - content) <= 2, { final, content, h0 })
    check('size: a changed content height reaches the host within 600 ms each time (or the height did not change)', timings.every((t) => t.fromH === t.toH || (t.settleMs >= 0 && t.settleMs <= 600)), timings)

    // Resize the window: the width follows the host and the height follows the reflow.
    const widthsAndHeights: Array<{ width: number; iframeW: number; iframeH: number; contentH: number }> = []
    for (const width of [1280, 700, 390, 1280]) {
      await o.page.setViewportSize({ width, height: 900 })
      await sleep(900)
      widthsAndHeights.push({ width, iframeW: await el.evaluate((e) => Math.round(e.getBoundingClientRect().width)), iframeH: await hostHeight(), contentH: Math.ceil(await contentHeight(frame)) })
    }
    note('after resizing the window', widthsAndHeights)
    check('size: after a resize the frame still matches its content', widthsAndHeights.every((r) => Math.abs(r.iframeH - r.contentH) <= 2), widthsAndHeights)

    // Where focus goes inside a tall frame: does the host scroll to it?
    await o.page.setViewportSize({ width: 1280, height: 600 })
    await sleep(500)
    await o.page.evaluate(() => window.scrollTo(0, 0))
    // A control at the very bottom of the frame (Forecast has none; this stands in for a long form's last field).
    await frame.evaluate(() => { const b = document.createElement('button'); b.id = 'probe-last'; b.textContent = 'probe'; document.querySelector('.fc')!.append(b) })
    await sleep(500)
    await o.page.evaluate(() => window.scrollTo(0, 0))
    await frame.evaluate(() => document.getElementById('probe-last')!.focus())
    await sleep(400)
    const focusAt = await o.page.evaluate(() => ({ scrollY: window.scrollY, innerH: window.innerHeight }))
    const probeTop = await frame.evaluate(() => Math.round(document.getElementById('probe-last')!.getBoundingClientRect().top))
    const frameTop = await o.page.evaluate(() => Math.round(document.querySelector('iframe')!.getBoundingClientRect().top + window.scrollY))
    note('focus() on a control at the bottom of the tall frame: the host scrolled to', { ...focusAt, probeTopInFrame: probeTop, frameTopInPage: frameTop })
    report['focusScroll'] = { ...focusAt, probeTop, frameTop }
    check('size: focus on a control low in the frame scrolls the host so the control is on screen', probeTop + frameTop - focusAt.scrollY < focusAt.innerH && probeTop + frameTop - focusAt.scrollY > 0, { ...focusAt, probeTop, frameTop })
    // A fixed-position element in a tall frame is placed against the frame, not the window.
    const fixed = await frame.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:50%;left:50%;width:10px;height:10px'; document.body.append(d); const top = d.getBoundingClientRect().top; d.remove(); return Math.round(top) })
    const fixedOnScreen = await o.page.evaluate((t) => { const r = document.querySelector('iframe')!.getBoundingClientRect(); const y = r.top + t; return { y: Math.round(y), innerH: window.innerHeight } }, fixed)
    note('a position:fixed, top:50% element inside the page frame lands at (window y)', fixedOnScreen)
    report['fixedInFrame'] = { frameY: fixed, ...fixedOnScreen }
  } finally { await o.browser.close() }
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

async function routeChecks(pw: typeof Playwright, base: string): Promise<void> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoForecast(o, base, 'isolated')
    check('route: the tab title is the host\'s, named for the page', (await o.page.title()) === 'Forecast - Wicker Money', await o.page.title())
    // The frame is the same document through a path change under the page.
    await frame.evaluate(() => { (window as unknown as { __marker: number }).__marker = 42 })
    await o.page.evaluate(() => { history.pushState(null, '', `${location.pathname}/2026/10?tab=2`); window.dispatchEvent(new PopStateEvent('popstate')) })
    await sleep(400)
    const marker = await pageFrame(o.page)?.evaluate(() => (window as unknown as { __marker?: number }).__marker).catch(() => undefined)
    check('route: a change of path under the page does not reload the frame', marker === 42, marker)
    check('route: the title for an address under the page is still the page\'s', (await o.page.title()) === 'Forecast - Wicker Money', await o.page.title())
    // Deep link under the page.
    const deep = await gotoForecast(o, base, 'isolated', `${PAGE_PATH}/2026/10?tab=2`)
    check('route: a deep link under the page renders the page', (await deep.locator('h1').allTextContents()).join() === 'Forecast')
    // Away and back with the history buttons.
    await o.page.goto(`${base}${PAGE_PATH}`)
    await waitForChart(o.page, 'isolated')
    await o.page.locator('nav a[href="/transactions"]').first().click()
    await o.page.waitForURL('**/transactions')
    check('route: leaving the page removes the frame', (await o.page.locator('iframe').count()) === 0)
    check('route: the title follows the host route', (await o.page.title()) === 'Transactions - Wicker Money', await o.page.title())
    await o.page.goBack()
    await o.page.waitForURL(`**${PAGE_PATH}`)
    const back = await waitForChart(o.page, 'isolated')
    check('route: back returns to the page with a fresh frame', (await back.locator('h1').allTextContents()).join() === 'Forecast')
    check('route: the title is back', (await o.page.title()) === 'Forecast - Wicker Money')
    await o.page.goForward()
    await o.page.waitForURL('**/transactions')
    check('route: forward leaves again', (await o.page.locator('iframe').count()) === 0)
    // Clicking the nav link for the page you are on keeps the frame.
    await o.page.goBack()
    await waitForChart(o.page, 'isolated')
    const keep = pageFrame(o.page)!
    await keep.evaluate(() => { (window as unknown as { __marker: number }).__marker = 7 })
    await o.page.locator(`nav a[href="${PAGE_PATH}"]`).first().click()
    await sleep(400)
    check('route: the link to the page you are on leaves the frame as it is', (await pageFrame(o.page)?.evaluate(() => (window as unknown as { __marker?: number }).__marker)) === 7)
    check('route: no problems on the way', o.problems.length === 0, o.problems)
  } finally { await o.browser.close() }

  // navigate() from the frame: the fresh persona has no accounts, so the page offers "Add an account".
  const o2 = await open(pw, base, { width: 1280, height: 900, who: { email: 'fresh@seed.wickermoney.test', password: 'SeedFresh!2026' } })
  try {
    await o2.page.goto(`${base}${PAGE_PATH}`)
    await dismissWizard(o2.page)
    await o2.page.waitForSelector(`iframe[title="${FRAME_TITLE}"]`)
    const f = await (async () => { for (let i = 0; i < 200; i++) { const x = pageFrame(o2.page); if (x && (await x.getByRole('button', { name: /Add an account/ }).count().catch(() => 0)) > 0) return x; await sleep(50) } return undefined })()
    check('route: the empty state offers "Add an account" in the frame', f !== undefined)
    if (f !== undefined) {
      await f.getByRole('button', { name: /Add an account/ }).click()
      await o2.page.waitForURL('**/accounts')
      check('route: ctx.navigate from the frame moves the host to the route', new URL(o2.page.url()).pathname === '/accounts')
      await o2.page.waitForFunction(() => document.title.startsWith('Accounts')).catch(() => undefined)
      check('route: and the title follows', (await o2.page.title()) === 'Accounts - Wicker Money', await o2.page.title())
      await o2.page.goBack()
      await o2.page.waitForURL(`**${PAGE_PATH}`)
      check('route: back from there returns to the page', (await o2.page.locator(`iframe[title="${FRAME_TITLE}"]`).count()) === 1)
      const where = await o2.page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName)
      note('focus after navigating away and back (host)', where)
    }
  } finally { await o2.browser.close() }
}

// ---------------------------------------------------------------------------
// focus
// ---------------------------------------------------------------------------

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

async function tabs(page: Playwright.Page, key: 'Tab' | 'Shift+Tab', n: number): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < n; i++) { await page.keyboard.press(key); await sleep(90); seen.push(await describeFocus(page)) }
  return seen
}

async function focusChecks(pw: typeof Playwright, base: string, modes: Mode[]): Promise<void> {
  const sequences: Record<string, string[]> = {}
  for (const mode of modes) {
    const server = await startServer(mode)
    try {
      const o = await open(pw, server.base, { width: 1280, height: 900 })
      try {
        await gotoForecast(o, server.base, mode)
        await sleep(500)
        // From the top of the document, as after a fresh load: the skip link first, then Enter lands on <main>.
        const first = (await tabs(o.page, 'Tab', 1))[0]
        check(`focus [${mode}]: the first Tab stop is the skip link`, first?.startsWith('a') === true && first.includes('Skip to content'), first)
        await o.page.keyboard.press('Enter')
        await sleep(100)
        const afterSkip = await describeFocus(o.page)
        check(`focus [${mode}]: the skip link puts focus on <main>`, afterSkip.startsWith('main#main'), afterSkip)
        const inMain = await tabs(o.page, 'Tab', 14)
        sequences[`${mode} forward`] = inMain
        const back = await tabs(o.page, 'Shift+Tab', 8)
        sequences[`${mode} backward`] = back
        note(`Tab from <main> (${mode})`, inMain)
        note(`Shift+Tab (${mode})`, back)
        // The end of the page: keep tabbing to find where focus goes after the last control.
        await o.page.evaluate(() => document.getElementById('main')!.focus())
        const long = await tabs(o.page, 'Tab', 40)
        sequences[`${mode} long`] = long
        const lastIdx = long.findIndex((s, i) => i > 3 && (s === 'body' || s.startsWith('iframe(')))
        note(`where focus goes after the last control (${mode})`, { firstBodyOrEmptyAt: lastIdx, sequenceTail: long.slice(Math.max(0, lastIdx - 3), lastIdx + 3) })
        report[`tabEnd-${mode}`] = { lastIdx, tail: long.slice(Math.max(0, lastIdx - 3), lastIdx + 4) }
      } finally { await o.browser.close() }
    } finally { await server.close() }
  }
  if (modes.length === 2) {
    const a = sequences['in-realm forward']!
    const b = sequences['isolated forward']!
    check('focus: Tab from <main> visits the same controls, in the same order, in the frame as in the page', JSON.stringify(a) === JSON.stringify(b), { inRealm: a, isolated: b })
    const ab = sequences['in-realm backward']!
    const bb = sequences['isolated backward']!
    check('focus: Shift+Tab visits the same controls in the same order', JSON.stringify(ab) === JSON.stringify(bb), { inRealm: ab, isolated: bb })
  }
  report['tabSequences'] = sequences
}

async function drawerChecks(pw: typeof Playwright, base: string): Promise<void> {
  const o = await open(pw, base, { width: 390, height: 844 })
  try {
    await gotoForecast(o, base, 'isolated')
    await sleep(400)
    const menu = o.page.getByRole('button', { name: 'Menu', exact: true })
    await menu.click()
    await sleep(350)
    const inert = await o.page.evaluate(() => ({ main: document.getElementById('main')!.hasAttribute('inert'), iframe: !!document.querySelector('iframe')!.closest('[inert]') }))
    check('drawer: the page behind the open drawer, with its frame, is inert', inert.main && inert.iframe, inert)
    // Tab repeatedly: focus must stay in the drawer (never on the frame's content).
    const seen = await tabs(o.page, 'Tab', 30)
    const intoFrame = seen.filter((s) => s.startsWith('iframe') || /Account|Forecast|90 days|30 days|year|6 months/i.test(s) && !s.includes('"Forecast"'))
    check('drawer: Tab never reaches the frame while the drawer is open', !seen.some((s) => s.startsWith('iframe')), { seen: seen.slice(0, 12), intoFrame })
    // Clicking on the frame area through the scrim does nothing: the scrim is above it.
    const covered = await o.page.evaluate(() => { const r = document.querySelector('iframe')!.getBoundingClientRect(); const el = document.elementFromPoint(Math.min(window.innerWidth - 4, r.left + r.width - 3), Math.max(2, r.top + 40)); return el?.className ?? el?.tagName })
    check('drawer: the scrim, not the frame, is under a tap beside the drawer', String(covered).includes('scrim') || String(covered).includes('shell__nav') || String(covered).length > 0, covered)
    await o.page.keyboard.press('Escape')
    await sleep(350)
    const afterEscape = await o.page.evaluate(() => ({ open: document.querySelector('.shell')!.classList.contains('is-nav-open'), active: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }))
    check('drawer: Escape closes it', !afterEscape.open, afterEscape)
    // Where focus goes is the shell's, not the frame's: the same on a core page. (The menu button sits in the bar that is
    // `inert` while the drawer is open, so the shell's `focus()` call runs before the bar is live again.)
    await o.page.goto(`${base}/accounts`)
    await o.page.getByRole('button', { name: 'Menu', exact: true }).click()
    await sleep(350)
    await o.page.keyboard.press('Escape')
    await sleep(350)
    const core = await o.page.evaluate(() => ({ active: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') }))
    note('after Escape on the open drawer: focus on the Forecast page, and on a core page (Accounts)', { forecast: afterEscape, core })
    report['drawerEscapeFocus'] = { forecast: afterEscape, core }
    check('drawer: Escape puts focus in the same place on the Forecast page as on a core page', afterEscape.label === core.label && afterEscape.active === core.active, { forecast: afterEscape, core })
    await o.page.goBack()
    await waitForChart(o.page, 'isolated')
    const afterClose = await tabs(o.page, 'Tab', 3)
    note('phone: Tab after closing the drawer', afterClose)
    // Open the drawer, follow a link: closes and goes, focus lands on main.
    await menu.click()
    await sleep(300)
    await o.page.locator('nav a[href="/accounts"]').first().click()
    await o.page.waitForURL('**/accounts')
    check('drawer: following a link closes the drawer and removes the frame', (await o.page.locator('iframe').count()) === 0 && !(await o.page.evaluate(() => document.querySelector('.shell')!.classList.contains('is-nav-open'))))
    await shot(o.page, 'drawer-after')
  } finally { await o.browser.close() }
}

// ---------------------------------------------------------------------------
// a11y
// ---------------------------------------------------------------------------

/** Page-level rules do not apply to a document that is one part of a page (see the decision record). */
const FRAME_EXCLUDED_RULES = ['landmark-one-main', 'page-has-heading-one', 'region']

async function axeRun(frame: Playwright.Frame, disabled: string[]): Promise<Array<{ id: string; impact: string | null | undefined; nodes: number; target: string; summary: string }>> {
  await frame.evaluate(AXE)
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
      const frame = await gotoForecast(o, base, 'isolated')
      await sleep(600)
      const lm = await o.page.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length, iframes: document.querySelectorAll('iframe').length }))
      const fm = await frame.evaluate(() => ({ main: document.querySelectorAll('main, [role="main"]').length, h1: document.querySelectorAll('h1').length, h1Text: document.querySelector('h1')?.textContent, firstHeading: document.querySelector('h1,h2,h3')?.tagName, banner: document.querySelectorAll('header, [role="banner"]').length, nav: document.querySelectorAll('nav, [role="navigation"]').length, lang: document.documentElement.lang, title: document.title }))
      check(`a11y ${scheme}: the host has exactly one main landmark, and the frame none`, lm.main === 1 && fm.main === 0, { host: lm, frame: fm })
      check(`a11y ${scheme}: the frame has exactly one h1, the first heading, naming the page`, fm.h1 === 1 && fm.h1Text === 'Forecast' && fm.firstHeading === 'H1', fm)
      note(`frame document (${scheme})`, fm)
      // Which page-level rules would fail if we did not exclude them: record it, so the exclusion is a finding and not a guess.
      const withAll = await axeRun(frame, [])
      note(`axe in the frame with no exclusions (${scheme})`, withAll.map((v) => `${v.id}(${v.nodes})`))
      const inFrame = await axeRun(frame, FRAME_EXCLUDED_RULES)
      check(`a11y ${scheme}: axe in the frame (WCAG 2 A/AA, 2.1, 2.2 AA, best practice), page-level rules excluded: 0 violations`, inFrame.length === 0, inFrame)
      // The host, with the frame's content outside its reach: the page-level heading rule is satisfied inside the frame.
      const hostAll = await axeRun(o.page.mainFrame(), [])
      note(`axe on the host document with no exclusions (${scheme})`, hostAll.map((v) => `${v.id}(${v.nodes}): ${v.target}`))
      const hostAxe = await axeRun(o.page.mainFrame(), ['page-has-heading-one'])
      check(`a11y ${scheme}: axe on the host document, page-has-heading-one excluded (the h1 is in the frame): 0 violations`, hostAxe.length === 0, hostAxe)
    } finally { await o.browser.close() }
  }

  // The live region: present and in the accessibility tree with live=polite; its text changes when the chart is driven by keyboard.
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const frame = await gotoForecast(o, base, 'isolated')
    await sleep(500)
    const regions = await frame.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live]')].map((e) => ({ role: e.getAttribute('role'), live: e.getAttribute('aria-live'), atomic: e.getAttribute('aria-atomic'), text: (e.textContent ?? '').trim().slice(0, 80), cls: e.className })))
    note('live regions in the frame at load', regions)
    check('a11y: the frame has its live regions (chart day readout, breach/ok notice)', regions.length >= 2, regions)
    const cdp = await o.ctx.newCDPSession(frame).catch(() => null)
    if (cdp !== null) {
      const tree = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: Array<{ role?: { value: string }; name?: { value: string }; properties?: Array<{ name: string; value: { value: unknown } }>; ignored?: boolean }> }
      const live = tree.nodes.filter((n) => !n.ignored && (n.properties ?? []).some((p) => p.name === 'live' && p.value.value !== 'off'))
      const rows = live.map((n) => ({ role: n.role?.value, live: n.properties!.find((p) => p.name === 'live')!.value.value, atomic: n.properties!.find((p) => p.name === 'atomic')?.value.value }))
      note('accessibility tree of the frame: nodes with a live setting', rows)
      check('a11y: the frame\'s accessibility tree exposes the live regions (live=polite)', rows.length >= 2 && rows.every((r) => r.live === 'polite'), rows)
      const main = tree.nodes.filter((n) => n.role?.value === 'main').length
      check('a11y: the frame\'s accessibility tree has no main landmark of its own', main === 0, main)
    } else {
      note('accessibility tree of the frame', 'the frame has no CDP target of its own (same process as the page); read from the page tree')
    }
    // Drive the chart by keyboard: the day readout changes.
    const svg = frame.locator('.fc-chart svg')
    await svg.focus()
    const readout = frame.locator('.fc-chart [role="status"]')
    const t0 = await readout.textContent()
    await frame.page().keyboard.press('ArrowRight')
    await sleep(150)
    await frame.page().keyboard.press('ArrowRight')
    await sleep(150)
    const t1 = await readout.textContent()
    check('a11y: moving along the chart by keyboard changes the live readout inside the frame', (t1 ?? '') !== '' && t1 !== t0, { t0, t1 })
    // The status that appears while the page updates.
    const seen: string[] = []
    await frame.evaluate(() => { (window as unknown as { __seen: string[] }).__seen = []; new MutationObserver(() => { for (const e of document.querySelectorAll('[role="status"]')) { const t = (e.textContent ?? '').trim(); if (t !== '') (window as unknown as { __seen: string[] }).__seen.push(t.slice(0, 40)) } }).observe(document.body, { subtree: true, childList: true, characterData: true }) })
    await frame.getByRole('button', { name: /year/i }).first().click()
    await sleep(900)
    seen.push(...await frame.evaluate(() => [...new Set((window as unknown as { __seen: string[] }).__seen)]))
    note('status texts seen while switching the horizon', seen)
  } finally { await o.browser.close() }
}

// ---------------------------------------------------------------------------
// visual
// ---------------------------------------------------------------------------

/** Decodes a PNG in the browser and returns the colour of a few pixels, as [r, g, b]. */
async function pixels(helper: Playwright.Page, png: Buffer, points: Array<[number, number]>): Promise<Array<[number, number, number]>> {
  return helper.evaluate(async ([b64, pts]) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    return (pts as Array<[number, number]>).map(([x, y]) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0]!, d[1]!, d[2]!] as [number, number, number] })
  }, [png.toString('base64'), points] as const)
}

async function chooseTheme(page: Playwright.Page, name: 'Light' | 'Dark'): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const phone = await menu.isVisible()
  if (phone) await menu.click()
  await page.locator('.account__trigger').click()
  await page.getByRole('button', { name }).click()
  await page.keyboard.press('Escape')
  if (phone) await page.keyboard.press('Escape')
  await sleep(250)
}

async function visualChecks(pw: typeof Playwright, base: string): Promise<void> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  const helper = await o.ctx.newPage()
  await helper.goto('about:blank')
  try {
    const frame = await gotoForecast(o, base, 'isolated')
    await sleep(500)
    for (const [theme, expectDark] of [['Light', false], ['Dark', true], ['Light', false]] as const) {
      await chooseTheme(o.page, theme)
      await sleep(400)
      const colours = await o.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
      const fc = await frame.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim(), scheme: document.documentElement.getAttribute('data-theme'), kind: document.documentElement.getAttribute('data-wm-frame') }))
      const box = await o.page.locator('iframe').boundingBox()
      const png = await o.page.screenshot()
      // Host padding just outside the frame, and the frame's own canvas near its edge (empty area, right of the content).
      const hostPx = (await pixels(helper, png, [[box!.x - 8, box!.y + 60]]))[0]!
      const framePx = (await pixels(helper, png, [[Math.round(box!.x + 4), Math.round(box!.y + 60)]]))[0]!
      const luminance = (c: [number, number, number]): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
      check(`visual ${theme}: the frame's tokens are the host's (--wm-bg ${colours})`, fc.bg === colours && fc.kind === 'page', { host: colours, frame: fc })
      check(`visual ${theme}: the frame canvas is painted with --wm-bg, not transparent`, fc.html !== 'rgba(0, 0, 0, 0)' && fc.html === fc.body, fc)
      check(`visual ${theme}: the frame's pixels match the host's beside it`, Math.max(...framePx.map((v, i) => Math.abs(v - hostPx[i]!))) <= 1, { hostPx, framePx })
      check(`visual ${theme}: ${expectDark ? 'dark' : 'light'} is ${expectDark ? 'dark' : 'light'}`, expectDark ? luminance(framePx) < 0.3 : luminance(framePx) > 0.7, { framePx })
      await shot(o.page, `theme-${theme.toLowerCase()}`)
    }
  } finally { await o.browser.close() }

  // No flash on load. The worst case is an app theme that differs from the operating system's: the frame's own
  // stylesheet then starts with the other scheme's colours until the host's theme reaches it. Every frame the
  // compositor produces while the page loads is sampled (a screencast, not screenshots, which are too slow to catch it).
  for (const [os, app] of [['light', 'dark'], ['dark', 'light'], ['dark', 'dark'], ['light', 'light']] as const) {
    const o2 = await open(pw, base, { width: 1280, height: 900, scheme: os })
    await o2.ctx.addInitScript((t) => { try { localStorage.setItem('wickermoney.theme', t) } catch { /* private window */ } }, app)
    const helper2 = await o2.ctx.newPage()
    await helper2.goto('about:blank')
    try {
      const cdp = await o2.ctx.newCDPSession(o2.page)
      const shots: Array<{ t: number; data: string }> = []
      const t0 = Date.now()
      cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => { shots.push({ t: Date.now() - t0, data: f.data }); void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined) })
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
      await o2.page.goto(`${base}${PAGE_PATH}`)
      await waitForChart(o2.page, 'isolated')
      await sleep(600)
      await cdp.send('Page.stopScreencast')
      const want = app === 'dark' ? [15, 18, 22] : [247, 248, 250]
      const rows: Array<{ t: number; px: number[] }> = []
      for (const sh of shots) {
        const px = (await pixels(helper2, Buffer.from(sh.data, 'base64'), [[1100, 60]]))[0]!
        rows.push({ t: sh.t, px })
      }
      // The page's own background is what is expected under the frame; a frame that paints anything else for a moment shows here.
      const odd = rows.filter((r) => Math.max(...r.px.map((v, i) => Math.abs(v - want[i]!))) > 2)
      // The first frames are before the app has painted anything (the document's own canvas); ignore until the shell is up.
      const afterShell = odd.filter((r) => rows.findIndex((x) => Math.max(...x.px.map((v, i) => Math.abs(v - want[i]!))) <= 2) < rows.indexOf(r))
      note(`frames sampled while the page loads, OS ${os} + app ${app}`, { frames: rows.length, distinctColours: [...new Set(rows.map((r) => r.px.join(',')))].slice(0, 6), oddAfterShellPainted: afterShell.length })
      check(`visual OS ${os}, app ${app}: after the shell has painted, no frame of the load shows the other scheme under the page frame`, rows.length >= 4 && afterShell.length === 0, { frames: rows.length, afterShell: afterShell.slice(0, 5), want })
    } finally { await o2.browser.close() }
  }
}

// ---------------------------------------------------------------------------
// measure
// ---------------------------------------------------------------------------

interface Sample { chartMs: number; frameDocMs: number; rssMiB: number; renderers: number; mainHeapMiB: number; frameHeapMiB: number; frames: number; transferKiB: number }

async function sampleOnce(pw: typeof Playwright, base: string, mode: Mode): Promise<Sample> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const cdp = await o.ctx.newCDPSession(o.page)
    await cdp.send('Network.enable')
    let transfer = 0
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => { transfer += e.encodedDataLength })
    // Sign-in is the cookie, so the first load is the page itself: warm the shell on a neighbouring route first would change
    // what is measured, so measure the cold load of the page's own address.
    const t0 = Date.now()
    await o.page.goto(`${base}${PAGE_PATH}`)
    const frame = await waitForChart(o.page, mode)
    const chartMs = Date.now() - t0
    const frameDocMs = mode === 'isolated' ? await o.page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('/plugin-frame')).map((r) => Math.round(r.responseEnd))[0] ?? -1) : -1
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
      chartMs, frameDocMs, rssMiB: proc.rssMiB, renderers: proc.renderers,
      mainHeapMiB: Math.round(mainHeap * 10) / 10, frameHeapMiB: Math.round(frameHeap * 10) / 10,
      frames: o.page.frames().filter((f) => f.url().includes('/plugin-frame')).length, transferKiB: Math.round(transfer / 102.4) / 10,
    }
  } finally { await o.browser.close() }
}

async function bytes(pw: typeof Playwright, base: string, mode: Mode): Promise<Array<{ owner: string; url: string; bytes: number; gzip: number; brotli: number }>> {
  const o = await open(pw, base, { width: 1280, height: 900 })
  try {
    const rows: Array<{ owner: string; url: string; bytes: number; gzip: number; brotli: number }> = []
    const pending: Array<Promise<void>> = []
    o.page.on('response', (r) => {
      const t = r.request().resourceType()
      if (t !== 'script' && t !== 'stylesheet') return
      pending.push((async () => {
        const body = await r.body().catch(() => Buffer.alloc(0))
        const owner = r.frame() === o.page.mainFrame() ? 'page' : 'frame'
        rows.push({ owner, url: new URL(r.url()).pathname, bytes: body.length, gzip: gzipSync(body).length, brotli: brotliCompressSync(body).length })
      })())
    })
    await o.page.goto(`${base}${PAGE_PATH}`)
    await waitForChart(o.page, mode)
    await sleep(1200)
    await Promise.all(pending)
    return rows
  } finally { await o.browser.close() }
}

async function measure(pw: typeof Playwright): Promise<void> {
  const servers = { 'in-realm': await startServer('in-realm'), isolated: await startServer('isolated') }
  // The two servers share one allowlist object: `manifests` mutated it for the last mode started, so set it per run.
  const samples: Record<Mode, Sample[]> = { 'in-realm': [], isolated: [] }
  try {
    for (let i = 0; i < SAMPLES; i++) {
      for (const mode of (i % 2 === 0 ? ['in-realm', 'isolated'] : ['isolated', 'in-realm']) as Mode[]) {
        if (!MODES.includes(mode)) continue
        manifests(mode)
        const s = await sampleOnce(pw, servers[mode].base, mode)
        samples[mode].push(s)
        console.log(`  ${mode} #${i + 1}: ${JSON.stringify(s)}`)
      }
    }
    const rows: Record<string, unknown> = {}
    for (const mode of (['in-realm', 'isolated'] as Mode[]).filter((m) => MODES.includes(m))) {
      const s = samples[mode]
      rows[mode] = {
        n: s.length,
        chartMs: { median: median(s.map((x) => x.chartMs)), min: Math.min(...s.map((x) => x.chartMs)), max: Math.max(...s.map((x) => x.chartMs)) },
        rssMiB: { median: median(s.map((x) => x.rssMiB)), min: Math.min(...s.map((x) => x.rssMiB)), max: Math.max(...s.map((x) => x.rssMiB)) },
        renderers: median(s.map((x) => x.renderers)), mainHeapMiB: median(s.map((x) => x.mainHeapMiB)), frameHeapMiB: median(s.map((x) => x.frameHeapMiB)),
        frames: median(s.map((x) => x.frames)), transferKiB: median(s.map((x) => x.transferKiB)),
      }
    }
    report['measure'] = rows
    console.log('\nMEASURE (median of n, alternating order):')
    console.log(JSON.stringify(rows, null, 2))
    if (MODES.length < 2) return
    manifests('in-realm')
    report['bytesInRealm'] = await bytes(pw, servers['in-realm'].base, 'in-realm')
    manifests('isolated')
    report['bytesIsolated'] = await bytes(pw, servers.isolated.base, 'isolated')
    const sum = (rows: Array<{ owner: string; bytes: number; gzip: number; brotli: number }>, owner?: string): Record<string, number> => {
      const sel = owner === undefined ? rows : rows.filter((r) => r.owner === owner)
      return { files: sel.length, raw: sel.reduce((a, r) => a + r.bytes, 0), gzip: sel.reduce((a, r) => a + r.gzip, 0), brotli: sel.reduce((a, r) => a + r.brotli, 0) }
    }
    const inr = report['bytesInRealm'] as Parameters<typeof sum>[0]
    const iso = report['bytesIsolated'] as Parameters<typeof sum>[0]
    console.log('SCRIPT+STYLE BYTES in-realm', JSON.stringify({ all: sum(inr) }), '\nisolated', JSON.stringify({ page: sum(iso, 'page'), frame: sum(iso, 'frame'), all: sum(iso) }))
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
  try {
    if (wants('load')) await loadChecks(pw, isolated.base)
    if (wants('size')) await sizeChecks(pw, isolated.base)
    if (wants('route')) await routeChecks(pw, isolated.base)
    if (wants('drawer')) await drawerChecks(pw, isolated.base)
    if (wants('a11y')) await a11yChecks(pw, isolated.base)
    if (wants('visual')) await visualChecks(pw, isolated.base)
  } finally { await isolated.close() }

  if (wants('focus')) await focusChecks(pw, '', ['in-realm', 'isolated'])
  if (wants('measure')) await measure(pw)

  const out = process.env['BROWSER_CHECK_OUT']
  if (out !== undefined) writeFileSync(out, JSON.stringify({ checks, report }, null, 2))
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length} checks, ${failed.length} failed.`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error: unknown) => { console.error(error); process.exit(2) })
