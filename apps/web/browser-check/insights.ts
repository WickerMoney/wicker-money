/**
 * Browser check and measurements for the Insights plugin in the isolated runtime.
 *
 * Starts the real API (built web app, frame document route, broker) against a
 * seeded development database, once with Insights in the page ("in-realm", as
 * shipped before the port) and once in a frame, by putting its id in or out of
 * `IN_REALM_PLUGIN_IDS` for the run, so both come from one build. It signs in as
 * the seeded `hero` persona and
 * drives Chromium through the real dashboard.
 *
 * It measures, per mode: time to the first and last Insights widget drawing its
 * chart, heap and process memory, the bytes each frame loads, and the Tab
 * sequence through the widgets. It also checks sizes, clipped tooltips, the theme
 * switch, the "Show as table" view, the loading status and axe.
 *
 * Needs: `pnpm build` done (apps/web/dist), a migrated and seeded dev database
 * (`pnpm migrate`, `pnpm --filter @wickermoney/api seed`), Chromium
 * (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`) and an axe-core build
 * (`AXE_PATH`, the path of `axe.min.js`). Run from apps/api so its dependencies
 * resolve, with the repo `.env` loaded:
 *
 *   cd apps/api && npx tsx --env-file=../../.env ../web/browser-check/insights.ts
 *
 * `BROWSER_CHECK_OUT=file.json` keeps the report, `SHOTS_DIR=dir` keeps screenshots,
 * `SAMPLES=n` sets the number of timing samples (default 7).
 */
import { execSync } from 'node:child_process'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'
import type { PluginManifest, WidgetSize } from '@wickermoney/plugin-sdk'
import { buildApp } from '../../api/src/app.js'
import { loadConfig } from '../../api/src/config.js'
import { KyselyUnitOfWork } from '../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../api/src/db/configureTenantContext.js'
import { createDb } from '../../api/src/db/client.js'
import { BUNDLED_PLUGINS, IN_REALM_PLUGIN_IDS } from '../../api/src/plugins/bundled.js'
import { PluginService } from '../../api/src/plugins/service/PluginService.js'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AXE = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
const SAMPLES = Number(process.env['SAMPLES'] ?? 7)
const SHOTS = process.env['SHOTS_DIR']
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })
const INSIGHTS = 'wickermoney.insights'

type Mode = 'in-realm' | 'isolated'
interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN

/** The bundled manifests, with Insights in the page or in a frame and both widgets at one size. */
function manifests(mode: Mode, size?: WidgetSize): PluginManifest[] {
  return BUNDLED_PLUGINS.map((m) => {
    if (m.id !== INSIGHTS) return m
    // Which runtime Insights gets is the host's allowlist (`IN_REALM_PLUGIN_IDS`), not the manifest, so
    // the check puts the id in or out of that set for the run. `mode` is the only thing it varies.
    const set = IN_REALM_PLUGIN_IDS as Set<string>
    if (mode === 'in-realm') set.add(INSIGHTS)
    else set.delete(INSIGHTS)
    return {
      ...m,
      contributes: {
        ...m.contributes,
        // INSIGHTS_WIDGETS=1 keeps only the trend widget, to see what the second frame costs.
        widgets: (m.contributes.widgets ?? []).slice(0, Number(process.env['INSIGHTS_WIDGETS'] ?? 99)).map((w) => (size === undefined ? w : { ...w, defaultSize: size })),
      },
    } as PluginManifest
  })
}

async function startServer(bundled: PluginManifest[]) {
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

/** Records when each chart first draws, and whether a status region ever appeared. Runs in every frame. */
const MARK_SCRIPT = `(() => {
  const w = window; w.__wm = { marks: {}, status: false };
  const scan = () => {
    const now = performance.timeOrigin + performance.now();
    if (!w.__wm.marks.trend && document.querySelector('.viz--trend svg')) w.__wm.marks.trend = now;
    if (!w.__wm.marks.donut && document.querySelector('.viz--donut svg')) w.__wm.marks.donut = now;
    if (document.querySelector('[role="status"]')) w.__wm.status = true;
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true });
  scan();
})()`

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

async function openDashboard(pw: typeof Playwright, base: string, _unused: string, opts: { width: number; height: number; scheme?: 'light' | 'dark' }) {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, colorScheme: opts.scheme ?? 'light' })
  // A refresh cookie is single-use (it rotates), so every context signs in itself.
  await ctx.addCookies([{ name: 'wickermoney_refresh', value: await login(base), url: base }])
  await ctx.addInitScript(MARK_SCRIPT)
  const page = await ctx.newPage()
  return { browser, ctx, page }
}

