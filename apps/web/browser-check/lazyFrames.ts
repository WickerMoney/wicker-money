/**
 * Lazy plugin frames: behaviour check and before/after measurement on the seeded dashboard.
 *
 * Starts the real API against a seeded development database (as `insights.ts` does: `pnpm migrate`,
 * then `pnpm --filter @wickermoney/api seed`, `DATABASE_URL` pointing at it), signs in as the `hero`
 * persona and drives Chromium through the dashboard.
 *
 *   cd apps/api
 *   DATABASE_URL=... WEB_DIST_DIR_AFTER=../web/dist WEB_DIST_DIR_BEFORE=/path/to/older/dist \
 *     npx tsx ../web/browser-check/lazyFrames.ts
 *
 * - `MODE=check` (default): with the build in `WEB_DIST_DIR_AFTER`, a frame below the fold is not created at
 *   load, its placeholder reserves room and is not tabbable, scrolling creates it and it connects, and
 *   a viewport tall enough for everything creates every frame at load.
 * - `MODE=measure`: alternates `WEB_DIST_DIR_BEFORE` and `WEB_DIST_DIR_AFTER` sample by sample and prints
 *   the median of `SAMPLES` (default 7) for time to the first widget, time to all widgets in the first
 *   screen, iframes and browser memory at load and after scrolling to the bottom. Memory is the
 *   proportional set size (shared pages counted once) of the browser process tree.
 *
 * `VIEWPORT=390x844` sets the window (default 1280x900). `BROWSER_CHECK_OUT=file.json` keeps the numbers. `CHROMIUM_PATH`, `PLAYWRIGHT_CORE` as for `run.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import type * as Playwright from 'playwright-core'
import { buildApp } from '../../api/src/app.js'
import { loadConfig } from '../../api/src/config.js'
import { KyselyUnitOfWork } from '../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../api/src/db/configureTenantContext.js'
import { createDb } from '../../api/src/db/client.js'
import { BUNDLED_PLUGINS } from '../../api/src/plugins/bundled.js'
import { PluginService } from '../../api/src/plugins/service/PluginService.js'

const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AFTER = resolve(process.env['WEB_DIST_DIR_AFTER'] ?? '../web/dist')
const BEFORE = process.env['WEB_DIST_DIR_BEFORE'] === undefined ? undefined : resolve(process.env['WEB_DIST_DIR_BEFORE'])
const MODE = process.env['MODE'] ?? 'check'
const SAMPLES = Number(process.env['SAMPLES'] ?? 7)
const [VW, VH] = (process.env['VIEWPORT'] ?? '1280x900').split('x').map(Number)
const VIEWPORT = { width: VW!, height: VH! }
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN

interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

async function startServer(dist: string) {
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
  await app.listen({ port: 0, host: 'localhost' })
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://localhost:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

async function login(base: string): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'hero@seed.wickermoney.test', password: 'SeedHero!2026' }),
  })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  return cookie.split(';')[0]!.split('=')[1]!
}

/** Proportional set size, in MiB, of the processes below `rootPid` (falls back to RSS). */
function treeMemory(rootPid: number): { mib: number; renderers: number } {
  const rows = execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf8' }).split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter((m): m is RegExpMatchArray => m !== null)
  const children = new Map<number, Array<{ pid: number; args: string }>>()
  for (const m of rows) {
    const list = children.get(Number(m[2])) ?? []
    list.push({ pid: Number(m[1]), args: m[3]! })
    children.set(Number(m[2]), list)
  }
  let kib = 0
  let renderers = 0
  const walk = (pid: number): void => {
    try {
      const smaps = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8')
      kib += Number(/^Pss:\s+(\d+)/m.exec(smaps)?.[1] ?? 0)
    } catch { /* gone */ }
    for (const c of children.get(pid) ?? []) {
      if (c.args.includes('--type=renderer')) renderers += 1
      walk(c.pid)
    }
  }
  walk(rootPid)
  return { mib: Math.round(kib / 1024), renderers }
}

/** The pid of the browser process this script started: the Chromium whose parent is this process. */
function browserPid(): number {
  const out = execSync(`ps -eo pid=,ppid=,args= | awk '$2==${process.pid}'`, { encoding: 'utf8' })
  const line = out.split('\n').find((l) => l.includes('chrom'))
  if (line === undefined) throw new Error('browser process not found')
  return Number(line.trim().split(/\s+/)[0])
}

async function open(pw: typeof Playwright, base: string, refresh: string, viewport = VIEWPORT) {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies([{ name: 'wickermoney_refresh', value: refresh, url: base }])
  const page = await ctx.newPage()
  return { browser, page, pid: browserPid() }
}

