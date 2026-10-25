/**
 * Browser check and measurements for the Upcoming ("Until payday") widget in the isolated runtime.
 *
 * Starts the real API (built web app, frame document route, broker) against a seeded development
 * database, once with Upcoming in the page ("in-realm", as shipped before the port) and once in a
 * frame, by putting its id in or out of `IN_REALM_PLUGIN_IDS` for the run, so both come from one
 * build (as `insights.ts` does). It signs in as the seeded `hero` persona and drives Chromium
 * through the real dashboard.
 *
 * It checks, per mode: the widget at sizes sm, md and lg on a desktop and a phone window (content
 * fits, no horizontal overflow, a frame fills its card), the theme switch through the app's own
 * control, axe, the Tab order into and out of the widget, the two host-owned actions (the "Choose
 * accounts" link and the "Show transfers" toggle), that no Content Security Policy or eval
 * violation is raised in any document, and every `/api/v1` request the widget makes. With
 * `ONLY=measure` it measures, alternating the modes sample by sample: time to the widget's figure,
 * browser memory (proportional set size of the browser's process tree), heap, renderer processes,
 * frames at load and after scrolling to the bottom, and the bytes the widget loads.
 *
 * Needs: `pnpm build` done (apps/web/dist), a migrated and seeded dev database (`pnpm migrate`,
 * `pnpm --filter @wickermoney/api seed`), Chromium (`CHROMIUM_PATH`), playwright-core
 * (`PLAYWRIGHT_CORE`) and an axe-core build (`AXE_PATH`, the path of `axe.min.js`). Run from
 * apps/api so its dependencies resolve, with `DATABASE_URL` pointing at the seeded database:
 *
 *   cd apps/api && npx tsx ../web/browser-check/upcoming.ts
 *
 * `ONLY=check|measure` runs half of it, `MODES=isolated` one runtime, `SAMPLES=n` sets the number
 * of timing samples (default 9), `VIEWPORT=390x844` the measured window (default 1280x900),
 * `BROWSER_CHECK_OUT=file.json` keeps the report, `SHOTS_DIR=dir` keeps screenshots.
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
const SAMPLES = Number(process.env['SAMPLES'] ?? 9)
const [VW, VH] = (process.env['VIEWPORT'] ?? '1280x900').split('x').map(Number)
const SHOTS = process.env['SHOTS_DIR']
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })
const UPCOMING = 'wickermoney.upcoming'
const FRAME_TITLE = 'Upcoming · Until payday'

type Mode = 'in-realm' | 'isolated'
interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN

/**
 * The bundled manifests with Upcoming in the page or in a frame. Which runtime it gets is the host's
 * allowlist (`IN_REALM_PLUGIN_IDS`), not the manifest, so the check puts the id in or out of that set
 * for the run. `only` keeps Upcoming's manifest alone, so every request the dashboard makes is its own.
 */
function manifests(mode: Mode, opts: { size?: WidgetSize; only?: boolean } = {}): PluginManifest[] {
  const set = IN_REALM_PLUGIN_IDS as Set<string>
  if (mode === 'in-realm') set.add(UPCOMING)
  else set.delete(UPCOMING)
  return BUNDLED_PLUGINS
    .filter((m) => opts.only !== true || m.id === UPCOMING)
    .map((m) => {
      if (m.id !== UPCOMING || opts.size === undefined) return m
      const { size } = opts
      return { ...m, contributes: { ...m.contributes, widgets: (m.contributes.widgets ?? []).map((w) => ({ ...w, defaultSize: size })) } } as PluginManifest
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

/**
 * Records when the widget's figure first appears and every CSP violation (eval included). Runs in every document.
 * `__name` is the helper tsx injects into functions passed to `evaluate`; the page has no such global.
 */
const MARK_SCRIPT = `(() => {
  const w = window; w.__name = w.__name || ((f) => f); w.__wm = { head: 0, violations: [] };
  document.addEventListener('securitypolicyviolation', (e) => w.__wm.violations.push(e.violatedDirective + ' ' + e.blockedURI), true);
  const scan = () => {
    if (!w.__wm.head && document.querySelector('.upc-head__value, .upc--empty')) w.__wm.head = performance.timeOrigin + performance.now();
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true });
  scan();
})()`

/** Proportional set size, in MiB, of the processes below `rootPid`. */
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
    try { kib += Number(/^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] ?? 0) } catch { /* gone */ }
    for (const c of children.get(pid) ?? []) {
      if (c.args.includes('--type=renderer')) renderers += 1
      walk(c.pid)
    }
  }
  walk(rootPid)
  return { mib: Math.round(kib / 1024), renderers }
}