/** Every frame of the page that holds Insights content, with the main frame first. */
const insightsFrames = (page: Playwright.Page): Playwright.Frame[] => page.frames().filter((f) => f === page.mainFrame() || f.url().includes('/plugin-frame'))

async function readMarks(page: Playwright.Page): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const f of insightsFrames(page)) {
    const m = await f.evaluate(() => (window as unknown as { __wm?: { marks: Record<string, number> } }).__wm?.marks ?? {}).catch((e: unknown) => { console.log("readMarks", String(e).slice(0, 200)); return {} as Record<string, number> })
    for (const [k, v] of Object.entries(m)) out[k] = Math.min(out[k] ?? Infinity, v)
  }
  return out
}

async function waitForCharts(page: Playwright.Page): Promise<Record<string, number>> {
  const t0 = Date.now()
  for (;;) {
    const m = await readMarks(page)
    if (m['trend'] !== undefined && (m['donut'] !== undefined || process.env['INSIGHTS_WIDGETS'] === '1')) return m
    if (Date.now() - t0 > 30_000) throw new Error(`charts did not draw: ${JSON.stringify(m)}`)
    await sleep(40)
  }
}

interface Sample { perFrameHeapMiB: number[]; firstMs: number; lastMs: number; rssMiB: number; renderers: number; mainHeapMiB: number; frameHeapMiB: number; frames: number; widgets: number }

async function sampleOnce(pw: typeof Playwright, base: string, refresh: string): Promise<Sample> {
  const { browser, ctx, page } = await openDashboard(pw, base, refresh, { width: 1280, height: 900 })
  try {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.goto(`${base}/`)
    const marks = await waitForCharts(page)
    const origin = await page.evaluate(() => performance.timeOrigin)
    await sleep(3000)
    await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined)
    const heapOf = async (s: Playwright.CDPSession): Promise<number> => {
      await s.send('Performance.enable').catch(() => undefined)
      await s.send('HeapProfiler.collectGarbage').catch(() => undefined)
      const metrics = (await s.send('Performance.getMetrics')).metrics
      return (metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576
    }
    const mainHeap = await heapOf(cdp)
    let frameHeap = 0
    const perFrame: number[] = []
    for (const f of page.frames()) {
      if (f === page.mainFrame() || !f.url().includes('/plugin-frame')) continue
      // A frame in its own process has its own target; one in the page's process is already in the main figure.
      const s = await ctx.newCDPSession(f).catch(() => null)
      if (s !== null) { const h = await heapOf(s); perFrame.push(Math.round(h * 10) / 10) }
    }
    // Frames of one site share a renderer process, and each frame's session reports that process's heap, so
    // equal readings are one heap, not several.
    frameHeap = [...new Set(perFrame)].reduce((a, b) => a + b, 0)
    const widgets = await page.locator('.slot-item').count()
    const frames = await page.locator('iframe[title^="Insights"]').count()
    const proc = browserProcesses()
    return {
      firstMs: Math.round(Math.min(...Object.values(marks)) - origin),
      lastMs: Math.round(Math.max(...Object.values(marks)) - origin),
      rssMiB: proc.rssMiB, renderers: proc.renderers,
      mainHeapMiB: Math.round(mainHeap * 10) / 10, frameHeapMiB: Math.round(frameHeap * 10) / 10, frames, widgets, perFrameHeapMiB: perFrame,
    }
  } finally { await browser.close() }
}