interface WidgetState { top: number; height: number; kind: 'waiting' | 'frame-ready' | 'frame-loading' | 'page-ready' | 'page-loading' }
/** Every dashboard widget card: where it is and whether its content has arrived. Runs in the page. */
const WIDGETS = `(() => [...document.querySelectorAll('.slot-item')].map((el) => {
  const r = el.getBoundingClientRect();
  const frame = el.querySelector('.plugin-frame');
  let kind;
  if (frame) {
    const st = frame.getAttribute('data-status');
    kind = st === 'waiting' ? 'waiting' : st === 'ready' ? 'frame-ready' : 'frame-loading';
  } else kind = el.querySelector('[role="status"]') ? 'page-loading' : 'page-ready';
  return { top: r.top + scrollY, height: r.height, kind };
}))()`

async function widgets(page: Playwright.Page): Promise<WidgetState[]> {
  return page.evaluate(WIDGETS) as Promise<WidgetState[]>
}
const isReady = (w: WidgetState): boolean => w.kind === 'frame-ready' || w.kind === 'page-ready'

/** Resolves with ms from navigation start (page clock) when `done` holds, polling the page. */
async function until(page: Playwright.Page, done: (w: WidgetState[]) => boolean, timeoutMs = 30_000): Promise<number> {
  const t0 = Date.now()
  for (;;) {
    const w = await widgets(page)
    if (w.length > 0 && done(w)) return page.evaluate(() => performance.now())
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out: ${JSON.stringify(w)}`)
    await sleep(20)
  }
}

interface Sample { firstMs: number; screenMs: number; framesLoad: number; framesBottom: number; widgets: number; mibLoad: number; mibBottom: number; renderersLoad: number; renderersBottom: number }

async function sample(pw: typeof Playwright, base: string): Promise<Sample> {
  const { browser, page, pid } = await open(pw, base, await login(base))
  try {
    await page.goto(`${base}/`)
    const firstMs = await until(page, (w) => w.some(isReady))
    // The first screen: the cards whose top starts inside the viewport.
    const screenMs = await until(page, (w) => w.filter((x) => x.top < VIEWPORT.height).every(isReady))
    await sleep(3000)
    const framesLoad = await page.locator('iframe').count()
    const load = treeMemory(pid)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await until(page, (w) => w.every(isReady))
    await sleep(3000)
    const framesBottom = await page.locator('iframe').count()
    const bottom = treeMemory(pid)
    return {
      firstMs: Math.round(firstMs), screenMs: Math.round(screenMs), framesLoad, framesBottom,
      widgets: (await widgets(page)).length, mibLoad: load.mib, mibBottom: bottom.mib,
      renderersLoad: load.renderers, renderersBottom: bottom.renderers,
    }
  } finally { await browser.close() }
}

async function measure(pw: typeof Playwright): Promise<void> {
  if (BEFORE === undefined) throw new Error('MODE=measure needs WEB_DIST_DIR_BEFORE')
  const before = await startServer(BEFORE)
  const after = await startServer(AFTER)
  const rows: Record<'before' | 'after', Sample[]> = { before: [], after: [] }
  try {
    // One throwaway sample each: the first run pays for cold file caches.
    await sample(pw, before.base); await sample(pw, after.base)
    for (let i = 0; i < SAMPLES; i++) {
      // Alternate the order so neither build is always the one that runs second.
      const order = i % 2 === 0 ? (['before', 'after'] as const) : (['after', 'before'] as const)
      for (const which of order) {
        const s = await sample(pw, which === 'before' ? before.base : after.base)
        rows[which].push(s)
        console.log(which, JSON.stringify(s))
      }
    }
  } finally { await before.close(); await after.close() }
  const med = (w: 'before' | 'after', k: keyof Sample): number => median(rows[w].map((s) => s[k]))
  const summary: Record<string, Record<string, number>> = {}
  for (const k of ['firstMs', 'screenMs', 'framesLoad', 'framesBottom', 'widgets', 'mibLoad', 'mibBottom', 'renderersLoad', 'renderersBottom'] as const) {
    summary[k] = { before: med('before', k), after: med('after', k) }
  }
  console.table(summary)
  const out = process.env['BROWSER_CHECK_OUT']
  if (out !== undefined) writeFileSync(out, JSON.stringify({ samples: SAMPLES, summary, rows }, null, 2))
}

async function behaviour(pw: typeof Playwright): Promise<void> {
  const server = await startServer(AFTER)
  try {
    const { browser, page } = await open(pw, server.base, await login(server.base))
    try {
      await page.goto(`${server.base}/`)
      await until(page, (w) => w.filter((x) => x.top < VIEWPORT.height).every(isReady))
      await sleep(500)
      const w = await widgets(page)
      const frameWidgets = await page.locator('.slot-item .plugin-frame').count()
      const waiting = w.filter((x) => x.kind === 'waiting')
      const docHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      console.log(`widgets: ${w.length}, in frames: ${frameWidgets}, waiting: ${waiting.length}, iframes: ${await page.locator('iframe').count()}, document height ${docHeight}`)
      check('the dashboard has frame widgets and some are below the fold at load', frameWidgets >= 2 && waiting.length >= 1, { frameWidgets, waiting: waiting.length })
      check('a waiting widget has no iframe', (await page.locator('.plugin-frame[data-status="waiting"] iframe').count()) === 0)
      check('iframes at load equal frame widgets minus waiting ones', (await page.locator('iframe').count()) === frameWidgets - waiting.length, { frameWidgets, waiting: waiting.length })
      check('a placeholder reserves at least the minimum height', waiting.every((x) => x.height >= 96), waiting.map((x) => x.height))
      // A card inside the 600 px margin but below the viewport is held until 2.5 s after load (LAYOUT_SETTLED_AT_MS), so it
      // may still be waiting here; only a card that is in the viewport must have started. (With Upcoming in a frame its card
      // is shorter, the cards below move up, and one of them sits inside the margin.)
      check('every waiting widget is below the viewport', waiting.every((x) => x.top >= VIEWPORT.height), waiting.map((x) => x.top))
      check('a placeholder is not a live region, not focusable and holds no control',
        (await page.locator('.plugin-frame[data-status="waiting"]').evaluateAll((els) => els.every((e) => e.querySelector('[role="status"],[role="alert"],[tabindex],button,a,input,iframe') === null))))

      // Tab through the page from the top. It must get past every frame and out the other end,
      // and never rest on a placeholder.
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0) })
      const seen: string[] = []
      let onPlaceholder = false
      for (let i = 0; i < 90; i++) {
        await page.keyboard.press('Tab')
        seen.push(await page.evaluate(() => {
          const el = document.activeElement
          if (el === null || el === document.body) return 'body'
          return `${el.tagName}:${el.getAttribute('title') ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 20)}`
        }))
        if (await page.evaluate(() => document.activeElement?.closest('.plugin-frame[data-status="waiting"]') != null)) onPlaceholder = true
        if (seen.at(-1) === 'body') break
      }
      check('Tab gets past the frames to the end of the page (and then leaves it)', seen.at(-1) === 'body' && seen.some((x) => x.startsWith('IFRAME:')), [...new Set(seen)])
      check('focus never rests on a placeholder', !onPlaceholder)

      // Scroll to the bottom: every frame gets created and connects.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await until(page, (ws) => ws.every(isReady))
      const after = await widgets(page)
      check('after scrolling to the bottom every widget is ready', after.every(isReady), after.map((x) => x.kind))
      check('every frame widget has an iframe', (await page.locator('iframe').count()) === frameWidgets, { iframes: await page.locator('iframe').count(), frameWidgets })
      // Back to the top: frames stay (not destroyed when scrolled away).
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(800)
      check('scrolling back up keeps every frame', (await page.locator('iframe').count()) === frameWidgets)
    } finally { await browser.close() }

    // A viewport tall enough for the whole dashboard: everything is created at load.
    const tall = await open(pw, server.base, await login(server.base), { width: 1280, height: 4000 })
    try {
      await tall.page.goto(`${server.base}/`)
      await sleep(500)
      await until(tall.page, (ws) => ws.every(isReady))
      check('a tall viewport creates every frame at load', (await tall.page.locator('.plugin-frame[data-status="waiting"]').count()) === 0)
    } finally { await tall.browser.close() }

    // No IntersectionObserver: every frame at once.
    const eager = await open(pw, server.base, await login(server.base))
    try {
      await eager.page.addInitScript(() => { Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true }) })
      await eager.page.goto(`${server.base}/`)
      await until(eager.page, (ws) => ws.every(isReady))
      check('without IntersectionObserver every frame is created at load', (await eager.page.locator('.plugin-frame[data-status="waiting"]').count()) === 0)
    } finally { await eager.browser.close() }
  } finally { await server.close() }
}

async function main(): Promise<void> {
  const pw = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright
  if (MODE === 'measure') await measure(pw)
  else await behaviour(pw)
  const failed = checks.filter((c) => !c.pass)
  if (MODE !== 'measure') console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((error: unknown) => { console.error(error); process.exit(2) })
