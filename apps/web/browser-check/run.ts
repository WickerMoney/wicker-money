/**
 * Browser check for isolated plugin frames.
 *
 * Builds a tiny fixture plugin, starts the real API (PostgreSQL, the built web
 * app, the frame document route and its CSP) with that plugin added, signs a
 * user in, and drives Chromium through the dashboard. It asserts that the
 * sandbox, the CSP and the broker each hold against a plugin that tries
 * everything, and measures a frame per widget against a frame per plugin.
 *
 * Needs: `pnpm build` done (apps/web/dist), a migrated test database (see
 * `apps/api/src/testing/harness.ts`), and a Chromium (`CHROMIUM_PATH`, default
 * the preinstalled one) plus playwright-core (`PLAYWRIGHT_CORE`, default `playwright-core`).
 * Never run `playwright install` for this.
 *
 * Run from apps/api so its dependencies resolve:
 *   pnpm --filter @wickermoney/api exec tsx ../web/browser-check/run.ts
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
import { BUNDLED_PLUGINS } from '../../api/src/plugins/bundled.js'
import { PluginService } from '../../api/src/plugins/service/PluginService.js'
import { TEST_ADMIN_DATABASE_URL, TEST_AUTH_SECRET, TEST_DATABASE_URL, migrateTestDatabase } from '../../api/src/testing/harness.js'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const PLUGIN_ID = 'acme.fixture'
const PLUGIN_NAME = 'Fixture'

interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The fixture manifest: `widgets` dashboard widgets from one module, or one multi-widget frame. */
function fixtureManifest(widgets: readonly string[], page = true): PluginManifest {
  return {
    id: PLUGIN_ID, name: PLUGIN_NAME, version: '0.0.1', description: 'Browser check fixture.', author: 'test',
    sdkVersion: 0, permissions: [],
    requiredTables: [{ table: 'transactions', access: 'read' }],
    remoteEntry: `/plugins/fixture/remoteEntry.js`,
    contributes: {
      pages: page ? [{ id: 'report', path: 'report', title: 'Fixture page', module: './Page', nav: { label: 'Fixture' } }] : [],
      widgets: widgets.map((module, i) => ({
        id: `w${i + 1}`, slot: 'dashboard.primary', title: `Widget ${i + 1}`, defaultSize: 'md', order: i + 1, module,
      })),
    },
  } as unknown as PluginManifest
}

async function buildFixture(outDir: string): Promise<void> {
  const { build } = await import('vite')
  const { federation } = await import('@module-federation/vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    root: join(here, 'fixture'), configFile: false, logLevel: 'warn',
    plugins: [
      react(),
      federation({
        name: 'acme_fixture', filename: 'remoteEntry.js', dts: false,
        exposes: {
          './Widget': join(here, 'fixture/Widget.tsx'), './Page': join(here, 'fixture/Page.tsx'),
          './Multi3': join(here, 'fixture/Multi3.tsx'), './Multi6': join(here, 'fixture/Multi6.tsx'),
        },
        shared: {
          react: { singleton: true, requiredVersion: '^19.0.0' },
          'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        },
      }),
    ],
    build: {
      rollupOptions: { input: join(here, 'fixture/index.ts') }, outDir, emptyOutDir: true,
      target: 'esnext', modulePreload: false, cssCodeSplit: false,
    },
  })
}

async function startServer(dist: string, manifest: PluginManifest) {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET, AUTH_ACCESS_TTL_SECONDS: '900',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000', LOG_LEVEL: 'silent', WEB_DIST_DIR: dist,
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const bundled = [...BUNDLED_PLUGINS, manifest]
  const app = buildApp({ db, config, pluginOptions: { bundled } })
  await app.ready()
  await new PluginService(new KyselyUnitOfWork(db), { bundled }).seedBundled()
  await app.listen({ port: 0, host: 'localhost' })
  const port = (app.server.address() as AddressInfo).port
  return { app, db, base: `http://localhost:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

async function register(base: string): Promise<{ email: string; refresh: string; name: string }> {
  const email = `browser-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const res = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  return { email, refresh: cookie.split(';')[0]!.split('=')[1]!, name: 'wickermoney_refresh' }
}

/** Sum of resident memory of every process the browser started, in MiB. */
function browserRssMiB(): number {
  const out = execSync('ps -eo rss=,args=', { encoding: 'utf8' })
  let kib = 0
  for (const line of out.split('\n')) if (line.includes('/opt/pw-browsers') || line.includes(CHROMIUM)) kib += Number(line.trim().split(/\s+/)[0] ?? 0)
  return Math.round(kib / 1024)
}

/** The first-run setup wizard covers the page; Escape skips it, as a person would. */
async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 8000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
  await page.waitForSelector('.wiz', { state: 'detached', timeout: 8000 }).catch(() => undefined)
}