/** What each frame fetched: script and style bytes, raw and compressed. */
async function frameBytes(pw: typeof Playwright, base: string, refresh: string) {
  const { browser, page } = await openDashboard(pw, base, refresh, { width: 1280, height: 900 })
  try {
    const rows: Array<{ frame: string; url: string; type: string; bytes: number; gzip: number; brotli: number; cache: string | undefined }> = []
    const pending: Array<Promise<void>> = []
    page.on('response', (r) => {
      const t = r.request().resourceType()
      if (t !== 'script' && t !== 'stylesheet') return
      pending.push((async () => {
        const body = await r.body().catch(() => Buffer.alloc(0))
        const frame = r.frame()
        const owner = frame === page.mainFrame() ? 'page' : (await frame.frameElement().then((e) => e.getAttribute('title')).catch(() => null)) ?? 'frame'
        rows.push({
          frame: owner, url: new URL(r.url()).pathname, type: t, bytes: body.length,
          gzip: gzipSync(body).length, brotli: brotliCompressSync(body).length, cache: r.headers()['cache-control'],
        })
      })())
    })
    await page.goto(`${base}/`)
    await waitForCharts(page)
    await sleep(1500)
    await Promise.all(pending)
    return rows
  } finally { await browser.close() }
}

/** A short description of the focused element, from the page's point of view, descending into a frame. */
async function describeFocus(page: Playwright.Page): Promise<string> {
  const host = await page.evaluate(() => {
    const el = document.activeElement
    if (el === null || el === document.body) return { kind: 'body' as const }
    if (el.tagName === 'IFRAME') return { kind: 'iframe' as const, title: el.getAttribute('title') ?? '' }
    return { kind: 'el' as const, text: `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')!.slice(0, 40)}]` : ''}${el.textContent && el.tagName.toLowerCase() !== 'g' && el.tagName.toLowerCase() !== 'path' ? ` "${el.textContent.trim().slice(0, 24)}"` : ''}` }
  })
  if (host.kind === 'body') return 'body'
  if (host.kind === 'el') return `page:${host.text}`
  for (const f of page.frames()) {
    if (f === page.mainFrame() || !f.url().includes('/plugin-frame')) continue
    const inner = await f.evaluate(() => {
      const el = document.activeElement
      if (el === null || el === document.body) return null
      return `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')!.slice(0, 40)}]` : ''}${el.tagName.toLowerCase() !== 'g' && el.tagName.toLowerCase() !== 'path' && el.textContent ? ` "${el.textContent.trim().slice(0, 24)}"` : ''}`
    }).catch(() => null)
    if (inner !== null && (await f.frameElement().then((e) => e.getAttribute('title')).catch(() => '')) === host.title) return `frame(${host.title}):${inner}`
  }
  return `iframe(${host.title}):nothing focused inside`
}

async function tabSequence(page: Playwright.Page, direction: 'Tab' | 'Shift+Tab', limit: number): Promise<string[]> {
  const seen: string[] = []
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(direction)
    await sleep(120)
    seen.push(await describeFocus(page))
  }
  return seen
}

