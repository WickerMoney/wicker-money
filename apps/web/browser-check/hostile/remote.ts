/**
 * The remote-origin gate in a real browser (ADR 0005, stage 5).
 *
 * A third-party plugin is a build served from another origin, listed in a manifest with an integrity pin. This
 * starts the real API with that origin allowlisted, serves a real federated build over https from a second
 * server, and drives Chromium to show that:
 *
 *  - a pinned build loads, in the frame and nowhere else (the page itself never asks the remote origin for anything),
 *  - a changed chunk, or a changed entry, is refused before it runs, with a reason,
 *  - an origin that is not allowlisted cannot be loaded even from inside a running frame, and receives no request,
 *  - a crafted manifest (server code, `isolated: false`, a bundled id, no pin) is refused or still isolated.
 *
 * It needs the same things as `run.ts` (a built web app, a migrated test database, Chromium) plus `openssl`, for a
 * throwaway certificate. `pnpm --filter @wickermoney/web test:hostile` runs it after the hostile suite.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as Playwright from 'playwright-core'
import { buildApp } from '../../../api/src/app.js'
import { loadConfig } from '../../../api/src/config.js'
import { configureTenantContext } from '../../../api/src/db/configureTenantContext.js'
import { createDb } from '../../../api/src/db/client.js'
import { BUNDLED_PLUGINS } from '../../../api/src/plugins/bundled.js'
import { pluginRuntimeFor } from '../../../api/src/plugins/pluginRuntime.js'
import { seedBundledPlugins } from '../../../api/src/plugins/registry.js'
import { TEST_ADMIN_DATABASE_URL, TEST_AUTH_SECRET, TEST_DATABASE_URL, migrateTestDatabase } from '../../../api/src/testing/harness.js'
import { SDK_MAJOR_VERSION } from '@wickermoney/plugin-sdk'
import { Recorder } from './lib.js'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '../..')
const CHROMIUM = process.env['CHROMIUM_PATH']
const rec = new Recorder()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const PLUGIN_ID = 'acme.victim'
const NAME = 'acme_victim'

async function buildRemote(outDir: string): Promise<void> {
  const { build } = await import('vite')
  const { federation } = await import('@module-federation/vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    root: join(here, 'fixture'), configFile: false, logLevel: 'error',
    plugins: [
      react(),
      federation({
        name: NAME, filename: 'remoteEntry.js', dts: false,
        exposes: { './Victim': join(here, 'fixture/Victim.tsx') },
        shared: { react: { singleton: true, requiredVersion: '^19.0.0' }, 'react-dom': { singleton: true, requiredVersion: '^19.0.0' } },
      }),
    ],
    build: { rollupOptions: { input: join(here, 'fixture/index.ts') }, outDir, emptyOutDir: true, target: 'esnext', modulePreload: false, cssCodeSplit: false },
  })
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path, base) : [relative(base, path).split('\\').join('/')]
  })
}

type Mode = 'pristine' | 'tamper-chunk' | 'tamper-entry'

/** An https server for the remote origin. What it serves, and how often it was asked, is the evidence. */
class RemoteOrigin {
  mode: Mode = 'pristine'
  readonly hits: string[] = []
  private server: ReturnType<typeof createServer> | undefined
  constructor(private readonly files: Map<string, Buffer>, private readonly tampered: { entry: string; chunk: string }, private readonly tls: { key: Buffer; cert: Buffer }) {}

  async start(): Promise<string> {
    this.server = createServer(this.tls, (req, res) => {
      const path = (req.url ?? '/').split('?')[0]!.replace(/^\//, '')
      this.hits.push(path)
      let body = this.files.get(path)
      if (body === undefined) { res.writeHead(404).end(); return }
      if ((this.mode === 'tamper-chunk' && path === this.tampered.chunk) || (this.mode === 'tamper-entry' && path === this.tampered.entry)) {
        body = Buffer.concat([body, Buffer.from('\n/* changed after the pin was taken */\n')])
      }
      res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(body)
    })
    await new Promise<void>((resolve) => this.server!.listen(0, 'localhost', resolve))
    return `https://localhost:${(this.server.address() as AddressInfo).port}`
  }

  close(): Promise<void> { return new Promise((resolve) => { this.server?.close(() => resolve()); this.server?.closeAllConnections() }) }
}

async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 8000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
  await page.waitForSelector('.wiz', { state: 'detached', timeout: 8000 }).catch(() => undefined)
}

