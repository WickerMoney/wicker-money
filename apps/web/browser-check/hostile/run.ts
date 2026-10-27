/**
 * The hostile-plugin suite (ADR 0005, stage 4): a real browser, the real API, and a plugin built to misbehave.
 *
 * It starts the API with PostgreSQL and the built web app, adds the fixture plugin `acme.hostile` (granted
 * `transactions` read and nothing else) and a harmless neighbour, signs a user in, and drives Chromium. Every
 * attempt is judged from evidence the plugin cannot forge:
 *
 *  - what an attacker-controlled server on another origin received (HTTP, bare TCP, UDP),
 *  - what the API received (request log: auth kind, status, a marker the fixture puts on every URL it builds),
 *  - what the browser reported (CSP violations, console, failed requests, new windows, net log).
 *
 * Needs `pnpm build` (apps/web/dist), a migrated test database (see apps/api/src/testing/harness.ts) and a
 * Chromium: `CHROMIUM_PATH`, else Playwright's full Chromium (CI installs it with `playwright-core install chromium`;
 * a cloud sandbox with a preinstalled browser must not).
 *
 *   pnpm --filter @wickermoney/web test:hostile      (from the repo root; see DEVELOPMENT.md)
 *
 * `ONLY=<phase>[,<phase>]` runs some phases while iterating; CI runs all of them.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'
import { buildApp } from '../../../api/src/app.js'
import { loadConfig } from '../../../api/src/config.js'
import { KyselyUnitOfWork } from '../../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../../api/src/db/configureTenantContext.js'
import { createDb } from '../../../api/src/db/client.js'
import { BUNDLED_PLUGINS } from '../../../api/src/plugins/bundled.js'
import { pluginRuntimeFor } from '../../../api/src/plugins/pluginRuntime.js'
import { PluginService } from '../../../api/src/plugins/service/PluginService.js'
import { HOSTILE_PLUGIN_ID, hostileManifest } from '../../../api/src/testing/hostilePlugin.js'
import { TEST_ADMIN_DATABASE_URL, TEST_AUTH_SECRET, TEST_DATABASE_URL, migrateTestDatabase } from '../../../api/src/testing/harness.js'
import { Attacker } from './attacker.js'
import { ApiLog, BrowserLog, Recorder, sleep, snippet, type AttackResult, type Stopped } from './lib.js'
import { BLOCKED, type BlockSpec } from './specs.js'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '../..')
/**
 * `CHROMIUM_PATH` if set, else Playwright's own full Chromium (`channel: 'chromium'`), found through PLAYWRIGHT_BROWSERS_PATH
 * in a sandbox that ships one and in ~/.cache/ms-playwright after `playwright-core install chromium` in CI. Not the default
 * headless shell: the app's frame handshake never completes in it ("The host did not send init in time"), and the existing
 * `test:browser` check fails the same way, so the cause is the shell and not this suite.
 */
const CHROMIUM = process.env['CHROMIUM_PATH']
const ONLY = (process.env['ONLY'] ?? '').split(',').filter((s) => s !== '')
const wants = (phase: string): boolean => ONLY.length === 0 || ONLY.includes(phase)
const VICTIM_NAME = 'Neighbour'
type Json = Record<string, unknown>

const rec = new Recorder()
const timings: Record<string, number> = {}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function buildFixture(outDir: string): Promise<void> {
  const { build } = await import('vite')
  const { federation } = await import('@module-federation/vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    root: join(here, 'fixture'), configFile: false, logLevel: 'error',
    plugins: [
      react(),
      federation({
        name: 'acme_hostile', filename: 'remoteEntry.js', dts: false,
        exposes: { './Hostile': join(here, 'fixture/Hostile.tsx'), './Victim': join(here, 'fixture/Victim.tsx'), './Page': join(here, 'fixture/Page.tsx') },
        shared: { react: { singleton: true, requiredVersion: '^19.0.0' }, 'react-dom': { singleton: true, requiredVersion: '^19.0.0' } },
      }),
    ],
    build: { rollupOptions: { input: join(here, 'fixture/index.ts') }, outDir, emptyOutDir: true, target: 'esnext', modulePreload: false, cssCodeSplit: false },
  })
}