/** How much of an element is visible: clipped px on each side by its own document or an overflow-clipping ancestor. */
const CLIP_PROBE = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  let box = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (o.overflowX !== 'visible' || o.overflowY !== 'visible') {
      const b = p.getBoundingClientRect();
      box = { left: Math.max(box.left, b.left), top: Math.max(box.top, b.top), right: Math.min(box.right, b.right), bottom: Math.min(box.bottom, b.bottom) };
    }
  }
  return { w: Math.round(r.width), clipLeft: Math.max(0, Math.round(box.left - r.left)), clipRight: Math.max(0, Math.round(r.right - box.right)), clipTop: Math.max(0, Math.round(box.top - r.top)), clipBottom: Math.max(0, Math.round(r.bottom - box.bottom)) };
}`

/** The frame holding a widget, or the page itself when the widget is in-realm. */
function widgetFrame(page: Playwright.Page, mode: Mode, which: 'trend' | 'donut'): Playwright.Frame {
  if (mode === 'in-realm') return page.mainFrame()
  const title = which === 'trend' ? 'Insights · Money in and out' : 'Insights · Where it went'
  const frames = page.frames().filter((f) => f.url().includes('/plugin-frame'))
  const f = frames.find((x) => x.url().includes(which === 'trend' ? 'TrendWidget' : 'DonutWidget'))
  if (f === undefined) throw new Error(`no frame for ${title}`)
  return f
}

/** Rules about a whole page (one main landmark, an h1, all content in landmarks). A widget frame is one component of a page, so they do not apply to it. */
const PAGE_LEVEL_RULES = ['landmark-one-main', 'page-has-heading-one', 'region']

async function axeRun(frame: Playwright.Frame, include?: string[][]): Promise<Array<{ id: string; impact: string | null | undefined; nodes: number; target: string }>> {
  await frame.evaluate(AXE)
  const pageRules = frame === frame.page().mainFrame() ? [] : PAGE_LEVEL_RULES
  const res = await frame.evaluate(async ([inc, pageRules]) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact?: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe
    const r = await axe.run(inc === undefined ? document : { include: inc }, { resultTypes: ['violations'], rules: Object.fromEntries(pageRules.map((id) => [id, { enabled: false }])) })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: JSON.stringify(v.nodes[0]?.target) }))
  }, [include, pageRules] as const)
  return res
}

/** Picks a theme with the app's own control (on a phone it is inside the menu drawer). */
async function chooseTheme(page: Playwright.Page, name: 'Light' | 'Dark'): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const phone = await menu.isVisible()
  if (phone) await menu.click()
  await page.locator('.account__trigger').click()
  await page.getByRole('button', { name }).click()
  await page.keyboard.press('Escape')
  if (phone) await page.keyboard.press('Escape')
  await sleep(200)
}

async function dashboardChecks(pw: typeof Playwright, mode: Mode, report: Record<string, unknown>): Promise<void> {
  const tag = (s: string): string => `[${mode}] ${s}`
  const sizes: WidgetSize[] = ['sm', 'md', 'lg', 'full']
  const sizeRows: Array<Record<string, unknown>> = []
  for (const size of sizes) {
    const server = await startServer(manifests(mode, size))
    try {
      const refresh = await login(server.base)
      for (const viewport of [{ width: 1280, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }]) {
        const { browser, page } = await openDashboard(pw, server.base, refresh, viewport)
        try {
          await page.goto(`${server.base}/`)
          await waitForCharts(page)
          await sleep(1200)
          for (const which of ['trend', 'donut'] as const) {
            const f = widgetFrame(page, mode, which)
            if (mode === 'isolated') { await (await f.frameElement()).scrollIntoViewIfNeeded(); await sleep(700) }
            const sel = which === 'trend' ? '.viz--trend' : '.viz--donut'
            const geo = await f.evaluate((s) => {
              const el = document.querySelector(s)!.getBoundingClientRect()
              return { contentW: Math.round(el.width), contentH: Math.round(el.height), docW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth }
            }, sel)
            let frameH: number | undefined
            let cardW: number | undefined
            let frameW: number | undefined
            if (mode === 'isolated') {
              const el = await f.frameElement()
              const b = await el.boundingBox()
              frameH = Math.round(b?.height ?? 0)
              frameW = Math.round(b?.width ?? 0)
              cardW = Math.round((await el.evaluate((e) => e.parentElement!.getBoundingClientRect().width)))
            }
            const hscroll = geo.docW > geo.docClientW + 1
            sizeRows.push({ size, viewport: viewport.name, widget: which, ...geo, frameH, frameW, cardW, hscroll })
            if (mode === 'isolated') {
              check(tag(`${which} @${size}/${viewport.name}: frame fills its card and shows all content (${frameW}x${frameH}, content ${geo.contentW}x${geo.contentH})`),
                Math.abs((frameW ?? 0) - (cardW ?? 0)) <= 2 && (frameH ?? 0) >= geo.contentH - 1 && !hscroll, { frameW, cardW, frameH, geo })
            } else {
              check(tag(`${which} @${size}/${viewport.name}: no horizontal overflow`), !hscroll, geo)
            }
          }
          if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${mode}-${size}-${viewport.name}-light.png`), fullPage: true })
        } finally { await browser.close() }
      }
    } finally { await server.close() }
  }
  report['sizes'] = sizeRows
}

/**
 * A frame below the fold: does it get its height before it is scrolled to?
 *
 * Observation, not a pass or fail. Chromium does not run a cross-origin frame's rendering updates while it is
 * off screen, so the frame's ResizeObserver does not fire and the frame keeps the host's minimum height until it
 * is scrolled into view, whatever its content is.
 */