async function main(): Promise<void> {
  const pw = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright
  const work = mkdtempSync(join(tmpdir(), 'wm-remote-'))
  const buildDir = join(work, 'remote-build')
  await buildRemote(buildDir)
  const names = listFiles(buildDir).filter((n) => n.endsWith('.js'))
  const files = new Map(names.map((n) => [n, readFileSync(join(buildDir, n))]))
  const integrity = Object.fromEntries(names.map((n) => [n, `sha384-${createHash('sha384').update(files.get(n)!).digest('base64')}`]))
  const chunk = names.find((n) => n !== 'remoteEntry.js')
  if (!names.includes('remoteEntry.js') || chunk === undefined) throw new Error(`the fixture build has no entry and chunk to pin: ${names.join(', ')}`)
  console.log(`pinned ${names.length} files, tampering with ${chunk}`)

  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem')], { stdio: 'ignore' })
  const tls = { key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) }
  const remote = new RemoteOrigin(files, { entry: 'remoteEntry.js', chunk }, tls)
  const other = new RemoteOrigin(files, { entry: 'remoteEntry.js', chunk }, tls)
  const remoteOrigin = await remote.start()
  const otherOrigin = await other.start()

  const dist = join(work, 'dist')
  cpSync(join(webRoot, 'dist'), dist, { recursive: true })
  await migrateTestDatabase()
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET, AUTH_ACCESS_TTL_SECONDS: '900',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000', LOG_LEVEL: 'silent', WEB_DIST_DIR: dist,
    PLUGIN_REMOTE_ORIGINS: remoteOrigin,
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const admin = createDb(TEST_ADMIN_DATABASE_URL)

  const base = {
    name: 'Remote Victim', version: '1.0.0', description: 'Third-party fixture.', author: 'test', sdkVersion: SDK_MAJOR_VERSION,
    requiredTables: [{ table: 'transactions', access: 'read' }], permissions: [],
  }
  const widget = { id: 'w1', slot: 'dashboard.primary', title: 'Victim', defaultSize: 'md', order: 1, module: './Victim' }
  const entry = `${remoteOrigin}/remoteEntry.js`
  const external = [
    { source: 'victim.json', manifest: { ...base, id: PLUGIN_ID, remoteEntry: entry, integrity, contributes: { pages: [], widgets: [widget] } } },
    // A hand-written manifest asking for everything a plugin should never get.
    { source: 'crafted.json', manifest: { ...base, id: 'acme.crafted', remoteEntry: entry, integrity, isolated: false, contributes: { pages: [], widgets: [{ ...widget, id: 'c1', title: 'Crafted' }], endpoints: true, exporters: true } } },
    { source: 'crafted-inrealm.json', manifest: { ...base, id: 'acme.crafted-inrealm', remoteEntry: entry, integrity, isolated: false, contributes: { pages: [], widgets: [{ ...widget, id: 'c2', title: 'Crafted in-realm' }] } } },
    { source: 'nopin.json', manifest: { ...base, id: 'acme.nopin', remoteEntry: entry, contributes: { pages: [], widgets: [] } } },
    { source: 'elsewhere.json', manifest: { ...base, id: 'acme.elsewhere', remoteEntry: `${otherOrigin}/remoteEntry.js`, integrity, contributes: { pages: [], widgets: [] } } },
  ]
  const bundled = BUNDLED_PLUGINS.filter((m) => pluginRuntimeFor(m, true) === 'in-realm')
  const app = buildApp({ db, config, pluginOptions: { bundled, external } })
  await app.ready()
  await seedBundledPlugins(db, { bundled, external })
  await app.listen({ port: 0, host: 'localhost' })
  const apiBase = `http://localhost:${(app.server.address() as AddressInfo).port}`

  const browser = await pw.chromium.launch({
    ...(CHROMIUM !== undefined ? { executablePath: CHROMIUM } : { channel: 'chromium' as const }),
    args: ['--no-sandbox'],
  })
  console.log(`engine: chromium ${browser.version()}`)
  const ids = external.map((e) => e.manifest.id)
  try {
    // A refresh token is single use, so each browser context signs in as its own user.
    const signUp = async (): Promise<{ refresh: string; access: string }> => {
      const email = `remote-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
      const res = await fetch(`${apiBase}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }) })
      if (res.status !== 201) throw new Error(`register failed: ${res.status}`)
      return {
        refresh: res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))!.split(';')[0]!.split('=')[1]!,
        access: ((await res.json()) as { accessToken: string }).accessToken,
      }
    }
    const { access } = await signUp()
    // Third-party plugins are registered switched off. Turn them on the way an owner would.
    await admin.updateTable('core.plugins').set({ enabled: true }).where('plugin_id', 'in', ids).execute()

    const list = await (await fetch(`${apiBase}/api/v1/plugins`, { headers: { authorization: `Bearer ${access}` } })).json() as {
      plugins: Array<{ id: string; runtime: string; bundled: boolean; integrity?: unknown; contributes: { endpoints: boolean; exporters: boolean } }>
      failures: Array<{ pluginId: string; reason: string }>
    }
    const byId = (id: string) => list.plugins.find((p) => p.id === id)
    const failed = (id: string) => list.failures.find((f) => f.pluginId === id)?.reason ?? ''
    rec.check('the pinned plugin is listed as isolated, not bundled, with its pin', byId(PLUGIN_ID)?.runtime === 'isolated' && byId(PLUGIN_ID)?.bundled === false && byId(PLUGIN_ID)?.integrity !== undefined, byId(PLUGIN_ID))
    rec.check('a crafted manifest with server code is refused, and says why', byId('acme.crafted') === undefined && /server half|no server/.test(failed('acme.crafted')), failed('acme.crafted'))
    rec.check('a crafted manifest with isolated:false is still listed as isolated', byId('acme.crafted-inrealm')?.runtime === 'isolated', byId('acme.crafted-inrealm'))
    rec.check('a manifest with no pin is refused, and says what to add', byId('acme.nopin') === undefined && /integrity pin/.test(failed('acme.nopin')), failed('acme.nopin'))
    rec.check('a manifest for an origin that is not allowlisted is refused', byId('acme.elsewhere') === undefined && failed('acme.elsewhere') !== '', failed('acme.elsewhere'))

    interface Seen { framed: number; unframed: number }
    /** Opens the dashboard in a fresh browser context (so nothing is cached) and reports what the frame did. */
    async function openDashboard(mode: Mode): Promise<{ state: 'ran' | 'refused' | 'nothing'; message: string; seen: Seen; page: Playwright.Page; frame: Playwright.Frame | undefined; ctx: Playwright.BrowserContext; csp: string[] }> {
      remote.mode = mode
      remote.hits.length = 0
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })
      await ctx.addCookies([{ name: 'wickermoney_refresh', value: (await signUp()).refresh, url: apiBase }])
      const page = await ctx.newPage()
      const seen: Seen = { framed: 0, unframed: 0 }
      const csp: string[] = []
      page.on('request', (r) => {
        if (!r.url().startsWith(remoteOrigin)) return
        if (r.frame().url().includes('/plugin-frame')) seen.framed++
        else seen.unframed++
      })
      page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()) })
      await page.goto(`${apiBase}/`)
      await dismissWizard(page)
      await page.waitForSelector(`iframe[title^="Remote Victim"]`, { state: 'attached', timeout: 30_000 })
      let state: 'ran' | 'refused' | 'nothing' = 'nothing'
      let message = ''
      let frame: Playwright.Frame | undefined
      for (let i = 0; i < 60 && state === 'nothing'; i++) {
        frame = page.frames().find((f) => f.url().includes('/plugin-frame') && f.url().includes('acme.victim'))
        if (frame !== undefined) {
          const probe = await frame.evaluate(() => ({ ran: (window as unknown as { __victim?: unknown }).__victim !== undefined, alert: document.querySelector('p[role=alert]')?.textContent ?? '' })).catch(() => undefined)
          if (probe?.ran === true) state = 'ran'
          else if (probe !== undefined && probe.alert !== '') { state = 'refused'; message = probe.alert }
        }
        if (state === 'nothing') await sleep(500)
      }
      return { state, message, seen, page, frame, ctx, csp }
    }

    const ok = await openDashboard('pristine')
    rec.check('a build that matches its pin loads and runs in the frame', ok.state === 'ran', ok.message)
    rec.check('the page itself never asked the remote origin for anything; the frame did', ok.seen.unframed === 0 && ok.seen.framed > 0, ok.seen)
    rec.check('the frame is opaque, so the plugin has no cookies or storage of the host', ok.frame !== undefined && (await ok.frame.evaluate(() => self.origin)) === 'null')

    // From inside a running frame: an origin the operator did not allow. The call runs from a timer because a
    // DevTools evaluation may do what a page's own code may not.
    if (ok.frame !== undefined) {
      other.hits.length = 0
      const before = ok.csp.length
      await ok.frame.evaluate((url) => { setTimeout(() => { void import(/* @vite-ignore */ url).catch(() => undefined) }, 0) }, `${otherOrigin}/remoteEntry.js`)
      await sleep(1500)
      rec.check('an origin that is not allowlisted is blocked by the frame policy, and receives no request', other.hits.length === 0 && ok.csp.length > before, { hits: other.hits, csp: ok.csp.slice(before) })
    }
    await ok.ctx.close()

    for (const [mode, label] of [['tamper-chunk', 'a changed chunk'], ['tamper-entry', 'a changed entry']] as const) {
      const bad = await openDashboard(mode)
      rec.check(`${label} is refused before it runs, with the integrity reason`, bad.state === 'refused' && /integrity pin/.test(bad.message), bad.message || bad.state)
      rec.check(`${label}: the plugin's code never executed`, bad.frame !== undefined && (await bad.frame.evaluate(() => (window as unknown as { __victim?: unknown }).__victim === undefined)))
      rec.check(`${label}: nothing was loaded by the page itself`, bad.seen.unframed === 0, bad.seen)
      await bad.ctx.close()
    }
  } finally {
    await browser.close()
    await app.close()
    await db.destroy()
    await admin.deleteFrom('core.plugins').where('plugin_id', 'in', ids).execute().catch(() => undefined)
    await admin.destroy()
    await remote.close()
    await other.close()
    rmSync(work, { recursive: true, force: true })
  }
  console.log(`\n${rec.checks.length} checks, ${rec.failed} failed.`)
  process.exit(rec.failed === 0 ? 0 : 1)
}

main().catch((error: unknown) => { console.error(error); process.exit(2) })