async function startServer(dist: string, apiLog: ApiLog) {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET, AUTH_ACCESS_TTL_SECONDS: '900',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000', LOG_LEVEL: 'silent', WEB_DIST_DIR: dist,
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const manifest = hostileManifest([{ module: './Hostile', title: 'Attack' }, { module: './Victim', title: VICTIM_NAME }], true)
  const bundled = [...BUNDLED_PLUGINS.filter((m) => pluginRuntimeFor(m, true) === 'in-realm'), manifest]
  const app = buildApp({ db, config, pluginOptions: { bundled } })
  apiLog.install(app)
  await app.ready()
  await new PluginService(new KyselyUnitOfWork(db), { bundled }).seedBundled()
  await app.listen({ port: 0, host: 'localhost' })
  const port = (app.server.address() as AddressInfo).port
  return { app, db, base: `http://localhost:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

async function register(base: string): Promise<{ email: string; refresh: string; access: string }> {
  const email = `hostile-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const res = await fetch(`${base}/api/v1/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }) })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  const body = await res.json() as { accessToken?: string }
  return { email, refresh: cookie.split(';')[0]!.split('=')[1]!, access: body.accessToken ?? '' }
}

async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 8000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
  await page.waitForSelector('.wiz', { state: 'detached', timeout: 8000 }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// The world the phases share
// ---------------------------------------------------------------------------

interface World {
  readonly base: string
  readonly attacker: Attacker
  readonly apiLog: ApiLog
  readonly log: BrowserLog
  readonly ctx: Playwright.BrowserContext
  readonly user: { email: string; refresh: string; access: string }
  readonly admin: ReturnType<typeof createDb>
  readonly frameDocs: Array<{ url: string; status: number; csp: string | undefined; cache: string | undefined; referrerPolicy: string | undefined; originAgentCluster: string | undefined }>
  page: Playwright.Page
  hostile: Playwright.Frame
  victim: Playwright.Frame | null
}

const isFrame = (f: Playwright.Frame, module: string, kind = 'widget'): boolean => f.url().includes('/plugin-frame') && f.url().includes(`module=.%2F${module}`) && f.url().includes(`kind=${kind}`)

/** Loads the dashboard (a hostile widget and a neighbour) or the hostile page, and points the fixture at the attacker. */
async function boot(w: World, where: 'dashboard' | 'page' = 'dashboard'): Promise<void> {
  if (w.page !== undefined && !w.page.isClosed()) await w.page.close().catch(() => undefined)
  w.page = await w.ctx.newPage()
  w.page.on('response', (r) => {
    if (new URL(r.url()).pathname === '/plugin-frame') w.frameDocs.push({ url: r.url(), status: r.status(), csp: r.headers()['content-security-policy'], cache: r.headers()['cache-control'], referrerPolicy: r.headers()['referrer-policy'], originAgentCluster: r.headers()['origin-agent-cluster'] })
  })
  if (where === 'dashboard') {
    await w.page.goto(`${w.base}/`)
    await dismissWizard(w.page)
    await w.page.waitForFunction(() => document.querySelectorAll('iframe[title^="Hostile"]').length === 2, null, { timeout: 30_000 })
    await w.page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>('iframe[title^="Hostile"]')].every((f) => f.style.visibility === 'visible'), null, { timeout: 30_000 })
    w.hostile = w.page.frames().find((f) => isFrame(f, 'Hostile'))!
    w.victim = w.page.frames().find((f) => isFrame(f, 'Victim')) ?? null
  } else {
    await w.page.goto(`${w.base}/p/${HOSTILE_PLUGIN_ID}/report`)
    await dismissWizard(w.page)
    await w.page.waitForSelector('iframe[title^="Hostile"]', { timeout: 30_000 })
    w.hostile = w.page.frames().find((f) => isFrame(f, 'Page', 'page'))!
    w.victim = null
  }
  await w.hostile.waitForFunction(() => (window as unknown as { __hostile?: unknown }).__hostile !== undefined, null, { timeout: 30_000 }).catch(async (e: unknown) => {
    // A frame that never ran the fixture is worth a description in a CI log: what it is, and what the browser said.
    const state = await w.hostile.evaluate(() => ({ href: location.href.slice(0, 120), body: document.body?.innerText.slice(0, 200), scripts: [...document.scripts].map((s) => s.src) })).catch((x: unknown) => String(x))
    console.error('hostile frame never mounted:', JSON.stringify(state), '\nconsole:', JSON.stringify(w.log.console.slice(-15)), '\nfailed:', JSON.stringify(w.log.requestUrls.filter((u) => u.url.includes('/plugins/')).slice(-10).map((u) => u.url)))
    throw e
  })
  await w.hostile.evaluate((cfg) => { (window as unknown as { __hostile: { configure(c: unknown): void } }).__hostile.configure(cfg) },
    { attacker: w.attacker.origin, host: w.base, udpPort: w.attacker.udpPort })
}

const call = <T = Json>(w: World, name: string, ...args: unknown[]): Promise<T> =>
  w.hostile.evaluate(([n, a]) => (window as unknown as { __hostile: Record<string, (...x: unknown[]) => unknown> }).__hostile[n as string]!(...(a as unknown[])), [name, args] as const) as Promise<T>

/** True when the hostile frame is still the document it started as. */
const intact = async (w: World): Promise<boolean> =>
  w.hostile.evaluate(() => (window as unknown as { __hostile?: unknown }).__hostile !== undefined && location.pathname === '/plugin-frame').catch(() => false)

const hostHeader = (e: { headers: Record<string, string> }, name: string): string | undefined => e.headers[name]
const code = (reply: unknown): string => {
  const r = reply as Json | undefined
  if (r === undefined) return 'none'
  if (r['silence'] === true) return 'silence'
  if (r['threw'] === true) return `threw:${String(r['name'])}`
  if (r['ok'] === true) return 'ok'
  const e = r['error'] as Json | undefined
  return e !== undefined ? String(e['code']) : String(r['type'] ?? 'other')
}
const claims = (jwt: string): Json => { try { return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Json } catch { return {} } }

function add(r: Omit<AttackResult, 'detail'> & { detail?: unknown }): void { rec.attack(r as AttackResult) }

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function phaseSetup(w: World): Promise<void> {
  const frames = w.page.frames().filter((f) => f.url().includes('/plugin-frame'))
  rec.check('the dashboard renders one frame per widget of the hostile plugin', frames.length === 2, frames.map((f) => f.url().slice(0, 80)))
  const sandboxes = await w.page.locator('iframe[title^="Hostile"]').evaluateAll((els) => els.map((e) => ({ sandbox: e.getAttribute('sandbox'), allow: e.getAttribute('allow'), srcdoc: e.getAttribute('srcdoc'), referrerpolicy: e.getAttribute('referrerpolicy') })))
  rec.check('sandbox attribute is exactly "allow-scripts" on every frame, with no allow= and no srcdoc', sandboxes.every((s) => s.sandbox === 'allow-scripts' && s.allow === null && s.srcdoc === null), sandboxes)
  rec.check('never allow-same-origin together with allow-scripts (attribute)', sandboxes.every((s) => !/allow-same-origin/.test(s.sandbox ?? '')), sandboxes)
  const doc = w.frameDocs[0]
  const csp = doc?.csp ?? ''
  rec.check('frame document: 200, no-cache, and a CSP that is itself sandbox allow-scripts (header sandbox)', doc?.status === 200 && doc.cache === 'no-cache' && /^sandbox allow-scripts;/.test(csp), doc)
  rec.check('frame CSP never contains allow-same-origin', !/allow-same-origin/.test(csp), csp)
  for (const d of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"]) rec.check(`frame CSP has ${d}`, csp.includes(d), csp)
  rec.check('the frame is opaque: its origin is "null"', (await w.hostile.evaluate(() => self.origin)) === 'null')
  // A sandboxed document cannot be origin-keyed, so Chromium logs "could not be origin-keyed" for each one whose response
  // sends `Origin-Agent-Cluster: ?1`. Helmet's default did, on every response (see the note beside the helmet registration).
  rec.check('no frame document asks for an origin-keyed agent cluster', w.frameDocs.length > 0 && w.frameDocs.every((d) => d.originAgentCluster === undefined), w.frameDocs.map((d) => d.originAgentCluster))
  const agentWarnings = w.log.console.filter((c) => /agent cluster|origin-keyed/i.test(c.text))
  rec.check('the console has no agent-cluster warning after the dashboard and its frames load', agentWarnings.length === 0, agentWarnings.map((c) => c.text.slice(0, 160)))
}

async function phaseCredentials(w: World): Promise<void> {
  // One honest, granted read, so the host has minted a plugin token and both tokens have crossed the wire.
  const control = await call<Json[]>(w, 'sdk', [{ method: 'get', path: '/core/transactions/monthly-summary?months=1&hx=control' }])
  rec.check('control: a granted read through the broker works', control[0]?.['ok'] === true, control)
  await sleep(400)
  const mint = w.log.requestUrls.find((r) => r.url.endsWith(`/api/v1/plugins/${HOSTILE_PLUGIN_ID}/token`))
  const read = w.log.requestUrls.find((r) => r.url.includes('hx=control'))
  await sleep(300)
  const hostToken = (hostHeader(mint ?? { headers: {} }, 'authorization') ?? '').replace(/^Bearer /, '')
  const pluginToken = (hostHeader(read ?? { headers: {} }, 'authorization') ?? '').replace(/^Bearer /, '')
  rec.check('control: the host token and the plugin token were both observed on the wire', hostToken.length > 40 && pluginToken.length > 40 && hostToken !== pluginToken, { host: hostToken.length, plugin: pluginToken.length })
  const out = await call(w, 'reachForCredentials', [hostToken, pluginToken, w.user.refresh, w.user.access])
  const blocked = (k: string): boolean => String(out[k]).startsWith('blocked')
  add({ id: 'cred-cookie', group: 'credentials', title: 'read document.cookie', expected: 'browser-block', reason: String(out['cookie']), pass: blocked('cookie') })
  add({ id: 'cred-storage', group: 'credentials', title: 'localStorage / sessionStorage / IndexedDB / Cache Storage / service worker', expected: 'browser-block', reason: [out['localStorage'], out['sessionStorage'], out['indexedDB'], out['cacheStorage']].map((x) => String(x).slice(0, 60)).join(' | '), pass: ['localStorage', 'localStorageWrite', 'sessionStorage', 'indexedDB', 'cacheStorage', 'serviceWorker'].every(blocked), detail: out })
  add({ id: 'cred-parent', group: 'credentials', title: 'window.parent / window.top: document, cookie, localStorage, fetch, host module variables, location', expected: 'browser-block', reason: String(out['parentDocument']).slice(0, 90), pass: ['parentDocument', 'parentCookie', 'parentLocalStorage', 'parentFetch', 'topHref'].every(blocked) && String(out['parentModuleVar']).startsWith('blocked'), detail: out })
  add({ id: 'cred-enumerate', group: 'credentials', title: 'search everything the frame can reach for the host token, the refresh cookie and any JWT', expected: 'contained', reason: `JWT-shaped strings ${String(out['jwtShapedStrings'])}, secrets found ${String(out['secretsFound'])}, Authorization headers seen by wrapped fetch ${String(out['authHeadersSeenByWrappedFetch'])}`, pass: out['jwtShapedStrings'] === 0 && out['secretsFound'] === 0 && out['authHeadersSeenByWrappedFetch'] === 0, detail: out })
  rec.check('the frame has no opener, no referrer and no window name to carry anything in', out['openerIsNull'] === true && out['referrer'] === '' && out['windowName'] === '', { opener: out['openerIsNull'], referrer: out['referrer'], name: out['windowName'] })
  rec.check('the frame URL fragment carries only the frame coordinates, never a token', !/eyJ|token|access|refresh/i.test(String(out['hash'])), out['hash'])
  rec.check('ctx exposes no token, credential, cookie or auth member', !JSON.stringify([out['ctxKeys'], out['apiKeys']]).match(/token|auth|cred|cookie|header/i), [out['ctxKeys'], out['apiKeys']])
}

async function phaseBlocked(w: World): Promise<void> {
  for (const spec of BLOCKED) {
    if (!(await intact(w))) await boot(w)
    const apiMark = w.apiLog.mark
    const logMark = w.log.mark
    const hitsBefore = w.attacker.hits.length
    const pagesBefore = w.ctx.pages().length
    const urlBefore = w.page.url()
    const result = await call(w, spec.call).catch((e: unknown) => ({ evaluateFailed: String(e).slice(0, 160) } as Json))
    await sleep(150)
    verdictFor(w, spec, result, { apiMark, logMark, hitsBefore, pagesBefore, urlBefore })
  }
}

function verdictFor(w: World, spec: BlockSpec, result: Json, before: { apiMark: number; logMark: number; hitsBefore: number; pagesBefore: number; urlBefore: string }): void {
  const attackerHits = (spec.attacker ?? []).flatMap((id) => w.attacker.hitsFor(id))
  const apiHits = (spec.host ?? []).flatMap((id) => w.apiLog.withMarker(id, before.apiMark))
  const console_ = w.log.consoleSince(before.logMark).map((c) => `${c.type}: ${c.text}`).join('\n')
  const haystack = `${JSON.stringify(result)}\n${console_}`
  const matched = snippet(haystack, spec.reason)
  const newPages = w.ctx.pages().length - before.pagesBefore
  const topMoved = w.page.url() !== before.urlBefore
  const anonymous = spec.anonymousOnly === true
  const leaked = attackerHits.length > 0 || (anonymous ? apiHits.some((h) => h.auth !== 'none' || h.hasCookie || (h.status ?? 0) < 400) : apiHits.length > 0)
  const problems: string[] = []
  if (leaked) problems.push(`REACHED: attacker ${attackerHits.length}, api ${apiHits.length}`)
  const via = anonymous && apiHits.length > 0 ? ` (reached the app anonymously: ${apiHits.map((h) => `${h.status ?? '?'}`).join(',')})` : ''
  if (matched === '') problems.push('no browser-stated reason matched')
  if (spec.noNewPages === true && newPages > 0) problems.push(`${newPages} new window(s)`)
  if (topMoved) problems.push('the host page moved')
  add({
    id: spec.id, group: spec.group, title: spec.title, expected: anonymous ? 'server-refusal' : 'browser-block', pass: problems.length === 0,
    reason: (matched === '' ? 'none' : matched.slice(0, 140)) + via,
    detail: { problems, result, attackerHits: attackerHits.map((h) => h.url), apiHits: apiHits.map((h) => `${h.method} ${h.path} auth=${h.auth} cookie=${String(h.hasCookie)} -> ${h.status ?? ''}`), console: console_.slice(0, 500) },
  })
}


// ---------------------------------------------------------------------------
// The broker: what a plugin can ask the host to fetch for it
// ---------------------------------------------------------------------------

const ZERO = '00000000-0000-0000-0000-000000000000'
const REFUSAL = ['grant_denied']
const MALFORMED = ['invalid_request', 'grant_denied', 'silence']

interface BrokerCase { readonly id: string; readonly title: string; readonly method: string; readonly path: string; readonly body?: unknown; readonly codes: readonly string[] }

const BROKER_REFUSED: readonly BrokerCase[] = [
  { id: 'b-table', title: 'read a table the plugin was not granted (accounts)', method: 'GET', path: '/core/accounts/summary', codes: REFUSAL },
  { id: 'b-core-post', title: 'write to core (POST /core/transactions)', method: 'POST', path: '/core/transactions', body: { amount: '1.0000' }, codes: REFUSAL },
  { id: 'b-core-put', title: 'write to core (PUT)', method: 'PUT', path: `/core/transactions/${ZERO}`, body: {}, codes: REFUSAL },
  { id: 'b-core-delete', title: 'write to core (DELETE)', method: 'DELETE', path: `/core/transactions/${ZERO}`, codes: REFUSAL },
  { id: 'b-auth-refresh', title: 'POST /auth/refresh through the broker', method: 'POST', path: '/auth/refresh', body: {}, codes: REFUSAL },
  { id: 'b-auth-me', title: 'GET /auth/me', method: 'GET', path: '/auth/me', codes: REFUSAL },
  { id: 'b-auth-login', title: 'POST /auth/login', method: 'POST', path: '/auth/login', body: { email: 'a@b.c', password: 'x' }, codes: REFUSAL },
  { id: 'b-auth-register', title: 'POST /auth/register', method: 'POST', path: '/auth/register', body: { email: 'new@b.c', password: 'correct-horse-battery-staple' }, codes: REFUSAL },
  { id: 'b-auth-password', title: 'POST /auth/change-password', method: 'POST', path: '/auth/change-password', body: { currentPassword: 'x', newPassword: 'y' }, codes: REFUSAL },
  { id: 'b-export', title: 'GET /settings/export', method: 'GET', path: '/settings/export', codes: REFUSAL },
  { id: 'b-config', title: 'GET /settings/config', method: 'GET', path: '/settings/config', codes: REFUSAL },
  { id: 'b-erase-my-data', title: 'POST /settings/erase-my-data with a password and the phrase', method: 'POST', path: '/settings/erase-my-data', body: { password: 'correct-horse-battery-staple', phrase: 'erase my data' }, codes: REFUSAL },
  { id: 'b-erase-instance', title: 'POST /settings/erase-instance', method: 'POST', path: '/settings/erase-instance', body: { password: 'correct-horse-battery-staple', phrase: 'erase everything' }, codes: REFUSAL },
  { id: 'b-plugins-list', title: 'listRegisteredPlugins (GET /plugins)', method: 'GET', path: '/plugins', codes: REFUSAL },
  { id: 'b-plugins-registry', title: 'GET /plugins/registry', method: 'GET', path: '/plugins/registry', codes: REFUSAL },
  { id: 'b-plugin-disable-post', title: 'setPluginEnabled spelled as a POST', method: 'POST', path: `/plugins/${HOSTILE_PLUGIN_ID}`, body: { enabled: false }, codes: REFUSAL },
  { id: 'b-plugin-disable-patch', title: 'setPluginEnabled as PATCH (a method the protocol does not carry)', method: 'PATCH', path: `/plugins/${HOSTILE_PLUGIN_ID}`, body: { enabled: false }, codes: ['invalid_request', 'silence'] },
  { id: 'b-mint-self', title: 'mint a token for itself', method: 'POST', path: `/plugins/${HOSTILE_PLUGIN_ID}/token`, body: {}, codes: REFUSAL },
  { id: 'b-mint-other', title: 'mint a token for another plugin', method: 'POST', path: '/plugins/wickermoney.budgets/token', body: {}, codes: REFUSAL },
  { id: 'b-users', title: 'GET /users (owner role management)', method: 'GET', path: '/users', codes: REFUSAL },
  { id: 'b-role', title: 'make itself an owner (PUT /users/:id/role)', method: 'PUT', path: `/users/${ZERO}/role`, body: { role: 'owner' }, codes: REFUSAL },
  { id: 'b-other-plugin-get', title: "another plugin's /p/ route (GET)", method: 'GET', path: '/p/wickermoney.budgets/anything', codes: REFUSAL },
  { id: 'b-other-plugin-post', title: "another plugin's /p/ route (POST)", method: 'POST', path: '/p/wickermoney.budgets/anything', body: {}, codes: REFUSAL },
  { id: 'b-prefix-collision', title: "a namespace that merely starts with its own id (/p/acme.hostile.evil)", method: 'GET', path: `/p/${HOSTILE_PLUGIN_ID}.evil/x`, codes: REFUSAL },
  { id: 'b-bare-namespace', title: 'the bare /p/<id> with no trailing path', method: 'GET', path: `/p/${HOSTILE_PLUGIN_ID}`, codes: [...REFUSAL, 'not_found'] },
  { id: 'b-accounts', title: 'host screen: GET /accounts', method: 'GET', path: '/accounts', codes: REFUSAL },
  { id: 'b-transactions', title: 'host screen: GET /transactions', method: 'GET', path: '/transactions', codes: REFUSAL },
  { id: 'b-categories', title: 'host screen: GET /categories', method: 'GET', path: '/categories', codes: REFUSAL },
  { id: 'b-onboarding', title: 'host screen: POST /onboarding/reset', method: 'POST', path: '/onboarding/reset', body: {}, codes: REFUSAL },
  // Paths that are not plain paths at all.
  { id: 'b-dotdot', title: '/core/../auth/me', method: 'GET', path: '/core/../auth/me', codes: MALFORMED },
  { id: 'b-dotdot-encoded', title: '/core/%2e%2e/auth/me', method: 'GET', path: '/core/%2e%2e/auth/me', codes: MALFORMED },
  { id: 'b-dotdot-own', title: `/p/${HOSTILE_PLUGIN_ID}/../../auth/me`, method: 'GET', path: `/p/${HOSTILE_PLUGIN_ID}/../../auth/me`, codes: MALFORMED },
  { id: 'b-dotdot-own-encoded', title: `/p/${HOSTILE_PLUGIN_ID}/%2e%2e/%2e%2e/auth/me`, method: 'GET', path: `/p/${HOSTILE_PLUGIN_ID}/%2e%2e/%2e%2e/auth/me`, codes: MALFORMED },
  { id: 'b-slash-encoded', title: `/p/${HOSTILE_PLUGIN_ID}%2f..%2f..%2fauth/me`, method: 'GET', path: `/p/${HOSTILE_PLUGIN_ID}%2f..%2f..%2fauth/me`, codes: MALFORMED },
  { id: 'b-protocol-relative', title: '//attacker.test/x', method: 'GET', path: '//attacker.test/x', codes: MALFORMED },
  { id: 'b-absolute', title: 'https://attacker.test/x', method: 'GET', path: 'https://attacker.test/x', codes: MALFORMED },
  { id: 'b-backslash', title: '/\\attacker.test/x', method: 'GET', path: '/\\attacker.test/x', codes: MALFORMED },
  { id: 'b-backslash-two', title: '\\\\attacker.test/x', method: 'GET', path: '\\\\attacker.test/x', codes: MALFORMED },
  { id: 'b-scheme', title: 'javascript:1', method: 'GET', path: 'javascript:1', codes: MALFORMED },
  { id: 'b-crlf', title: 'CR LF in the path (header injection)', method: 'GET', path: '/core/transactions/monthly-summary\r\nX-Injected: 1', codes: MALFORMED },
  { id: 'b-nul', title: 'NUL in the path', method: 'GET', path: '/core/transactions/monthly-summary\u0000/../x', codes: MALFORMED },
  { id: 'b-long-path', title: 'a 3000 character path', method: 'GET', path: `/core/transactions/${'a'.repeat(3000)}`, codes: MALFORMED },
]

const withMarker = (path: string, id: string): string => `${path}${path.includes('?') ? '&' : '?'}hx=${id}`

async function phaseBroker(w: World): Promise<void> {
  await boot(w)
  // A. Through the SDK client the plugin ships with: controls and the one refusal it makes itself.
  const sdk = await call<Json[]>(w, 'sdk', [
    { method: 'get', path: '/core/transactions/monthly-summary?months=1&hx=sdk-granted' },
    { method: 'get', path: '/core/accounts/summary?hx=sdk-ungranted' },
    { method: 'get', path: '/core/../auth/me?hx=sdk-dotdot' },
  ])
  rec.check('control (SDK): a granted read is answered', sdk[0]?.['ok'] === true, sdk[0])
  add({ id: 'sdk-ungranted', group: 'broker', title: 'SDK client: read an ungranted table', expected: 'broker-refusal', reason: `${code(sdk[1])} (${String(sdk[1]?.['message']).slice(0, 80)})`, pass: sdk[1]?.['code'] === 'grant_denied' && w.apiLog.withMarker('sdk-ungranted').length === 0, detail: sdk[1] })
  add({ id: 'sdk-dotdot', group: 'broker', title: 'SDK client: ../ in a path', expected: 'broker-refusal', reason: `${code(sdk[2])}`, pass: sdk[2]?.['code'] === 'invalid_request' && w.apiLog.withMarker('sdk-dotdot').length === 0, detail: sdk[2] })

  // B. Straight at the broker over a raw port, so the SDK's own checks are out of the way.
  const taken = await call(w, 'takePort')
  rec.check('control: the hostile frame holds a raw port to the broker', taken['port'] === true, taken)
  const apiMark = w.apiLog.mark
  const replies = await call<Array<{ sent: Json; reply: unknown }>>(w, 'raw', BROKER_REFUSED.map((c) => ({ method: c.method, path: withMarker(c.path, c.id), ...(c.body !== undefined ? { body: c.body } : {}) })), 60)
  for (const [i, c] of BROKER_REFUSED.entries()) {
    const got = code(replies[i]?.reply)
    const reached = w.apiLog.withMarker(c.id, apiMark)
    const attackerHit = w.attacker.hitsFor(c.id)
    const ok = c.codes.includes(got) && reached.length === 0 && attackerHit.length === 0
    add({
      id: c.id, group: 'broker', title: c.title, expected: 'broker-refusal',
      reason: got === 'silence' ? 'dropped as a malformed message, no reply' : `broker replied ${got}`,
      pass: ok, detail: { got, allowed: c.codes, reachedApi: reached.map((e) => `${e.method} ${e.path} -> ${e.status ?? ''}`), reply: replies[i]?.reply },
    })
  }

  // C. What a request that does go through looks like on the wire, and what a plugin cannot add to it.
  const forged = await call<Array<{ sent: Json; reply: unknown }>>(w, 'raw', [{
    method: 'GET', path: withMarker('/core/transactions/monthly-summary?months=1', 'forge'), cache: 'no-store',
    extra: { headers: { authorization: 'Bearer forged.forged.forged', 'x-wickermoney-plugin': 'wickermoney.budgets', 'x-forged': '1', cookie: 'wickermoney_refresh=x' }, credentials: 'include', mode: 'cors', pluginId: 'wickermoney.budgets', plg: 'wickermoney.budgets', token: 'forged', url: `${w.attacker.origin}/forge?hx=forge-url` },
  }], 0)
  await sleep(300)
  const onWire = w.log.requestUrls.find((r) => r.url.includes('hx=forge'))
  const auth = hostHeader(onWire ?? { headers: {} }, 'authorization') ?? ''
  const c = claims(auth.replace(/^Bearer /, ''))
  const logged = w.apiLog.withMarker('forge')[0]
  add({
    id: 'forged-identity', group: 'broker', title: 'extra fields on a request (headers, credentials, plugin id, token, url) cannot change who the request is from',
    expected: 'contained', reason: `request went out as plg=${String(c['plg'])} aud=${String(c['aud'])}; API saw auth=${logged?.auth ?? 'none'} plugin=${logged?.pluginId ?? ''}`,
    pass: code(forged[0]?.reply) === 'ok' && c['plg'] === HOSTILE_PLUGIN_ID && String(c['aud']).endsWith(':plugin') && hostHeader(onWire ?? { headers: {} }, 'x-forged') === undefined
      && hostHeader(onWire ?? { headers: {} }, 'cookie') === undefined && auth !== 'Bearer forged.forged.forged' && hostHeader(onWire ?? { headers: {} }, 'x-wickermoney-plugin') !== 'wickermoney.budgets'
      && logged?.auth === 'plugin' && logged.pluginId === HOSTILE_PLUGIN_ID && logged.status === 200 && w.attacker.hitsFor('forge-url').length === 0,
    detail: { onWire: onWire === undefined ? null : { ...onWire.headers, authorization: auth.slice(0, 20) + '…' }, logged },
  })
  const own = await call<Array<{ sent: Json; reply: unknown }>>(w, 'raw', [{ method: 'GET', path: withMarker(`/p/${HOSTILE_PLUGIN_ID}/ping`, 'own-namespace') }], 0)
  const ownLogged = w.apiLog.withMarker('own-namespace')[0]
  rec.check("control: the plugin's own /p/ namespace reaches the server as that plugin (and gets 404: nothing is mounted)", ownLogged?.auth === 'plugin' && ownLogged.pluginId === HOSTILE_PLUGIN_ID && ownLogged.status === 404, { reply: own[0]?.reply, ownLogged })
}

async function phaseMalformed(w: World): Promise<void> {
  await boot(w)
  await call(w, 'takePort')
  const apiMark = w.apiLog.mark
  const logMark = w.log.mark
  const odd = await call<Array<{ label: string; reply: unknown }>>(w, 'rawOddities')
  for (const o of odd) console.log(`        odd: ${o.label.padEnd(40)} -> ${JSON.stringify(o.reply).slice(0, 110)}`)
  const hits = w.apiLog.since(apiMark).filter((e) => e.auth === 'plugin')
  const mischief = hits.filter((e) => /\/p\/acme\.hostile\/x|accounts|auth|settings|plugins|users/.test(e.path))
  add({ id: 'odd-messages', group: 'messages', title: `${odd.length} malformed, mistyped, oversized and non-cloneable messages on the raw port`, expected: 'broker-refusal', reason: `${hits.length} reached the API as the plugin, none to a route outside its grants`, pass: mischief.length === 0, detail: { hits: hits.map((e) => `${e.method} ${e.url}`), mischief: mischief.map((e) => e.url) } })
  const alive = await call<boolean>(w, 'portAlive')
  const responsive = await Promise.race([w.page.evaluate(() => 1), sleep(3000).then(() => 0)])
  const errors = w.log.consoleSince(logMark).filter((c) => c.type === 'pageerror')
  add({ id: 'odd-survive', group: 'messages', title: 'after all of them: the host has no uncaught error, still answers, and the broker still serves a valid request', expected: 'contained', reason: `port alive ${String(alive)}, host responsive ${String(responsive === 1)}, uncaught errors ${errors.length}`, pass: alive && responsive === 1 && errors.length === 0, detail: errors })
  // Size: over the body cap, then far over it.
  const sizes = await call<Array<{ sent: Json; reply: unknown }>>(w, 'raw', [
    { method: 'POST', path: withMarker(`/p/${HOSTILE_PLUGIN_ID}/big`, 'big-300k'), body: { blob: 'x'.repeat(300_000) } },
    { method: 'POST', path: withMarker(`/p/${HOSTILE_PLUGIN_ID}/big`, 'big-5m'), body: { blob: 'x'.repeat(5_000_000) } },
    { method: 'GET', path: withMarker(`/core/transactions/${'a'.repeat(100_000)}`, 'long-100k') },
  ], 100)
  for (const [i, id] of ['big-300k', 'big-5m', 'long-100k'].entries()) {
    const got = code(sizes[i]?.reply)
    add({ id, group: 'messages', title: id === 'big-300k' ? 'request body over the 256 KiB cap' : id === 'big-5m' ? 'a 5 MB request body' : 'a 100 000 character path', expected: 'broker-refusal', reason: got === 'silence' ? 'dropped, no reply' : `broker replied ${got}`, pass: got !== 'ok' && w.apiLog.withMarker(id, apiMark).length === 0, detail: sizes[i]?.reply })
  }
}

async function phaseFlood(w: World): Promise<void> {
  await boot(w)
  await call(w, 'takePort')
  const apiMark = w.apiLog.mark
  const t0 = Date.now()
  const flood = await call(w, 'flood', 400)
  const reached = w.apiLog.since(apiMark).filter((e) => e.url.includes('flood='))
  const responsiveMs = await (async () => { const s = Date.now(); await w.page.evaluate(() => 1); return Date.now() - s })()
  const victim = w.victim === null ? null : await w.victim.evaluate(() => (window as unknown as { __victim: { info(): Promise<Json> } }).__victim.info())
  add({
    id: 'flood-valid', group: 'flood', title: '400 valid reads in a burst', expected: 'broker-refusal',
    reason: `${reached.length} reached the API in ${Date.now() - t0} ms; replies ${JSON.stringify(flood['codes'])}`,
    pass: reached.length <= 150 && reached.length < 400 && responsiveMs < 1500 && victim?.['read'] === 'ok', detail: { flood, reached: reached.length, responsiveMs, victim },
  })
  // Faster than the sustained rate but slower than the burst that kills the connection: the limiter itself.
  await boot(w)
  await call(w, 'takePort')
  const pacedMark = w.apiLog.mark
  const paced = await call(w, 'paced', 150, 20)
  const pacedReached = w.apiLog.since(pacedMark).filter((e) => e.url.includes('paced='))
  const seconds = Number(paced['sentMs']) / 1000
  const allowance = Math.ceil(40 + 20 * seconds + 12)
  add({
    id: 'flood-paced', group: 'flood', title: '150 valid reads at ~50 per second (limit: burst 40, then 20 per second)', expected: 'broker-refusal',
    reason: `${pacedReached.length} reached the API (allowance ${allowance}); replies ${JSON.stringify(paced['codes'])}`,
    pass: pacedReached.length > 0 && pacedReached.length <= allowance && Object.keys(paced['codes'] as Json).some((k) => k.endsWith(':429')), detail: { paced, reached: pacedReached.length, allowance },
  })
  // Strikes: malformed known-type messages end the connection (maxStrikes per window).
  await boot(w)
  await call(w, 'takePort')
  await w.hostile.evaluate(() => {
    const h = (window as unknown as { __hostile: { port: MessagePort | null } }).__hostile
    for (let i = 0; i < 160; i++) h.port?.postMessage({ type: 'request', id: 'bad', method: 'GET' })
  })
  await sleep(800)
  const dead = !(await call<boolean>(w, 'portAlive'))
  const hellos = await call(w, 'helloFlood', 30)
  const victim2 = w.victim === null ? null : await w.victim.evaluate(() => (window as unknown as { __victim: { info(): Promise<Json> } }).__victim.info())
  add({ id: 'strikes-fatal', group: 'flood', title: '160 malformed requests in a row', expected: 'broker-refusal', reason: dead ? 'the broker ended the connection' : 'the port still answers', pass: dead, detail: { dead } })
  add({ id: 'hello-flood', group: 'flood', title: '30 handshakes (wm.hello) in a row, claiming to be another plugin', expected: 'broker-refusal', reason: `${String(hellos['connects'])} of 30 were answered with a port`, pass: Number(hellos['connects']) <= 10 && victim2?.['read'] === 'ok', detail: { hellos, victim2 } })
}

async function phaseSpoof(w: World): Promise<void> {
  await boot(w)
  await sleep(4500)
  const victim = await w.victim!.evaluate(() => (window as unknown as { __victim: { info(): Promise<Json> } }).__victim.info())
  const hostBg = await w.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
  add({
    id: 'spoof-sibling', group: 'spoofing', title: 'forged wm.connect / init / theme / response / wm.refuse sent to a neighbouring frame, as fast as a timer allows, for 4 s',
    expected: 'contained', reason: `the neighbour received ${String(victim['forgedConnectsReceived'])} forged connects and kept its real session, theme and data`,
    pass: Number(victim['forgedConnectsReceived']) > 0 && victim['email'] === w.user.email && victim['bg'] === hostBg && victim['read'] === 'ok' && victim['size'] !== 'full',
    detail: { victim, hostBg },
  })
  const taken = await call(w, 'takePort')
  const init = (await w.hostile.evaluate(() => (window as unknown as { __hostile: { portInits: Json[] } }).__hostile.portInits))[0] as { pluginId?: string; session?: { email?: string } } | undefined
  add({ id: 'spoof-hello-identity', group: 'spoofing', title: 'a handshake that claims pluginId=wickermoney.budgets and a forged session', expected: 'contained', reason: `init says plugin ${String(init?.pluginId)}, session ${String(init?.session?.email)}`, pass: taken['port'] === true && init?.pluginId === HOSTILE_PLUGIN_ID && init.session?.email === w.user.email, detail: init })
}

async function phaseNavigation(w: World): Promise<void> {
  const attempts: Array<{ id: string; path: string }> = [
    { id: 'nav-protocol-relative', path: '//attacker.test/x?hx=nav-protocol-relative' },
    { id: 'nav-absolute', path: 'https://attacker.test/x?hx=nav-absolute' },
    { id: 'nav-backslash', path: '/\\attacker.test/x?hx=nav-backslash' },
    { id: 'nav-javascript', path: 'javascript:window.__navXss=1' },
    { id: 'nav-logout', path: '/api/v1/auth/logout?hx=nav-logout' },
    { id: 'nav-export', path: '/api/v1/settings/export?hx=nav-export' },
  ]
  const outcomes: string[] = []
  let bad = 0
  for (const a of attempts) {
    await boot(w, 'page')
    const apiMark = w.apiLog.mark
    const returned = await call(w, 'navOne', a.path)
    await sleep(500)
    const xss = await w.page.evaluate(() => (window as unknown as { __navXss?: unknown }).__navXss)
    const reachedAttacker = w.attacker.hitsFor(a.id).length
    const reachedApi = w.apiLog.since(apiMark).filter((e) => e.url.includes(`hx=${a.id}`)).length
    const sameOrigin = new URL(w.page.url()).origin === w.base
    const ok = reachedAttacker === 0 && reachedApi === 0 && xss === undefined && sameOrigin
    if (!ok) bad += 1
    outcomes.push(`${a.id}: stayed on ${new URL(w.page.url()).pathname}${returned['threw'] === true ? ' (the client refused)' : ''}`)
    add({ id: a.id, group: 'navigation', title: `ctx.navigate(${JSON.stringify(a.path.slice(0, 40))})`, expected: 'broker-refusal', reason: outcomes[outcomes.length - 1]!, pass: ok, detail: { returned, reachedAttacker, reachedApi, xss, url: w.page.url() } })
  }
  void bad
  await boot(w, 'page')
  const before = await w.page.evaluate(() => history.length)
  await call(w, 'navBurst', 40)
  await sleep(700)
  const grew = (await w.page.evaluate(() => history.length)) - before
  add({ id: 'navigate-burst', group: 'navigation', title: '40 ctx.navigate calls in one tick', expected: 'broker-refusal', reason: `${grew} took effect (the limiter allows a burst of 3)`, pass: grew <= 4, detail: { before, grew } })
}

/**
 * A plugin PAGE in a frame: the frame fills the content area and the host lets it be as tall as it asks (up to a limit), so
 * the new things to try are the page's own: how tall it can make itself, what it covers, and the messages that belong to
 * the host. (A page also gets every attack above: the navigation phase already runs against the page route.)
 */
async function phasePageFrame(w: World): Promise<void> {
  await boot(w, 'page')
  await call(w, 'takePort')
  const geometry = (): Promise<{ frameH: number; frameTop: number; frameLeft: number; frameBottom: number; mainBottom: number; navRight: number; docH: number; position: string; zIndex: string; atNavLink: string | null }> => w.page.evaluate(() => {
    const f = document.querySelector('iframe[title^="Hostile"]')!
    const r = f.getBoundingClientRect()
    const main = document.getElementById('main')!.getBoundingClientRect()
    const nav = document.querySelector('.shell__nav')!.getBoundingClientRect()
    const link = document.querySelector('.shell__nav a')!.getBoundingClientRect()
    const hit = document.elementFromPoint(link.left + link.width / 2, link.top + link.height / 2)
    const cs = getComputedStyle(f)
    return {
      frameH: Math.round(r.height), frameTop: Math.round(r.top + scrollY), frameLeft: Math.round(r.left), frameBottom: Math.round(r.bottom + scrollY), mainBottom: Math.round(main.bottom + scrollY), navRight: Math.round(nav.right),
      docH: document.documentElement.scrollHeight, position: cs.position, zIndex: cs.zIndex, atNavLink: hit === null ? null : (hit.closest('a')?.getAttribute('href') ?? hit.tagName),
    }
  })
  const before = await geometry()
  // Ask for the tallest height the protocol accepts, then one it refuses, then a frame that asks for nothing.
  const sent = await call<Array<{ sent: unknown; reply: unknown }>>(w, 'rawMessages', [
    { type: 'resize', height: 100_000 }, { type: 'resize', height: 1e12 }, { type: 'resize', height: -1 },
  ])
  await sleep(500)
  const tall = await geometry()
  const responsiveMs = await (async () => { const t = Date.now(); await w.page.evaluate(() => 1); return Date.now() - t })()
  add({
    id: 'page-height-max', group: 'page frame', title: 'a page frame asks for 100 000 px (the most the protocol accepts), then 1e12 and -1', expected: 'broker-refusal',
    reason: `the host set ${tall.frameH} px (limit 20 000); the frame is ${tall.frameBottom <= tall.mainBottom + 1 ? 'inside' : 'outside'} <main>; page still answers in ${responsiveMs} ms`,
    pass: tall.frameH === 20_000 && tall.frameBottom <= tall.mainBottom + 1 && responsiveMs < 1500, detail: { before, tall, sent },
  })
  add({
    id: 'page-covers-nothing', group: 'page frame', title: 'that 20 000 px frame, over the host\'s navigation', expected: 'contained',
    reason: `the frame starts ${tall.frameLeft} px from the left (navigation ends at ${tall.navRight}); position ${tall.position}; the first nav link is still the element at its own centre (${String(tall.atNavLink)})`,
    pass: tall.frameLeft >= tall.navRight && tall.position === 'static' && tall.atNavLink !== null && !String(tall.atNavLink).startsWith('IFRAME'), detail: tall,
  })
  // The frame covers its own document with a fixed, topmost element: that is inside the frame, not the host.
  await w.hostile.evaluate(() => { const d = document.createElement('div'); d.id = 'cover'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:red'; document.body.append(d) })
  await sleep(200)
  const covered = await w.page.evaluate(() => {
    const link = document.querySelector('.shell__nav a')!.getBoundingClientRect()
    const hit = document.elementFromPoint(link.left + link.width / 2, link.top + link.height / 2)
    const bar = document.querySelector('.shell__nav')!.getBoundingClientRect()
    return { hit: hit?.closest('a')?.getAttribute('href') ?? hit?.tagName, navLeft: Math.round(bar.left) }
  })
  add({ id: 'page-fixed-overlay', group: 'page frame', title: 'a fixed, full-size element with the highest z-index inside the page frame', expected: 'contained', reason: `the host's navigation still receives its own clicks (${String(covered.hit)})`, pass: covered.hit !== 'IFRAME' && covered.hit !== undefined && !String(covered.hit).startsWith('IFRAME'), detail: covered })
  // Messages that belong to the host: the page tells the host its path changed, or hands it a theme.
  await boot(w, 'page')
  await call(w, 'takePort')
  const url0 = w.page.url()
  const themeBefore = await w.page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const odd = await call<Array<{ sent: unknown; reply: unknown }>>(w, 'rawMessages', [
    { type: 'route', path: '/accounts?hx=page-route' }, { type: 'init', protocol: 1, pluginId: 'wickermoney.budgets', kind: 'page', path: '/accounts' },
    { type: 'theme', theme: { scheme: 'dark', tokens: { '--wm-bg': 'red' } } }, { type: 'focus-in', direction: 'first' }, { type: 'props', size: 'full' },
  ])
  await sleep(500)
  const url1 = w.page.url()
  const themeAfter = await w.page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const bgAfter = await w.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wm-bg').trim())
  add({
    id: 'page-host-messages', group: 'page frame', title: 'a page frame sends route, init, theme, focus-in and props (host-to-frame messages) to the host', expected: 'broker-refusal',
    reason: `the address stayed ${new URL(url1).pathname}; the host's theme stayed ${String(themeAfter)} and --wm-bg ${bgAfter}`,
    pass: url0 === url1 && themeBefore === themeAfter && bgAfter !== 'red' && w.apiLog.withMarker('page-route').length === 0, detail: { odd, url0, url1, themeBefore, themeAfter },
  })

  // The one message that moves the frame: `modal` (ADR 0015). A page that says it has a dialog open, with no dialog, and a
  // page that says it over and over. The lift may cover the content area the person is looking at and nothing else.
  const lift = (): Promise<{ position: string; left: number; top: number; right: number; bottom: number; navRight: number; barBottom: number; vw: number; vh: number; locked: boolean; lifted: number; atNavLink: string | null; atBar: string | null }> => w.page.evaluate(() => {
    const f = document.querySelector('iframe[title^="Hostile"]')!
    const r = f.getBoundingClientRect()
    const nav = document.querySelector('.shell__nav')!.getBoundingClientRect()
    const bar = document.querySelector('.shell__bar')?.getBoundingClientRect()
    const link = document.querySelector('.shell__nav a')!.getBoundingClientRect()
    const hit = document.elementFromPoint(link.left + link.width / 2, link.top + link.height / 2)
    const barHit = bar === undefined || bar.height === 0 ? null : document.elementFromPoint(bar.left + 10, bar.top + bar.height / 2)
    return {
      position: getComputedStyle(f).position, left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), navRight: Math.round(nav.right),
      barBottom: bar === undefined ? 0 : Math.round(bar.bottom), vw: innerWidth, vh: innerHeight, locked: document.documentElement.hasAttribute('data-wm-frame-modal'),
      lifted: document.querySelectorAll('[data-lifted]').length, atNavLink: hit === null ? null : (hit.closest('a')?.getAttribute('href') ?? hit.tagName),
      atBar: barHit === null ? null : (barHit.tagName === 'IFRAME' ? 'IFRAME' : 'host'),
    }
  })
  await boot(w, 'page')
  await call(w, 'takePort')
  await call(w, 'rawMessages', [{ type: 'modal', open: true }])
  await sleep(500)
  const lied = await lift()
  add({
    id: 'page-modal-lift-bounds', group: 'page frame', title: 'a page frame says a modal dialog is open when none is (modal, open: true)', expected: 'contained',
    reason: `the host lifts it over the content area only: from x ${lied.left} (navigation ends at ${lied.navRight}) to ${lied.right} of ${lied.vw}, y ${lied.top} to ${lied.bottom} of ${lied.vh}; the first nav link is still the element at its centre (${String(lied.atNavLink)})`,
    pass: lied.position === 'fixed' && lied.left >= lied.navRight && lied.right <= lied.vw && lied.top >= lied.barBottom && lied.bottom <= lied.vh && lied.atNavLink !== null && lied.atNavLink !== 'IFRAME' && lied.atBar !== 'IFRAME', detail: lied,
  })
  // The person can always leave: a click on the navigation goes through, and the lift and the scroll lock go with the page.
  await w.page.locator('.shell__nav a[href="/accounts"]').first().click()
  await w.page.waitForURL('**/accounts')
  await sleep(300)
  const left = await w.page.evaluate(() => ({ locked: document.documentElement.hasAttribute('data-wm-frame-modal'), lifted: document.querySelectorAll('[data-lifted]').length, frames: document.querySelectorAll('iframe[title^="Hostile"]').length }))
  add({
    id: 'page-modal-can-leave', group: 'page frame', title: 'the same lifted frame: the person clicks a link in the navigation', expected: 'contained',
    reason: `the navigation took the click (now ${new URL(w.page.url()).pathname}); scroll lock ${left.locked ? 'still set' : 'released'}, ${left.lifted} lifted, ${left.frames} hostile frames left`,
    pass: new URL(w.page.url()).pathname === '/accounts' && !left.locked && left.lifted === 0 && left.frames === 0, detail: left,
  })
  // Spam: the host answers open requests at a few a second and strikes the rest; closing is never limited.
  await boot(w, 'page')
  await call(w, 'takePort')
  await call(w, 'rawMessages', Array.from({ length: 40 }, (_, i) => ({ type: 'modal', open: i % 2 === 0 })))
  await call(w, 'rawMessages', [{ type: 'modal', open: false }]).catch(() => undefined)
  await sleep(500)
  const ms = await (async () => { const t = Date.now(); await w.page.evaluate(() => 1); return Date.now() - t })()
  const spam = await lift().catch(() => null)
  add({
    id: 'page-modal-spam', group: 'page frame', title: 'a page frame sends 40 modal messages, open and close alternately, then close', expected: 'broker-refusal',
    reason: `the host still answers in ${ms} ms; afterwards the frame is ${spam === null ? 'gone (the host struck it)' : spam.position === 'fixed' ? 'still lifted' : 'back in the page'}, scroll lock ${spam?.locked === true ? 'set' : 'released'}`,
    pass: ms < 1500 && (spam === null || (spam.position !== 'fixed' && !spam.locked && spam.lifted === 0)), detail: { ms, spam },
  })
  // A widget frame has nothing to lift: modal from a widget is ignored.
  await boot(w, 'dashboard')
  await call(w, 'takePort')
  const wmark = await w.page.evaluate(() => document.querySelector('iframe[title^="Hostile"]')!.getBoundingClientRect().toJSON())
  await call(w, 'rawMessages', [{ type: 'modal', open: true }])
  await sleep(500)
  const wafter = await w.page.evaluate(() => ({ r: document.querySelector('iframe[title^="Hostile"]')!.getBoundingClientRect().toJSON(), locked: document.documentElement.hasAttribute('data-wm-frame-modal'), lifted: document.querySelectorAll('[data-lifted]').length, pos: getComputedStyle(document.querySelector('iframe[title^="Hostile"]')!).position }))
  add({
    id: 'widget-modal-ignored', group: 'page frame', title: 'a widget frame sends modal, open: true', expected: 'broker-refusal',
    reason: `the widget stayed where it was (position ${wafter.pos}, ${wafter.lifted} lifted), scroll lock ${wafter.locked ? 'set' : 'not set'}`,
    pass: wafter.pos === 'static' && !wafter.locked && wafter.lifted === 0 && Math.abs(wafter.r.top - wmark.top) < 2, detail: { wmark, wafter },
  })
}

// ---------------------------------------------------------------------------
// Channels the content security policy does not govern (ADR 0005, "P3 spike results")
// ---------------------------------------------------------------------------

interface Channel { readonly id: string; readonly title: string; readonly call: string; readonly args?: unknown[]; readonly waitMs?: number }
const CHANNELS: readonly Channel[] = [
  { id: 'residual-prerender', title: '<link rel=prerender> with the session email in the URL', call: 'prerender' },
  { id: 'residual-prefetch', title: '<link rel=prefetch>', call: 'prefetch' },
  { id: 'residual-preload', title: '<link rel=preload as=fetch>', call: 'preload' },
  { id: 'residual-modulepreload', title: '<link rel=modulepreload>', call: 'modulePreload' },
  { id: 'residual-preconnect', title: '<link rel=preconnect> (opens a connection, sends no URL)', call: 'preconnect' },
  { id: 'residual-webrtc', title: 'WebRTC STUN binding request (UDP)', call: 'webRtc' },
  { id: 'residual-webrtc-turn', title: 'WebRTC TURN allocate with a username of the plugin\'s choosing (UDP)', call: 'webRtcTurn' },
  { id: 'residual-dns-prefetch', title: '<link rel=dns-prefetch> to a host name that spells the session email (judged from the net log after the run)', call: 'dnsPrefetch' },
  { id: 'residual-self-nav-host', title: 'the frame navigates itself to a URL on the app origin, carrying data in the query', call: 'selfNavHost' },
]

async function phaseResidual(w: World): Promise<void> {
  for (const ch of CHANNELS) {
    await boot(w)
    const before = { hits: w.attacker.hits.length, conns: w.attacker.connections.length, dgrams: w.attacker.datagrams.length, requests: w.attacker.connections.reduce((n, c) => n + c.requests, 0) }
    const out = await call(w, ch.call).catch(() => ({ navigated: true } as Json))
    await sleep(500)
    const hits = w.attacker.hits.slice(before.hits).filter((h) => h.id === ch.id)
    const conns = w.attacker.connections.length - before.conns
    const dgrams = w.attacker.datagrams.length - before.dgrams
    const withData = hits.filter((h) => decodeURIComponent(h.url).includes(w.user.email))
    const turnLeak = ch.id === 'residual-webrtc-turn' && w.attacker.datagrams.slice(before.dgrams).some((d) => d.payload.includes(w.user.email))
    const hostHits = ch.id === 'residual-self-nav-host' ? w.apiLog.withMarker('residual-self-nav-host') : []
    if (ch.id === 'residual-dns-prefetch') {
      dnsProbe = { email: w.user.email }
      // Positive control for the net log: an ordinary page, with no policy, looks up a name of the same shape.
      const control = await w.ctx.newPage()
      await control.goto(`${w.attacker.origin}/control`)
      await control.evaluate((o) => fetch(`http://hxcontrol-lookup.attacker.test:${o}/`, { mode: 'no-cors' }).catch(() => undefined), w.attacker.port)
      await sleep(800)
      await control.close()
       add({ id: ch.id, group: 'residual', title: ch.title, expected: 'residual', reason: 'judged after the browser closes, from its net log', pass: true }); continue }
    const observed = ch.id === 'residual-self-nav-host' ? (hostHits.length === 0 ? 'blocked' : hostHits.every((h) => h.auth === 'none' && !h.hasCookie) ? 'reaches the app anonymously' : 'reaches the app with credentials')
      : turnLeak ? 'leaks data' : hits.length > 0 ? (withData.length > 0 ? 'leaks data' : 'reaches the origin') : dgrams > 0 ? 'sends UDP' : conns > 0 && ch.call === 'preconnect' ? 'opens a connection' : 'blocked'
    const pinned = RESIDUAL_PINNED[ch.id]
    add({ id: ch.id, group: 'residual', title: ch.title, expected: 'residual', reason: `${observed}${pinned === undefined ? ' (NOT PINNED)' : ''}`, pass: pinned !== undefined && pinned === observed, detail: { observed, pinned, out, hits: hits.map((h) => h.url.slice(0, 120)), conns, dgrams } })
  }
}

/** What each channel does in the pinned Chromium. A change in either direction fails the suite, so it is noticed. */
const RESIDUAL_PINNED: Record<string, string> = {
  'residual-prerender': 'leaks data',
  'residual-prefetch': 'blocked',
  'residual-preload': 'blocked',
  'residual-modulepreload': 'blocked',
  'residual-preconnect': 'blocked',
  'residual-webrtc': 'sends UDP',
  'residual-webrtc-turn': 'leaks data',
  'residual-self-nav-host': 'reaches the app anonymously',
  'residual-dns-prefetch': 'blocked',
}
let dnsProbe: { email: string } | null = null

async function phaseTokens(w: World): Promise<void> {
  await boot(w)
  const control = await call<Json[]>(w, 'sdk', [{ method: 'get', path: '/core/transactions/monthly-summary?months=1&hx=tok-control' }])
  rec.check('control: a granted read works', control[0]?.['ok'] === true, control)
  await sleep(300)
  const wire = (id: string) => w.log.requestUrls.find((r) => r.url.includes(`hx=${id}`))
  const pluginToken = (hostHeader(wire('tok-control') ?? { headers: {} }, 'authorization') ?? '').replace(/^Bearer /, '')
  const hostToken = (hostHeader(w.log.requestUrls.find((r) => r.url.endsWith(`/api/v1/plugins/${HOSTILE_PLUGIN_ID}/token`)) ?? { headers: {} }, 'authorization') ?? '').replace(/^Bearer /, '')
  // The host mints a token for a different plugin, as it would for that plugin's own frame.
  const mint = await fetch(`${w.base}/api/v1/plugins/wickermoney.budgets/token`, { method: 'POST', headers: { authorization: `Bearer ${hostToken}`, 'x-wickermoney-csrf': '1', 'content-type': 'application/json' }, body: '{}' })
  const budgetsToken = ((await mint.json().catch(() => ({}))) as { token?: string; accessToken?: string }).token ?? ''
  rec.check("control: the host's own token mints a token for another plugin (so the replay below is a real one)", mint.status === 200 && budgetsToken !== '', mint.status)

  const withToken = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, 'x-wickermoney-csrf': '1', 'content-type': 'application/json', cookie: `wickermoney_refresh=${w.user.refresh}`, ...extra })
  interface Probe { id: string; title: string; method: string; path: string; headers: Record<string, string>; body?: unknown; status: number[]; errorCode?: string }
  const probes: Probe[] = [
    { id: 'tok-refresh', title: 'stolen plugin token: POST /auth/refresh with the refresh cookie and CSRF header', method: 'POST', path: '/api/v1/auth/refresh', headers: withToken(pluginToken), body: {}, status: [403], errorCode: 'plugin_route_denied' },
    { id: 'tok-export', title: 'stolen plugin token: GET /settings/export', method: 'GET', path: '/api/v1/settings/export', headers: withToken(pluginToken), status: [403], errorCode: 'plugin_route_denied' },
    { id: 'tok-mint', title: 'stolen plugin token: mint another plugin token', method: 'POST', path: '/api/v1/plugins/wickermoney.budgets/token', headers: withToken(pluginToken), body: {}, status: [403], errorCode: 'plugin_route_denied' },
    { id: 'tok-disable', title: 'stolen plugin token: PATCH /plugins/<id> {enabled:false}', method: 'PATCH', path: `/api/v1/plugins/${HOSTILE_PLUGIN_ID}`, headers: withToken(pluginToken), body: { enabled: false }, status: [403], errorCode: 'plugin_route_denied' },
    { id: 'tok-ungranted', title: 'stolen plugin token: read an ungranted table', method: 'GET', path: '/api/v1/core/accounts/summary', headers: withToken(pluginToken), status: [403], errorCode: 'grant_denied' },
    { id: 'tok-other-ns', title: "stolen plugin token: another plugin's /p/ route, with the plugin header forged to that plugin", method: 'GET', path: '/api/v1/p/wickermoney.budgets/x', headers: withToken(pluginToken, { 'x-wickermoney-plugin': 'wickermoney.budgets' }), status: [403, 404], errorCode: 'plugin_route_denied' },
    { id: 'tok-other-ns-nohdr', title: "stolen plugin token: another plugin's /p/ route, plugin header omitted", method: 'GET', path: '/api/v1/p/wickermoney.budgets/x', headers: withToken(pluginToken), status: [403, 404], errorCode: 'plugin_route_denied' },
    { id: 'tok-replay-other', title: "another plugin's token replayed in this plugin's namespace", method: 'GET', path: `/api/v1/p/${HOSTILE_PLUGIN_ID}/x`, headers: withToken(budgetsToken), status: [403, 404], errorCode: 'plugin_route_denied' },
    { id: 'tok-replay-other-core', title: "control: another plugin's token is that plugin, within that plugin's grants (the token is the identity; no header changes it)", method: 'GET', path: '/api/v1/core/transactions/monthly-summary?months=1', headers: withToken(budgetsToken), status: [200, 403] },
    { id: 'tok-forged', title: 'a token with the plugin claims edited (alg none)', method: 'GET', path: '/api/v1/core/transactions/monthly-summary?months=1', headers: withToken(`${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims(pluginToken), tbl: ['transactions:write', 'accounts:read'] })).toString('base64url')}.`), status: [401] },
    { id: 'tok-garbled', title: 'a plugin token with a flipped signature byte', method: 'GET', path: '/api/v1/core/transactions/monthly-summary?months=1', headers: withToken(pluginToken.slice(0, -2) + (pluginToken.endsWith('A') ? 'B' : 'A') + pluginToken.slice(-1)), status: [401] },
  ]
  for (const p of probes) {
    const res = await fetch(`${w.base}${p.path}`, { method: p.method, headers: p.headers, ...(p.body !== undefined ? { body: JSON.stringify(p.body) } : {}) })
    const text = await res.text()
    const body = ((): Json => { try { return JSON.parse(text) as Json } catch { return {} } })()
    const got = String(body['code'] ?? (body['error'] as Json | undefined)?.['code'] ?? '')
    const ok = p.status.includes(res.status) && (p.errorCode === undefined || res.status === 404 || got === p.errorCode) && !text.includes(w.user.email)
    add({ id: p.id, group: 'tokens', title: p.title, expected: 'server-refusal', reason: res.status === 404 ? '404, no such route is mounted (the default-deny hook answers 403 plugin_route_denied where one is: see the API suite)' : `${res.status} ${got}`.trim(), pass: ok, detail: { status: res.status, body: text.slice(0, 200) } })
  }
  const unchanged = await w.admin.selectFrom('core.users').select(['id', 'role']).where('email', '=', w.user.email).execute()
  rec.check('after every stolen-token attempt the account still exists and the session still works', unchanged.length === 1 && (await fetch(`${w.base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${hostToken}` } })).status === 200)
}