async function offscreenObservation(pw: typeof Playwright, report: Record<string, unknown>): Promise<void> {
  const server = await startServer(manifests('isolated', 'lg'))
  try {
    const runs: Array<{ beforeScroll: number[]; afterScroll: number[] }> = []
    for (let i = 0; i < 5; i++) {
      const { browser, page } = await openDashboard(pw, server.base, '', { width: 1280, height: 600 })
      try {
        await page.goto(`${server.base}/`)
        await waitForCharts(page)
        await sleep(2500)
        const heights = async (): Promise<number[]> => page.locator('iframe[title^="Insights"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
        const beforeScroll = await heights()
        await page.locator('iframe[title$="Where it went"]').scrollIntoViewIfNeeded()
        await sleep(800)
        runs.push({ beforeScroll, afterScroll: await heights() })
      } finally { await browser.close() }
    }
    report['offscreen'] = runs
    console.log(`  offscreen frame heights (trend, donut), before and after scrolling to it: ${JSON.stringify(runs)}`)
  } finally { await server.close() }
}

async function behaviourChecks(pw: typeof Playwright, mode: Mode, report: Record<string, unknown>): Promise<void> {
  const tag = (s: string): string => `[${mode}] ${s}`
  const server = await startServer(manifests(mode))
  try {
    const refresh = await login(server.base)

    // ---- Theme, tooltips, table view, status, axe: desktop and phone, light and dark.
    for (const viewport of [{ width: 1280, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }]) {
      const { browser, page } = await openDashboard(pw, server.base, refresh, { ...viewport, scheme: 'light' })
      try {
        const consoleErrors: string[] = []
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
        await page.goto(`${server.base}/`)
        await waitForCharts(page)
        await sleep(1000)
        const trend = widgetFrame(page, mode, 'trend')
        const donut = widgetFrame(page, mode, 'donut')

        // Status region while loading was seen in the document that drew each widget.
        const sawStatus = await trend.evaluate(() => (window as unknown as { __wm: { status: boolean } }).__wm.status)
        check(tag(`${viewport.name}: the loading spinner's status region appeared (role=status)`), sawStatus)

        for (const scheme of ['light', 'dark'] as const) {
          if (scheme === 'dark') {
            // The real control: account menu, then the Dark button.
            await chooseTheme(page, 'Dark')
            await sleep(600)
          }
          const hostTokens = await page.evaluate(() => ({
            scheme: document.documentElement.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
            bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim(),
            c1: getComputedStyle(document.documentElement).getPropertyValue('--wm-chart-1').trim(),
          }))
          for (const [which, f] of [['trend', trend], ['donut', donut]] as const) {
            const inner = await f.evaluate((s) => {
              const el = document.querySelector(s)!
              const bar = el.querySelector('.viz__bar') as SVGElement | null
              return {
                scheme: document.documentElement.getAttribute('data-theme'),
                bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim(),
                c1: getComputedStyle(document.documentElement).getPropertyValue('--wm-chart-1').trim(),
                ink: getComputedStyle(el).getPropertyValue('--viz-ink').trim(),
                fill: bar ? getComputedStyle(bar).fill : '',
              }
            }, which === 'trend' ? '.viz--trend' : '.viz--donut')
            check(tag(`${viewport.name}/${scheme}: ${which} matches the host's theme tokens`),
              inner.bg === hostTokens.bg && inner.c1 === hostTokens.c1 && (mode === 'in-realm' || inner.scheme === hostTokens.scheme) && hostTokens.scheme === scheme, { host: hostTokens, inner })
          }
          if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${mode}-${viewport.name}-${scheme}.png`), fullPage: true })

          // axe over the Insights cards only.
          const violations: Array<Record<string, unknown>> = []
          if (mode === 'in-realm') {
            for (const v of await axeRun(page.mainFrame(), [['.slot-item:has(.viz)']])) violations.push({ where: 'page', ...v })
          } else {
            for (const v of await axeRun(page.mainFrame(), [['.slot-item:has(iframe[title^="Insights"])']])) violations.push({ where: 'page', ...v })
            for (const [which, f] of [['trend', trend], ['donut', donut]] as const) {
              for (const v of await axeRun(f)) violations.push({ where: `frame ${which}`, ...v })
            }
          }
          check(tag(`${viewport.name}/${scheme}: axe finds no violations in the Insights widgets`), violations.length === 0, violations)
          report[`axe-${viewport.name}-${scheme}`] = violations
        }
        // Back to light for the interaction checks.
        await chooseTheme(page, 'Light')
        await sleep(400)

        // Tooltip clipping: first and last month of the trend chart.
        const marks = trend.locator('.viz--trend g[role="listitem"]')
        const n = await marks.count()
        const clip: Record<string, unknown> = {}
        for (const [label, idx] of [['first', 0], ['middle', Math.floor(n / 2)], ['last', n - 1]] as const) {
          await marks.nth(idx).focus()
          await sleep(150)
          const c = await trend.evaluate(`(${CLIP_PROBE})('.viz__tip')`) as { clipLeft: number; clipRight: number; clipTop: number; clipBottom: number; w: number } | null
          clip[label] = c
          check(tag(`${viewport.name}: tooltip on the ${label} month is not clipped`),
            c !== null && c.clipLeft === 0 && c.clipRight === 0 && c.clipTop === 0 && c.clipBottom === 0, c)
        }
        report[`tooltip-clip-${viewport.name}`] = clip
        if (SHOTS !== undefined) {
          await marks.nth(0).focus(); await sleep(150)
          await page.screenshot({ path: join(SHOTS, `${mode}-${viewport.name}-tooltip-first.png`), fullPage: true })
        }

        // Table view.
        const toggle = trend.locator('.viz--trend').getByRole('button', { name: 'Show as table' })
        await toggle.focus()
        await page.keyboard.press('Enter')
        await sleep(300)
        const table = await trend.evaluate(() => {
          const t = document.querySelector('.viz--trend table')
          const active = document.activeElement
          return {
            exists: t !== null, label: document.querySelector('.viz--trend [role="group"][aria-label$="as a table"]')?.getAttribute('aria-label') ?? t?.querySelector('caption')?.textContent ?? null,
            scopes: t ? [...t.querySelectorAll('th')].map((th) => th.getAttribute('scope')).filter((x) => x === 'col' || x === 'row').length : 0,
            rows: t ? t.querySelectorAll('tbody tr').length : 0, svg: document.querySelector('.viz--trend svg[role="list"]') !== null,
            focus: active ? `${active.tagName.toLowerCase()} "${active.textContent?.trim()}"` : null,
          }
        })
        check(tag(`${viewport.name}: "Show as table" shows a labelled table in place of the chart`), table.exists && !table.svg && table.label !== null && table.scopes > 0 && table.rows > 0, table)
        check(tag(`${viewport.name}: focus stays on the toggle, now "Show as chart"`), table.focus === 'button "Show as chart"', table.focus)
        if (mode === 'isolated') {
          const el = await trend.frameElement()
          await sleep(300)
          const fh = Math.round((await el.boundingBox())?.height ?? 0)
          const ch = await trend.evaluate(() => Math.round(document.querySelector('.viz--trend')!.getBoundingClientRect().height))
          check(tag(`${viewport.name}: the frame resizes to the table (frame ${fh}, content ${ch})`), fh >= ch - 1, { fh, ch })
        }
        if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${mode}-${viewport.name}-table.png`), fullPage: true })
        const tableViolations = mode === 'in-realm'
          ? await axeRun(page.mainFrame(), [['.slot-item:has(.viz)']])
          : await axeRun(trend)
        check(tag(`${viewport.name}: axe finds no violations with the table shown`), tableViolations.length === 0, tableViolations)
        await page.keyboard.press('Enter')
        await sleep(200)

        const csp = consoleErrors.filter((m) => /Content Security Policy|CORS|blocked by|Refused/i.test(m))
        check(tag(`${viewport.name}: no CSP or CORS errors in the console`), csp.length === 0, csp.slice(0, 4))
      } finally { await browser.close() }
    }

    // ---- Keyboard order, desktop.
    {
      const { browser, page } = await openDashboard(pw, server.base, refresh, { width: 1280, height: 900 })
      try {
        await page.goto(`${server.base}/`)
        await waitForCharts(page)
        await sleep(1000)
        // Start at the dashboard heading's slot: focus the last control before the first Insights card.
        await page.evaluate(() => {
          const first = document.querySelector('.slot-item') as HTMLElement
          const probe = document.createElement('button'); probe.id = '__start'; probe.textContent = 'start'
          first.before(probe); probe.focus()
        })
        const forward = await tabSequence(page, 'Tab', 40)
        report[`tab-forward-${mode}`] = forward
        await page.evaluate(() => document.getElementById('__start')?.focus())
        report[`tab-start-${mode}`] = await describeFocus(page)
        console.log(`  ${mode} forward Tab: ${forward.slice(0, 40).join(' | ')}`)
        // Backwards, from the control just after the trend widget: the way back into the widget.
        await page.locator('.slot-item', { hasText: 'Spending trends' }).locator('button').first().focus()
        const backward = await tabSequence(page, 'Shift+Tab', 16)
        report[`tab-backward-${mode}`] = backward
        console.log(`  ${mode} backward Tab: ${backward.slice(0, 16).map((x) => x.slice(0, 40)).join(' | ')}`)
        check(tag('the frame itself is not an extra Tab stop'), !forward.some((x) => x.startsWith('iframe(')) && !backward.some((x) => x.startsWith('iframe(')),
          [...forward, ...backward].filter((x) => x.startsWith('iframe(')))
        const inside = forward.filter((s) => /month|\bin,|Show as|Where|%|category/i.test(s) || s.startsWith('frame(') || s.startsWith('iframe('))
        report[`tab-inside-${mode}`] = inside
      } finally { await browser.close() }
    }
  } finally { await server.close() }
}