/** The pid of the browser this script started: the Chromium whose parent is this process. */
function browserPid(): number {
  const out = execSync(`ps -eo pid=,ppid=,args= | awk '$2==${process.pid}'`, { encoding: 'utf8' })
  const line = out.split('\n').find((l) => l.includes('chrom'))
  if (line === undefined) throw new Error('browser process not found')
  return Number(line.trim().split(/\s+/)[0])
}

interface Viewport { width: number; height: number; name?: string; scheme?: 'light' | 'dark' }

async function open(pw: typeof Playwright, base: string, viewport: Viewport) {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  const pid = browserPid()
  const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: viewport.scheme ?? 'light' })
  // A refresh cookie is single-use (it rotates), so every context signs in itself.
  await ctx.addCookies([{ name: 'wickermoney_refresh', value: await login(base), url: base }])
  await ctx.addInitScript(MARK_SCRIPT)
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  return { browser, ctx, page, pid, problems }
}

/** The document that holds the widget's DOM: the frame in a frame, the page itself otherwise. */
function scopeOf(page: Playwright.Page, mode: Mode): Playwright.Frame {
  if (mode === 'in-realm') return page.mainFrame()
  const f = page.frames().find((x) => x !== page.mainFrame() && x.url().includes('/plugin-frame') && x.url().includes('UpcomingWidget'))
  if (f === undefined) throw new Error(`no frame for ${FRAME_TITLE}`)
  return f
}

/** Waits until the widget's figure (or its empty state) is in the DOM; returns its mark in ms since the page's time origin. */
async function waitForWidget(page: Playwright.Page, mode: Mode, timeoutMs = 30_000): Promise<number> {
  const t0 = Date.now()
  for (;;) {
    const marks: number[] = []
    for (const f of page.frames()) {
      if (f !== page.mainFrame() && !f.url().includes('/plugin-frame')) continue
      const m = await f.evaluate(() => (window as unknown as { __wm?: { head: number } }).__wm?.head ?? 0).catch(() => 0)
      if (m > 0) marks.push(m)
    }
    if (marks.length > 0) {
      const origin = await page.evaluate(() => performance.timeOrigin)
      return Math.round(Math.min(...marks) - origin)
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`the ${mode} widget did not draw`)
    await sleep(25)
  }
}

/** Every securitypolicyviolation any document of the page has seen. */
async function violations(page: Playwright.Page): Promise<string[]> {
  const out: string[] = []
  for (const f of page.frames()) {
    const v = await f.evaluate(() => (window as unknown as { __wm?: { violations: string[] } }).__wm?.violations ?? []).catch(() => [] as string[])
    out.push(...v)
  }
  return out
}