async function phaseLifecycle(w: World): Promise<void> {
  // Owner, so the host can turn the plugin off the way a person would.
  await w.admin.updateTable('core.users').set({ role: 'owner' }).where('email', '=', w.user.email).execute()
  await boot(w)
  await call(w, 'sdk', [{ method: 'get', path: '/core/transactions/monthly-summary?months=1&hx=life-warm' }])
  await sleep(300)
  const hostToken = (hostHeader(w.log.requestUrls.find((r) => r.url.endsWith(`/api/v1/plugins/${HOSTILE_PLUGIN_ID}/token`)) ?? { headers: {} }, 'authorization') ?? '').replace(/^Bearer /, '')
  await call(w, 'takePort')
  const readA = { method: 'GET', path: '/core/transactions/monthly-summary?months=2&hx=life-a' }
  const first = (await call<Array<{ reply: unknown }>>(w, 'raw', [readA], 0))[0]?.reply
  rec.check('control: before the plugin is disabled, a read is answered', code(first) === 'ok', first)
  const off = await fetch(`${w.base}/api/v1/plugins/${HOSTILE_PLUGIN_ID}`, { method: 'PATCH', headers: { authorization: `Bearer ${hostToken}`, 'x-wickermoney-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })
  rec.check('control: an owner can disable the plugin', off.status === 200, off.status)
  const t0 = Date.now()
  const fresh = (await call<Array<{ reply: unknown }>>(w, 'raw', [{ method: 'GET', path: '/core/transactions/monthly-summary?months=3&hx=life-b', cache: 'no-store' }], 0))[0]?.reply
  add({ id: 'disabled-new-read', group: 'lifecycle', title: 'the plugin is disabled while its frame is open, then asks for data it has not asked for before', expected: 'server-refusal', reason: `${code(fresh)}${JSON.stringify((fresh as Json | undefined)?.['error'] ?? '').includes('plugin_disabled') ? ' (plugin_disabled)' : ''}`, pass: code(fresh) !== 'ok' && /plugin_disabled|forbidden|disabled/.test(JSON.stringify(fresh)), detail: fresh })
  const cached = (await call<Array<{ reply: unknown }>>(w, 'raw', [readA], 0))[0]?.reply
  const cachedMs = Date.now() - t0
  rec.check(`known window: a read answered before the disable may be served from the host's 5 s cache (here: ${code(cached)} after ${cachedMs} ms)`, code(cached) === 'ok' || code(cached) !== 'ok', { reply: code(cached), cachedMs })
  await sleep(Math.max(0, 5600 - (Date.now() - t0)))
  const later = (await call<Array<{ reply: unknown }>>(w, 'raw', [readA], 0))[0]?.reply
  add({ id: 'disabled-after-ttl', group: 'lifecycle', title: 'the same read once the cache entry has expired', expected: 'server-refusal', reason: code(later), pass: code(later) !== 'ok', detail: later })
  const remint = await fetch(`${w.base}/api/v1/plugins/${HOSTILE_PLUGIN_ID}/token`, { method: 'POST', headers: { authorization: `Bearer ${hostToken}`, 'x-wickermoney-csrf': '1', 'content-type': 'application/json' }, body: '{}' })
  add({ id: 'disabled-no-new-token', group: 'lifecycle', title: 'the host asks for a fresh token for the disabled plugin', expected: 'server-refusal', reason: String(remint.status), pass: remint.status === 404 })
  await w.page.reload()
  await dismissWizard(w.page)
  await sleep(1500)
  const frames = await w.page.locator('iframe[title^="Hostile"]').count()
  add({ id: 'disabled-no-frame', group: 'lifecycle', title: 'the dashboard after a reload', expected: 'contained', reason: `${frames} frames of the plugin`, pass: frames === 0 })
  await fetch(`${w.base}/api/v1/plugins/${HOSTILE_PLUGIN_ID}`, { method: 'PATCH', headers: { authorization: `Bearer ${hostToken}`, 'x-wickermoney-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })
}


/** `dns-prefetch` is judged after the browser has closed and flushed its net log: did a lookup for a host name that spells the session email go out? */
function judgeDns(netlog: string): void {
  if (dnsProbe === null) return
  const hex = Array.from(new TextEncoder().encode(dnsProbe.email)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
  let text = ''
  try { text = readFileSync(netlog, 'utf8') } catch { /* no net log */ }
  const looked = text.includes(`hxdns-${hex}.attacker.test`)
  const controlSeen = text.includes('hxcontrol-lookup.attacker.test')
  const observed = text === '' ? 'no net log' : !controlSeen ? 'inconclusive (the control lookup is not in the net log)' : looked ? 'leaks data' : 'blocked'
  const pinned = RESIDUAL_PINNED['residual-dns-prefetch']
  add({ id: 'residual-dns-prefetch-result', group: 'residual', title: 'dns-prefetch of hxdns-<hex of the email>.attacker.test, from the net log', expected: 'residual', reason: `${observed}${pinned === undefined ? ' (NOT PINNED)' : ''}`, pass: pinned !== undefined && pinned === observed })
}

async function main(): Promise<void> {
  const pw = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright
  const work = mkdtempSync(join(tmpdir(), 'wm-hostile-'))
  const dist = join(work, 'dist')
  const netlog = join(work, 'netlog.json')
  cpSync(join(webRoot, 'dist'), dist, { recursive: true })
  await buildFixture(join(dist, 'plugins/hostile'))
  await migrateTestDatabase()
  const attacker = await Attacker.start()
  const apiLog = new ApiLog()
  const server = await startServer(dist, apiLog)
  const browser = await pw.chromium.launch({
    ...(CHROMIUM !== undefined ? { executablePath: CHROMIUM } : { channel: 'chromium' as const }),
    args: ['--no-sandbox', '--host-resolver-rules=MAP attacker.test 127.0.0.1', `--log-net-log=${netlog}`, '--net-log-capture-mode=Everything'],
  })
  console.log(`engine: chromium ${browser.version()}`)
  const admin = createDb(TEST_ADMIN_DATABASE_URL)
  let userEmail = ''
  try {
    const user = await register(server.base)
    userEmail = user.email
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addCookies([{ name: 'wickermoney_refresh', value: user.refresh, url: server.base }])
    const log = new BrowserLog()
    log.attach(ctx)
    const w = { base: server.base, attacker, apiLog, log, ctx, user, admin, frameDocs: [], page: undefined as unknown as Playwright.Page, hostile: undefined as unknown as Playwright.Frame, victim: null } as World
    const phases: Array<[string, (w: World) => Promise<void>]> = [
      ['setup', phaseSetup], ['credentials', phaseCredentials], ['blocked', phaseBlocked], ['broker', phaseBroker], ['malformed', phaseMalformed],
      ['flood', phaseFlood], ['spoof', phaseSpoof], ['navigation', phaseNavigation], ['pageframe', phasePageFrame], ['residual', phaseResidual], ['tokens', phaseTokens], ['lifecycle', phaseLifecycle],
    ]
    await boot(w)
    for (const [name, fn] of phases) {
      if (!wants(name)) continue
      const t0 = Date.now()
      console.log(`\n== ${name}`)
      await fn(w)
      timings[name] = Date.now() - t0
    }
    void readFileSync
  } finally {
    await browser.close()
    judgeDns(netlog)
    await server.close()
    await attacker.close()
    await admin.deleteFrom('core.plugins').where('plugin_id', '=', HOSTILE_PLUGIN_ID).execute().catch(() => undefined)
    if (userEmail !== '') await admin.updateTable('core.users').set({ role: 'member' }).where('email', '=', userEmail).execute().catch(() => undefined)
    await admin.destroy()
    rmSync(work, { recursive: true, force: true })
  }
  const failed = rec.failed
  console.log(`\n${rec.results.length} attacks, ${rec.checks.length} checks, ${failed} failed. Phases (ms): ${JSON.stringify(timings)}`)
  const out = process.env['HOSTILE_OUT']
  if (out !== undefined) writeFileSync(out, JSON.stringify({ results: rec.results, checks: rec.checks, timings }, null, 2))
  process.exit(failed === 0 ? 0 : 1)
}

void (null as unknown as Stopped)
main().catch((error: unknown) => { console.error(error); process.exit(2) })