async function main(): Promise<void> {
  const mod = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright & { default?: typeof Playwright }
  const pw = mod.chromium === undefined && mod.default !== undefined ? mod.default : mod
  const report: Record<string, unknown> = {}
  const only = process.env['ONLY']
  const probe = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  report['engine'] = `chromium ${probe.version()}`
  await probe.close()
  console.log(`engine: ${report['engine']}`)

  const modes = (process.env['MODES'] ?? 'in-realm,isolated').split(',') as Mode[]
  for (const mode of modes) {
    const r: Record<string, unknown> = {}
    report[mode] = r
    if (only === undefined || only === 'measure') {
      r['samples'] = []
    }
    if (only === undefined || only === 'check') {
      await dashboardChecks(pw, mode, r)
      await behaviourChecks(pw, mode, r)
      if (mode === 'isolated') await offscreenObservation(pw, r)
    }
  }
  const strip = (xs: unknown): string[] => (xs as string[] | undefined ?? []).map((x) => x.replace(/^frame\([^)]*\):|^page:/, ''))
  for (const dir of ['forward', 'backward'] as const) {
    const a = (report['in-realm'] as Record<string, unknown> | undefined)?.[`tab-${dir}-in-realm`]
    const b = (report['isolated'] as Record<string, unknown> | undefined)?.[`tab-${dir}-isolated`]
    if (a !== undefined && b !== undefined) check(`Tab order ${dir} is the same in a frame as in the page`, strip(a).join('|') === strip(b).join('|'), { page: strip(a).slice(0, 20), frame: strip(b).slice(0, 20) })
  }
  if (only === undefined || only === 'measure') {
    // Alternate the modes sample by sample, so a slow minute on the machine hits both alike.
    const byMode: Record<string, Sample[]> = {}
    for (let i = 0; i < SAMPLES; i++) {
      for (const mode of modes) {
        const server = await startServer(manifests(mode))
        try {
          const refresh = await login(server.base)
          ;(byMode[mode] ??= []).push(await sampleOnce(pw, server.base, refresh))
        } finally { await server.close() }
        await sleep(300)
      }
    }
    const pct = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? NaN
    for (const mode of modes) {
      const samples = byMode[mode] ?? []
      const rr = report[mode] as Record<string, unknown>
      rr['samples'] = samples
      const col = (k: keyof Sample): number[] => samples.map((x) => x[k] as number)
      rr['median'] = {
        n: samples.length,
        firstMs: median(col('firstMs')), firstMsP25: pct(col('firstMs'), 0.25), firstMsP75: pct(col('firstMs'), 0.75),
        lastMs: median(col('lastMs')), rssMiB: median(col('rssMiB')), mainHeapMiB: median(col('mainHeapMiB')),
        frameHeapMiB: median(col('frameHeapMiB')), renderers: median(col('renderers')),
        frames: samples[0]?.frames, widgets: samples[0]?.widgets,
      }
      console.log(`${mode} median: ${JSON.stringify(rr['median'])}`)
      const server = await startServer(manifests(mode))
      try { rr['bytes'] = await frameBytes(pw, server.base, '') } finally { await server.close() }
    }
  }
  report['checks'] = checks
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  const out = process.env['BROWSER_CHECK_OUT']
  if (out !== undefined) writeFileSync(out, JSON.stringify(report, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e: unknown) => { console.error(e); process.exit(2) })