/** A short description of the focused element, from the page's point of view, descending into a frame. */
async function describeFocus(page: Playwright.Page): Promise<string> {
  const text = `(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return null;
    const label = el.getAttribute('aria-label');
    return el.tagName.toLowerCase() + (label ? '[' + label.slice(0, 40) + ']' : '') + ' "' + (el.textContent || '').trim().slice(0, 24) + '"';
  })()`
  const host = await page.evaluate(`(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { kind: 'body' };
    if (el.tagName === 'IFRAME') return { kind: 'iframe', title: el.getAttribute('title') || '' };
    return { kind: 'el', text: ${text} };
  })()`) as { kind: 'body' | 'iframe' | 'el'; title?: string; text?: string }
  if (host.kind === 'body') return 'body'
  if (host.kind === 'el') return `page:${host.text}`
  for (const f of page.frames()) {
    if (f === page.mainFrame() || !f.url().includes('/plugin-frame')) continue
    const title = await f.frameElement().then((e) => e.getAttribute('title')).catch(() => '')
    if (title !== host.title) continue
    const inner = await f.evaluate(text).catch(() => null) as string | null
    return inner === null ? `iframe(${host.title}):nothing focused inside` : `frame(${host.title}):${inner}`
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

/** Rules about a whole page (one main landmark, an h1, all content in landmarks). A widget frame is one component of a page, so they do not apply to it. */
const PAGE_LEVEL_RULES = ['landmark-one-main', 'page-has-heading-one', 'region']

async function axeRun(frame: Playwright.Frame, axeSource: string, include?: string[][]): Promise<Array<{ id: string; impact: string | null | undefined; nodes: number; target: string }>> {
  await frame.evaluate(axeSource)
  const isFrame = frame !== frame.page().mainFrame()
  if (isFrame) {
    // The frame is transparent over its card, and axe cannot see across the frame boundary, so it would measure
    // contrast against the document's default white in dark mode. Put the card's colour under the document for the run.
    const card = await (await frame.frameElement()).evaluate((e) => {
      for (let el: Element | null = e; el !== null; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor
        if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c
      }
      return 'rgb(255, 255, 255)'
    })
    await frame.evaluate((c) => { document.documentElement.style.backgroundColor = c }, card)
  }
  const pageRules = isFrame ? PAGE_LEVEL_RULES : []
  return frame.evaluate(async ([inc, off]) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact?: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe
    const r = await axe.run(inc === undefined ? document : { include: inc }, { resultTypes: ['violations'], rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])) })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: JSON.stringify(v.nodes[0]?.target) }))
  }, [include, pageRules] as const)
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
  await sleep(250)
}

const VIEWPORTS: Viewport[] = [{ width: 1280, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'phone' }]