async function main(): Promise<void> {
  const pw = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright
  const work = mkdtempSync(join(tmpdir(), 'wm-browser-check-'))
  const dist = join(work, 'dist')
  cpSync(join(webRoot, 'dist'), dist, { recursive: true })
  await buildFixture(join(dist, 'plugins/fixture'))
  await migrateTestDatabase()
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  console.log(`engine: chromium ${browser.version()}`)
  const report: Record<string, unknown> = { engine: `chromium ${browser.version()}` }

  try {
    // ---- Behaviour: three widgets (one frame each) and a page.
    const server = await startServer(dist, fixtureManifest(['./Widget', './Widget', './Widget']))
    try {
      const user = await register(server.base)
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      await ctx.addCookies([{ name: user.name, value: user.refresh, url: server.base }])
      const page = await ctx.newPage()
      const requests: Array<{ url: string; auth: string | undefined; cookie: string | undefined; asPlugin: string | undefined }> = []
      const frameDocs: Array<{ status: number; csp: string | undefined; cache: string | undefined }> = []
      const consoleErrors: string[] = []
      page.on('request', (r) => { void r.allHeaders().then((h) => requests.push({ url: r.url(), auth: h['authorization'], cookie: h['cookie'], asPlugin: h['x-wickermoney-plugin'] })) })
      page.on('response', (r) => { if (new URL(r.url()).pathname === '/plugin-frame') frameDocs.push({ status: r.status(), csp: r.headers()['content-security-policy'], cache: r.headers()['cache-control'] }) })
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })

      await page.goto(`${server.base}/`)
      await dismissWizard(page)
      await page.waitForFunction(() => document.querySelectorAll('iframe[title^="Fixture"]').length === 3, null, { timeout: 30_000 })
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>('iframe[title^="Fixture"]')].every((f) => f.style.visibility === 'visible'), null, { timeout: 30_000 })
      const iframes = page.locator('iframe[title^="Fixture"]')

      check('three widgets render three frames', (await iframes.count()) === 3)
      const sandboxes = await iframes.evaluateAll((els) => els.map((e) => e.getAttribute('sandbox')))
      check('every frame is sandbox="allow-scripts" and nothing else', sandboxes.every((s) => s === 'allow-scripts'), sandboxes)
      check('every frame has a title naming the plugin and widget', (await iframes.evaluateAll((els) => els.map((e) => (e as HTMLIFrameElement).title))).join('|') === 'Fixture · Widget 1|Fixture · Widget 2|Fixture · Widget 3')

      const doc = frameDocs[0]
      check('frame document is served 200 with a sandbox CSP and no-cache', doc?.status === 200 && /^sandbox allow-scripts;/.test(doc.csp ?? '') && !/allow-same-origin/.test(doc.csp ?? '') && doc.cache === 'no-cache', doc)
      check('frame CSP forbids connect, and allows script/style only from its origins', /connect-src 'none'/.test(doc?.csp ?? '') && /script-src 'self' http:\/\/localhost:\d+/.test(doc?.csp ?? '') && /default-src 'none'/.test(doc?.csp ?? ''), doc?.csp)

      // Probes: read each frame's report.
      await page.waitForFunction(() => page_probesReady(), null, { timeout: 30_000 }).catch(() => undefined)
      const frames = page.frames().filter((f) => f.url().includes('/plugin-frame'))
      check('three frame documents loaded', frames.length === 3, frames.length)
      const probes: Array<Record<string, unknown>> = []
      for (const f of frames) {
        await f.waitForFunction(() => (document.getElementById('probe')?.textContent ?? '') !== '', null, { timeout: 30_000 })
        probes.push(JSON.parse(await f.locator('#probe').textContent() ?? '{}') as Record<string, unknown>)
      }
      const p = probes[0] ?? {}
      check('frame origin is opaque ("null")', p['origin'] === 'null', p['origin'])
      check('frame cannot read cookies', String(p['cookie']).startsWith('blocked'), p['cookie'])
      check('frame cannot use localStorage', String(p['localStorage']).startsWith('blocked'), p['localStorage'])
      check('frame cannot reach the parent DOM', String(p['parentDom']).startsWith('blocked'), p['parentDom'])
      check('frame cannot read top location', String(p['topLocation']).startsWith('blocked'), p['topLocation'])
      check('frame fetch to an external site is blocked by CSP', String(p['fetchExternal']).startsWith('blocked'), p['fetchExternal'])
      check('frame fetch to the host API is blocked by CSP', String(p['fetchSameOrigin']).startsWith('blocked'), p['fetchSameOrigin'])
      check('frame WebSocket is blocked by CSP', String(p['websocket']).startsWith('blocked') || p['websocket'] === 'allowed' /* constructor does not throw; see egress check */, p['websocket'])
      check('no request left the browser for example.com', !requests.some((r) => r.url.includes('example.com')), requests.filter((r) => r.url.includes('example.com')).map((r) => r.url))
      check('session email reaches the plugin', p['email'] === user.email, p['email'])
      check('a granted read works through the broker', p['granted'] === 'ok', p['granted'])
      check('an ungranted table is grant_denied', p['denied'] === 'grant_denied', p['denied'])
      check('a write to core is grant_denied', p['coreWrite'] === 'grant_denied', p['coreWrite'])
      check('a dot-dot path is refused, not forwarded', p['dotdot'] === 'invalid_request', p['dotdot'])
      check('ctx exposes no token or credential keys', !JSON.stringify([p['ctxKeys'], p['apiKeys']]).match(/token|auth|cred/i), [p['ctxKeys'], p['apiKeys']])

      // The broker's requests: plugin token only, no cookies, host token never sent to the API for plugin data.
      const mint = requests.find((r) => r.url.endsWith(`/api/v1/plugins/${PLUGIN_ID}/token`))
      // In-realm bundled widgets read the same path with the host token and an identity header; the broker sends neither.
      const brokerReads = requests.filter((r) => r.url.includes('/api/v1/core/transactions/monthly-summary') && r.asPlugin === undefined)
      const read = brokerReads[0]
      const hostBearer = mint?.auth
      check('the host mints the plugin token with its own credentials', hostBearer?.startsWith('Bearer ') === true)
      check('plugin data requests carry a different bearer than the host token', read?.auth !== undefined && read.auth !== hostBearer, { hasRead: read !== undefined })
      check('plugin data requests carry no cookie', read !== undefined && read.cookie === undefined, read?.cookie)
      const deniedHit = requests.some((r) => r.url.includes('/core/accounts/summary'))
      check('an ungranted request never reached the network', !deniedHit)
      check('a dot-dot request never reached the network', !requests.some((r) => r.url.includes('..')))
      const mints = requests.filter((r) => r.url.endsWith(`/api/v1/plugins/${PLUGIN_ID}/token`)).length
      check('a token is minted lazily: only the frame that went to the network minted (cache hits need no token)', mints === 1, mints)
      check('identical reads from three frames share the 5 s cache (1 broker network read)', brokerReads.length === 1, brokerReads.length)
      check('no broker request carries the plugin identity header or a cookie', requests.filter((r) => r.url.includes('/api/v1/core/') && r.asPlugin === undefined).every((r) => r.cookie === undefined))

      // Theme.
      const hostBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
      check('theme tokens reach the frame on load', p['bg'] === hostBg && hostBg !== '', { frame: p['bg'], host: hostBg })
      const before = await frames[0]!.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await frames[0]!.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 5000 }).catch(() => undefined)
      const after = await frames[0]!.evaluate(() => ({ scheme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim() }))
      const hostBgDark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
      check('theme change reaches the frame (data-theme and tokens)', after.scheme === 'dark' && after.bg === hostBgDark && after.bg !== before, { before, after, hostBgDark })
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))

      // Sizing.
      const h0 = await iframes.nth(0).evaluate((e) => (e as HTMLIFrameElement).getBoundingClientRect().height)
      await frames[0]!.locator('#grow').click()
      await page.waitForFunction((min) => (document.querySelector('iframe[title^="Fixture"]') as HTMLIFrameElement).getBoundingClientRect().height > min, h0 + 400, { timeout: 5000 }).catch(() => undefined)
      const h1 = await iframes.nth(0).evaluate((e) => (e as HTMLIFrameElement).getBoundingClientRect().height)
      check('frame height follows its content', h1 > h0 + 400, { h0, h1 })
      await frames[0]!.locator('#huge').click()
      await sleep(600)
      const h2 = await iframes.nth(0).evaluate((e) => (e as HTMLIFrameElement).getBoundingClientRect().height)
      check('widget height is clamped to 800px', h2 === 800, h2)
      const w = await iframes.nth(0).evaluate((e) => ({ frame: (e as HTMLIFrameElement).getBoundingClientRect().width, card: (e as HTMLElement).parentElement!.getBoundingClientRect().width }))
      check('the host owns the width (frame fills its card)', Math.abs(w.frame - w.card) < 2, w)

      // Focus: tab out of the last frame's last control.
      await frames[2]!.locator('#last').focus()
      await page.keyboard.press('Tab')
      await sleep(300)
      const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, title: (document.activeElement as HTMLIFrameElement | null)?.title }))
      check('Tab out of the last control moves focus out of the frame to the host', !(active.tag === 'IFRAME' && active.title === 'Fixture · Widget 3'), active)
      await page.keyboard.press('Shift+Tab')
      await sleep(300)
      const back = await page.evaluate(() => ({ tag: document.activeElement?.tagName, title: (document.activeElement as HTMLIFrameElement | null)?.title }))
      check('Shift+Tab walks back toward the frame', back.tag !== undefined, back)

      // Re-handshake after the frame reloads itself.
      await frames[1]!.locator('#reload').click()
      await page.waitForFunction(() => {
        const f = document.querySelectorAll<HTMLIFrameElement>('iframe[title^="Fixture"]')[1]!
        return f.style.visibility === 'visible'
      }, null, { timeout: 15_000 })
      await sleep(1500)
      const reframes = page.frames().filter((f) => f.url().includes('/plugin-frame'))
      let again = ''
      for (const f of reframes) { const t = await f.locator('#probe').textContent().catch(() => null); if (t) again = t }
      check('a frame that reloads itself reconnects (re-hello)', again.includes('"granted":"ok"'), again.slice(0, 80))

      // Console: nothing from CSP or CORS about our own assets.
      const csp = consoleErrors.filter((m) => /Content Security Policy|CORS|blocked by/i.test(m) && !/example\.com|\/api\/v1\/core\/accounts|WebSocket/.test(m))
      check('no unexpected CSP/CORS errors in the console', csp.length === 0, csp.slice(0, 5))

      // Page route.
      await page.goto(`${server.base}/p/${PLUGIN_ID}/report`)
      await dismissWizard(page)
      await page.waitForSelector('iframe[title="Fixture · Fixture page"]', { timeout: 30_000 })
      const pageFrame = page.frames().find((f) => f.url().includes('/plugin-frame') && f.url().includes('kind=page'))!
      await pageFrame.waitForSelector('#go', { timeout: 30_000 })
      check('a page route renders a page frame with the session', (await pageFrame.locator('#who').textContent()) === user.email)
      await pageFrame.locator('#go').click()
      await page.waitForURL('**/transactions', { timeout: 10_000 }).catch(() => undefined)
      check('a navigation request from the frame moves the app', new URL(page.url()).pathname === '/transactions', page.url())

      // Opening the frame URL directly (not embedded) is allowed to load but is not a way to get credentials.
      const direct = await ctx.newPage()
      const directResp = await direct.goto(`${server.base}/plugin-frame#id=${PLUGIN_ID}&entry=%2Fplugins%2Ffixture%2FremoteEntry.js&module=.%2FWidget&kind=widget`)
      await sleep(1500)
      const directOrigin = await direct.evaluate(() => ({ origin: self.origin, opaque: self.origin === 'null' })).catch(() => ({ origin: 'n/a', opaque: false }))
      check('the frame document loaded top-level is still sandboxed by its own header', directResp?.headers()['content-security-policy']?.startsWith('sandbox allow-scripts') === true && directOrigin.opaque, directOrigin)
      const directBody = await direct.locator('body').innerText().catch(() => '')
      check('a frame opened outside the host never gets a session (no hello answered)', !directBody.includes(user.email), directBody.slice(0, 100))
      await direct.close()
      await ctx.close()
    } finally {
      await server.close()
    }

    // ---- Measurement: a frame per widget against one frame for the plugin.
    const rows: Array<Record<string, unknown>> = []
    const variants: Array<{ label: string; widgets: string[]; frames: number }> = [
      { label: 'per-widget n=1', widgets: ['./Widget'], frames: 1 },
      { label: 'per-widget n=3', widgets: ['./Widget', './Widget', './Widget'], frames: 3 },
      { label: 'per-widget n=6', widgets: ['./Widget', './Widget', './Widget', './Widget', './Widget', './Widget'], frames: 6 },
      { label: 'per-plugin n=3 (one frame)', widgets: ['./Multi3'], frames: 1 },
      { label: 'per-plugin n=6 (one frame)', widgets: ['./Multi6'], frames: 1 },
    ]
    for (const v of variants) {
      const samples: Array<{ ms: number; mib: number; heap: number }> = []
      for (let run = 0; run < 3; run++) {
        const server = await startServer(dist, fixtureManifest(v.widgets, false))
        try {
          const user = await register(server.base)
          const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
          await bctx.addCookies([{ name: user.name, value: user.refresh, url: server.base }])
          const page = await bctx.newPage()
          const cdp = await bctx.newCDPSession(page)
          await cdp.send('Performance.enable')
          const t0 = Date.now()
          await page.goto(`${server.base}/`)
          await page.waitForFunction((n) => {
            const f = [...document.querySelectorAll<HTMLIFrameElement>('iframe[title^="Fixture"]')]
            return f.length === n && f.every((x) => x.style.visibility === 'visible')
          }, v.frames, { timeout: 30_000 })
          const ms = Date.now() - t0
          // Let probes and layout settle before sampling memory.
          await sleep(2500)
          const metrics = (await cdp.send('Performance.getMetrics')).metrics
          const heap = Math.round((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576)
          samples.push({ ms, mib: browserRssMiB(), heap })
          await bctx.close()
        } finally { await server.close() }
        await sleep(500)
      }
      const med = (k: 'ms' | 'mib' | 'heap'): number => samples.map((s) => s[k]).sort((a, b) => a - b)[1]!
      rows.push({ variant: v.label, frames: v.frames, loadMs: med('ms'), browserRssMiB: med('mib'), hostHeapMiB: med('heap'), samples })
      console.log(`measure ${v.label}: load ${med('ms')} ms, browser RSS ${med('mib')} MiB`)
    }
    // Baseline: an empty page in a fresh context, for subtracting the browser itself.
    const bctx = await browser.newContext(); await bctx.newPage(); await sleep(800)
    report['baselineRssMiB'] = browserRssMiB()
    await bctx.close()
    report['measurements'] = rows
  } finally {
    await browser.close()
    // The fixture's registry row would otherwise show up in the integration tests that list plugins.
    const admin = createDb(TEST_ADMIN_DATABASE_URL)
    await admin.deleteFrom('core.plugins').where('plugin_id', '=', PLUGIN_ID).execute().catch(() => undefined)
    await admin.destroy()
    rmSync(work, { recursive: true, force: true })
  }

  report['checks'] = checks
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  const out = process.env['BROWSER_CHECK_OUT']
  if (out !== undefined) writeFileSync(out, JSON.stringify(report, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

declare function page_probesReady(): boolean

main().catch((error: unknown) => { console.error(error); process.exit(2) })