/** Sizes sm, md and lg, desktop and phone: the content fits, nothing overflows sideways, a frame fills its card. */
async function sizeChecks(pw: typeof Playwright, mode: Mode, report: Record<string, unknown>): Promise<void> {
  const rows: Array<Record<string, unknown>> = []
  for (const size of ['sm', 'md', 'lg'] as const) {
    const server = await startServer(manifests(mode, { size }))
    try {
      for (const viewport of VIEWPORTS) {
        const { browser, page } = await open(pw, server.base, viewport)
        try {
          await page.goto(`${server.base}/`)
          await waitForWidget(page, mode)
          await sleep(1200)
          const f = scopeOf(page, mode)
          const geo = await f.evaluate(() => {
            const el = document.querySelector('.upc')!.getBoundingClientRect()
            const table = document.querySelector('.upc-accounts')?.getBoundingClientRect()
            return {
              contentW: Math.round(el.width), contentH: Math.round(el.height), tableW: Math.round(table?.width ?? 0),
              docW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
            }
          })
          let frameW: number | undefined
          let frameH: number | undefined
          let cardW: number | undefined
          if (mode === 'isolated') {
            const el = await f.frameElement()
            const b = await el.boundingBox()
            frameW = Math.round(b?.width ?? 0)
            frameH = Math.round(b?.height ?? 0)
            cardW = Math.round(await el.evaluate((e) => e.parentElement!.getBoundingClientRect().width))
          }
          const hscroll = geo.docW > geo.docClientW + 1
          rows.push({ size, viewport: viewport.name, ...geo, frameW, frameH, cardW, hscroll })
          const label = `${size}/${viewport.name}`
          if (mode === 'isolated') {
            // The widget clamp is 800 px: a taller widget would scroll inside its frame.
            check(`[${mode}] ${label}: the frame fills its card and shows all content (${frameW}x${frameH}, content ${geo.contentW}x${geo.contentH})`,
              Math.abs((frameW ?? 0) - (cardW ?? 0)) <= 2 && (frameH ?? 0) >= geo.contentH - 1 && !hscroll, { frameW, cardW, frameH, geo })
          } else {
            check(`[${mode}] ${label}: no horizontal overflow (content ${geo.contentW}x${geo.contentH})`, !hscroll, geo)
          }
          if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${mode}-${size}-${viewport.name}-light.png`), fullPage: true })
        } finally { await browser.close() }
      }
    } finally { await server.close() }
  }
  report['sizes'] = rows
}

async function behaviourChecks(pw: typeof Playwright, mode: Mode, axeSource: string, report: Record<string, unknown>): Promise<void> {
  const tag = (s: string): string => `[${mode}] ${s}`
  const server = await startServer(manifests(mode))
  try {
    // ---- Theme, axe, violations: desktop and phone, light and dark.
    for (const viewport of VIEWPORTS) {
      const { browser, page, problems } = await open(pw, server.base, viewport)
      try {
        await page.goto(`${server.base}/`)
        await waitForWidget(page, mode)
        await sleep(1200)
        const f = scopeOf(page, mode)
        for (const scheme of ['light', 'dark'] as const) {
          if (scheme === 'dark') { await chooseTheme(page, 'Dark'); await sleep(500) }
          const probe = (): Promise<Record<string, string>> => f.evaluate(() => {
            const cs = (el: Element | null, p: string): string => (el === null ? '' : getComputedStyle(el).getPropertyValue(p).trim())
            const root = document.documentElement
            return {
              scheme: root.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
              bg: cs(root, '--wm-bg'), muted: cs(root, '--wm-text-muted'), border: cs(root, '--wm-border'),
              labelColor: cs(document.querySelector('.upc-head__label'), 'color'),
              bodyBackground: cs(document.body, 'background-color'),
            }
          })
          const inner = await probe()
          const host = await page.evaluate(() => {
            const root = document.documentElement
            return {
              scheme: root.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
              bg: getComputedStyle(root).getPropertyValue('--wm-bg').trim(), muted: getComputedStyle(root).getPropertyValue('--wm-text-muted').trim(),
              border: getComputedStyle(root).getPropertyValue('--wm-border').trim(),
            }
          })
          check(tag(`${viewport.name}/${scheme}: the widget has the host's theme tokens`),
            host.scheme === scheme && inner['bg'] === host.bg && inner['muted'] === host.muted && inner['border'] === host.border && (mode === 'in-realm' || inner['scheme'] === host.scheme), { host, inner })
          if (mode === 'isolated') check(tag(`${viewport.name}/${scheme}: the frame's canvas is transparent`), inner['bodyBackground'] === 'rgba(0, 0, 0, 0)', inner['bodyBackground'])
          if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${mode}-${viewport.name}-${scheme}.png`), fullPage: true })

          const found: Array<Record<string, unknown>> = []
          const card = mode === 'in-realm' ? '.slot-item:has(.upc)' : `.slot-item:has(iframe[title="${FRAME_TITLE}"])`
          for (const v of await axeRun(page.mainFrame(), axeSource, [[card]])) found.push({ where: 'page', ...v })
          if (mode === 'isolated') for (const v of await axeRun(f, axeSource)) found.push({ where: 'frame', ...v })
          check(tag(`${viewport.name}/${scheme}: axe finds no violations in the widget${mode === 'isolated' ? ' (page card and frame)' : ''}`), found.length === 0, found)
          report[`axe-${viewport.name}-${scheme}`] = found
        }
        await chooseTheme(page, 'Light')

        // The one control the widget owns besides a link: the transfers toggle, by keyboard. The hero has no
        // transfer in the window, so the list may not change; the box must still toggle and the frame still fit.
        const toggle = f.getByLabel('Show transfers')
        await toggle.focus()
        await page.keyboard.press('Space')
        await sleep(400)
        check(tag(`${viewport.name}: "Show transfers" toggles by keyboard`), await toggle.isChecked())
        if (mode === 'isolated') {
          const el = await f.frameElement()
          const fh = Math.round((await el.boundingBox())?.height ?? 0)
          const ch = await f.evaluate(() => Math.round(document.querySelector('.upc')!.getBoundingClientRect().height))
          check(tag(`${viewport.name}: the frame resizes with the list (frame ${fh}, content ${ch})`), fh >= ch - 1, { fh, ch })
        }
        const found = mode === 'in-realm'
          ? await axeRun(page.mainFrame(), axeSource, [['.slot-item:has(.upc)']])
          : await axeRun(f, axeSource)
        check(tag(`${viewport.name}: axe finds no violations with transfers shown`), found.length === 0, found)

        const v = await violations(page)
        check(tag(`${viewport.name}: no CSP or eval violation in any document`), v.length === 0, v)
        const csp = problems.filter((m) => /Content Security Policy|CORS|blocked by|Refused|eval/i.test(m))
        check(tag(`${viewport.name}: no CSP, CORS or eval errors in the console`), csp.length === 0, csp.slice(0, 4))
        check(tag(`${viewport.name}: no console errors at all`), problems.length === 0, problems.slice(0, 4))
      } finally { await browser.close() }
    }

    // ---- "Choose accounts" asks the host to navigate.
    {
      const { browser, page } = await open(pw, server.base, VIEWPORTS[0]!)
      try {
        await page.goto(`${server.base}/`)
        await waitForWidget(page, mode)
        await sleep(800)
        await scopeOf(page, mode).getByRole('button', { name: 'Choose accounts' }).click()
        await page.waitForURL('**/accounts', { timeout: 5000 }).catch(() => undefined)
        check(tag('"Choose accounts" navigates the host to /accounts'), new URL(page.url()).pathname === '/accounts', page.url())
      } finally { await browser.close() }
    }

    // ---- Keyboard order, desktop.
    {
      const { browser, page } = await open(pw, server.base, VIEWPORTS[0]!)
      try {
        await page.goto(`${server.base}/`)
        await waitForWidget(page, mode)
        await sleep(1200)
        // Start at a control placed just before the first card (the Upcoming card is first on the dashboard).
        await page.evaluate(() => {
          const first = document.querySelector('.slot-item') as HTMLElement
          const probe = document.createElement('button'); probe.id = '__start'; probe.textContent = 'start'
          first.before(probe); probe.focus()
        })
        const forwardAll = await tabSequence(page, 'Tab', 5)
        // The first three stops are this card's own. What follows is the next card: when that is a frame too, the
        // host's focus hand-off lands on its iframe element first (see the report), which is not this widget's doing.
        const forward = forwardAll.slice(0, 3)
        report[`tab-forward-after-${mode}`] = forwardAll.slice(3)
        report[`tab-forward-${mode}`] = forward
        console.log(`  ${mode} forward Tab: ${forward.join(' | ')}`)
        // Backwards from a control placed just after the first card: the way back into the widget.
        await page.evaluate(() => {
          const first = document.querySelector('.slot-item') as HTMLElement
          const probe = document.createElement('button'); probe.id = '__end'; probe.textContent = 'end'
          first.after(probe); probe.focus()
        })
        const backward = await tabSequence(page, 'Shift+Tab', 3)
        report[`tab-backward-${mode}`] = backward
        console.log(`  ${mode} backward Tab: ${backward.join(' | ')}`)
        check(tag('the frame itself is not an extra Tab stop'), ![...forward, ...backward].some((x) => x.startsWith('iframe(')), [...forward, ...backward].filter((x) => x.startsWith('iframe(')))
        check(tag('Tab reaches the widget\'s controls (Choose accounts, Show transfers)'),
          forward.some((x) => x.includes('Choose accounts')) && forward.some((x) => x.startsWith('frame(') || mode === 'in-realm') && forward.some((x) => x.includes('input')), forward)
      } finally { await browser.close() }
    }
  } finally { await server.close() }
}

interface RequestRow { method: string; path: string; status: number }

/** Every /api/v1 request the dashboard makes with Upcoming as the only plugin, from sign-in on. */
async function requestList(pw: typeof Playwright, mode: Mode, report: Record<string, unknown>): Promise<void> {
  const tag = (s: string): string => `[${mode}] ${s}`
  const server = await startServer(manifests(mode, { only: true }))
  try {
    const { browser, page } = await open(pw, server.base, VIEWPORTS[0]!)
    try {
      const rows: RequestRow[] = []
      page.on('response', (r) => {
        const u = new URL(r.url())
        if (u.pathname.startsWith('/api/v1/')) rows.push({ method: r.request().method(), path: u.pathname + u.search, status: r.status() })
      })
      await page.goto(`${server.base}/`)
      await waitForWidget(page, mode)
      await sleep(2000)
      const summary = new Map<string, number>()
      for (const r of rows) summary.set(`${r.method} ${r.path} -> ${r.status}`, (summary.get(`${r.method} ${r.path} -> ${r.status}`) ?? 0) + 1)
      const list = [...summary].map(([k, n]) => `${n}x ${k}`)
      report['requests'] = list
      console.log(`  ${mode} requests:\n    ${list.join('\n    ')}`)
      const core = rows.filter((r) => r.path.startsWith('/api/v1/core/'))
      const allowed = new Set(['/api/v1/core/recurring-items/upcoming', '/api/v1/core/accounts/list'])
      check(tag('the only /core requests are the two the widget is granted, all answered 200'),
        core.length > 0 && core.every((r) => allowed.has(r.path) && r.method === 'GET' && r.status === 200), core)
      check(tag('no request is refused (no 401, 403 or 429)'), rows.every((r) => ![401, 403, 429].includes(r.status)), rows.filter((r) => [401, 403, 429].includes(r.status)))
      if (mode === 'isolated') {
        check(tag('the frame\'s token is minted once, for this plugin'),
          rows.filter((r) => r.method === 'POST' && r.path === `/api/v1/plugins/${UPCOMING}/token`).length === 1, rows.filter((r) => r.path.includes('/token')))
      }
    } finally { await browser.close() }
  } finally { await server.close() }
}

interface Sample {
  firstMs: number; rssMiB: number; renderers: number; mainHeapMiB: number; frameHeapMiB: number
  framesAtLoad: number; framesAtBottom: number; rssBottomMiB: number; widgets: number
}

async function heapOf(s: Playwright.CDPSession): Promise<number> {
  await s.send('Performance.enable').catch(() => undefined)
  await s.send('HeapProfiler.collectGarbage').catch(() => undefined)
  const metrics = (await s.send('Performance.getMetrics')).metrics
  return (metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576
}

async function sampleOnce(pw: typeof Playwright, base: string, mode: Mode): Promise<Sample> {
  const { browser, ctx, page, pid } = await open(pw, base, { width: VW!, height: VH! })
  try {
    await page.goto(`${base}/`)
    const firstMs = await waitForWidget(page, mode)
    await sleep(3000)
    const frames = (): Promise<number> => page.locator('iframe.plugin-frame, iframe[title]').count()
    const framesAtLoad = await frames()
    const mem = treeMemory(pid)
    const cdp = await ctx.newCDPSession(page)
    const mainHeap = await heapOf(cdp)
    const perFrame: number[] = []
    for (const f of page.frames()) {
      if (f === page.mainFrame() || !f.url().includes('/plugin-frame')) continue
      const s = await ctx.newCDPSession(f).catch(() => null)
      if (s !== null) perFrame.push(Math.round((await heapOf(s)) * 10) / 10)
    }
    // Frames of one site can share a renderer process, and each frame's session then reports that process's heap.
    const frameHeap = [...new Set(perFrame)].reduce((a, b) => a + b, 0)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(3500)
    return {
      firstMs, rssMiB: mem.mib, renderers: mem.renderers, mainHeapMiB: Math.round(mainHeap * 10) / 10, frameHeapMiB: Math.round(frameHeap * 10) / 10,
      framesAtLoad, framesAtBottom: await frames(), rssBottomMiB: treeMemory(pid).mib, widgets: await page.locator('.slot-item').count(),
    }
  } finally { await browser.close() }
}

/** What the Upcoming widget (and, in a frame, its frame) fetched: script and style bytes, raw and compressed. */
async function widgetBytes(pw: typeof Playwright, base: string, mode: Mode) {
  const { browser, page } = await open(pw, base, { width: VW!, height: VH! })
  try {
    const rows: Array<{ owner: string; url: string; type: string; bytes: number; gzip: number; brotli: number }> = []
    const pending: Array<Promise<void>> = []
    page.on('response', (r) => {
      const t = r.request().resourceType()
      if (t !== 'script' && t !== 'stylesheet') return
      pending.push((async () => {
        const body = await r.body().catch(() => Buffer.alloc(0))
        const frame = r.frame()
        const owner = frame === page.mainFrame() ? 'page' : (await frame.frameElement().then((e) => e.getAttribute('title')).catch(() => null)) ?? 'frame'
        rows.push({ owner, url: new URL(r.url()).pathname, type: t, bytes: body.length, gzip: gzipSync(body).length, brotli: brotliCompressSync(body).length })
      })())
    })
    await page.goto(`${base}/`)
    await waitForWidget(page, mode)
    await sleep(1500)
    await Promise.all(pending)
    return rows
  } finally { await browser.close() }
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
  if (only === undefined || only === 'check') {
    const axeSource = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
    for (const mode of modes) {
      const r: Record<string, unknown> = {}
      report[mode] = r
      await sizeChecks(pw, mode, r)
      await behaviourChecks(pw, mode, axeSource, r)
      await requestList(pw, mode, r)
    }
    const strip = (xs: unknown): string[] => (xs as string[] | undefined ?? []).map((x) => x.replace(/^frame\([^)]*\):|^page:/, ''))
    for (const dir of ['forward', 'backward'] as const) {
      const a = (report['in-realm'] as Record<string, unknown> | undefined)?.[`tab-${dir}-in-realm`]
      const b = (report['isolated'] as Record<string, unknown> | undefined)?.[`tab-${dir}-isolated`]
      if (a !== undefined && b !== undefined) check(`Tab order ${dir} is the same in a frame as in the page`, strip(a).join('|') === strip(b).join('|'), { page: strip(a), frame: strip(b) })
    }
  }
  if (only === undefined || only === 'measure') {
    // Alternate the modes sample by sample, so a slow minute on the machine hits both alike. One discarded warm-up each.
    const byMode: Record<string, Sample[]> = {}
    for (let i = -1; i < SAMPLES; i++) {
      for (const mode of modes) {
        const server = await startServer(manifests(mode))
        try {
          const s = await sampleOnce(pw, server.base, mode)
          if (i >= 0) (byMode[mode] ??= []).push(s)
        } finally { await server.close() }
        await sleep(300)
      }
    }
    for (const mode of modes) {
      const samples = byMode[mode] ?? []
      const rr = (report[mode] ??= {}) as Record<string, unknown>
      rr['samples'] = samples
      const col = (k: keyof Sample): number[] => samples.map((x) => x[k])
      const range = (k: keyof Sample): string => `${Math.min(...col(k))}-${Math.max(...col(k))}`
      rr['median'] = {
        n: samples.length, viewport: `${VW}x${VH}`,
        firstMs: median(col('firstMs')), firstMsRange: range('firstMs'),
        rssMiB: median(col('rssMiB')), rssRange: range('rssMiB'), rssBottomMiB: median(col('rssBottomMiB')),
        mainHeapMiB: median(col('mainHeapMiB')), frameHeapMiB: median(col('frameHeapMiB')), renderers: median(col('renderers')),
        framesAtLoad: median(col('framesAtLoad')), framesAtBottom: median(col('framesAtBottom')), widgets: samples[0]?.widgets,
      }
      console.log(`${mode} median: ${JSON.stringify(rr['median'])}`)
      const server = await startServer(manifests(mode))
      try { rr['bytes'] = await widgetBytes(pw, server.base, mode) } finally { await server.close() }
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
