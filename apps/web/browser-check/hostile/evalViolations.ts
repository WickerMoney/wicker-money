/**
 * The bundled widgets never trip the eval block (a real browser).
 *
 * Every document the API serves carries a policy with no `'unsafe-eval'`, the plugin frame's included. Anything that
 * calls `eval` or `new Function` is refused, and the refusal shows up in DevTools Issues as "Content Security Policy of
 * your site blocks the use of `eval`". The hostile fixture does that on purpose, and the hostile suite pins it. This
 * check is the other half: the real code Wicker Money ships must not do it by accident. zod 4 does, unless it is told
 * not to: it probes `new Function("")` once, when the first object schema is built.
 *
 * It starts the real API with the bundled plugins only (no fixture, so nothing here evals on purpose), signs a fresh user
 * in, loads the dashboard with Insights and Spending Trends, each in its sandboxed frame, and records every
 * `securitypolicyviolation` event and every "Refused to evaluate" console message from the page and all its frames. It
 * fails on any, and also when a widget did not load, so a frame that never started cannot pass for a clean one. A
 * canary then evals from a timer in each frame, to show the recorder sees a refusal in the same place: without it, zero
 * would also be what a broken recorder reports.
 *
 * Needs the same things as `run.ts`: `pnpm build`, a migrated test database, and a Chromium (`CHROMIUM_PATH`, else
 * Playwright's own). `pnpm --filter @wickermoney/web test:hostile` runs it after the hostile suite.
 * `EVAL_VIOLATIONS_OUT=file.json` keeps the evidence, including each violation's script and position.
 */
import { writeFileSync } from 'node:fs'
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
import { PluginService } from '../../../api/src/plugins/service/PluginService.js'
import { TEST_AUTH_SECRET, TEST_DATABASE_URL, migrateTestDatabase } from '../../../api/src/testing/harness.js'
import { Recorder, sleep } from './lib.js'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '../../dist')
const CHROMIUM = process.env['CHROMIUM_PATH']
const rec = new Recorder()

/** The plugins whose widgets run in a frame, as `[title prefix of the iframe, built chunk the widget comes from]`. */
const WIDGETS = [
  ['Insights', /\/plugins\/insights\/assets\/(?:Trend|Donut)Widget-[\w-]+\.js$/],
  ['Spending Trends', /\/plugins\/spending-trends\/assets\/SpendingTrendsWidget-[\w-]+\.js$/],
] as const

/** The plugin pages that run in a frame, as `[iframe title, built chunk the page comes from]`. */
const PAGES = [
  ['Forecast', /\/plugins\/forecast\/assets\/ForecastPage-[\w-]+\.js$/],
] as const

/** Prefix of the console message the init script writes for each violation event. */
const TAG = '__wm_csp__'

/**
 * Runs first in every document of the page, sandboxed frames included, so the listener is there before any module is.
 * The event is reported as a console message because that is the one channel that leaves an opaque-origin frame.
 */
const RECORD_VIOLATIONS = `(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    console.debug(${JSON.stringify(TAG)} + JSON.stringify({
      directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber, column: e.columnNumber,
      sample: e.sample, document: location.pathname,
    }))
  })
})()`

interface Violation {
  readonly directive: string
  readonly blocked: string
  readonly source: string
  readonly line: number
  readonly column: number
  readonly sample: string
  readonly document: string
}

/** A refusal to run text as code: `blockedURI` is `eval` for `eval`, `new Function` and string timers alike. */
const isEval = (v: Violation): boolean => v.blocked === 'eval'

async function startServer() {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET, AUTH_ACCESS_TTL_SECONDS: '900',
    AUTH_RATE_LIMIT_MAX: '100000', AUTH_EMAIL_RATE_LIMIT_MAX: '100000', LOG_LEVEL: 'silent', WEB_DIST_DIR: dist,
  } as NodeJS.ProcessEnv)
  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT })
  const bundled = BUNDLED_PLUGINS
  const app = buildApp({ db, config, pluginOptions: { bundled } })
  await app.ready()
  await new PluginService(new KyselyUnitOfWork(db), { bundled }).seedBundled()
  await app.listen({ port: 0, host: 'localhost' })
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://localhost:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

async function register(base: string): Promise<string> {
  const email = `evalcheck-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const res = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  return cookie.split(';')[0]!.split('=')[1]!
}

/** The first-run setup wizard covers the page; Escape skips it, as a person would. */
async function dismissWizard(page: Playwright.Page): Promise<void> {
  await page.waitForSelector('.wiz', { timeout: 8000 }).then(() => page.keyboard.press('Escape')).catch(() => undefined)
  await page.waitForSelector('.wiz', { state: 'detached', timeout: 8000 }).catch(() => undefined)
}

async function main(): Promise<void> {
  const pw = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright
  await migrateTestDatabase()
  const server = await startServer()
  const browser = await pw.chromium.launch({
    ...(CHROMIUM !== undefined ? { executablePath: CHROMIUM } : { channel: 'chromium' as const }),
    args: ['--no-sandbox'],
  })
  console.log(`engine: chromium ${browser.version()}`)
  const violations: Violation[] = []
  const refusals: string[] = []
  const scripts: string[] = []
  try {
    // Tall enough for the whole dashboard: a widget frame is only created when its card is near the
    // viewport, and this check needs every bundled widget's frame to exist at load.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 4000 } })
    await ctx.addCookies([{ name: 'wickermoney_refresh', value: await register(server.base), url: server.base }])
    await ctx.addInitScript(RECORD_VIOLATIONS)
    const page = await ctx.newPage()
    page.on('console', (m) => {
      const text = m.text()
      if (m.type() === 'debug' && text.startsWith(TAG)) violations.push(JSON.parse(text.slice(TAG.length)) as Violation)
      else if (m.type() === 'error' && /Refused to evaluate|unsafe-eval/.test(text)) refusals.push(text)
    })
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()) })

    await page.goto(`${server.base}/`)
    await dismissWizard(page)
    for (const [title] of WIDGETS) {
      await page.waitForFunction((t) => {
        const frames = [...document.querySelectorAll<HTMLIFrameElement>(`iframe[title^="${t}"]`)]
        return frames.length > 0 && frames.every((f) => f.style.visibility === 'visible')
      }, title, { timeout: 30_000 }).catch(() => undefined)
    }
    // Give a late chunk (a chart library, a lazy widget) the time to load before judging.
    await sleep(1500)

    // The widgets must have loaded, from their own chunks, in frames that show no error: a frame that never started
    // would not have probed anything.
    for (const [title, chunk] of WIDGETS) {
      const frames = await page.locator(`iframe[title^="${title}"]`).count()
      rec.check(`${title}: its widget frame is on the dashboard`, frames > 0, frames)
      rec.check(`${title}: its widget chunk was loaded`, scripts.some((u) => chunk.test(new URL(u).pathname)), scripts.filter((u) => u.includes('/plugins/')).slice(0, 8))
    }
    const alerts = await Promise.all(page.frames().filter((f) => f.url().includes('/plugin-frame')).map((f) => f.locator('p[role=alert]').allTextContents().catch(() => [])))
    rec.check('no widget frame shows a load error', alerts.every((a) => a.length === 0), alerts.flat())
    const frameDocs = page.frames().filter((f) => f.url().includes('/plugin-frame'))
    rec.check('the frame documents are loaded', frameDocs.length >= WIDGETS.length, frameDocs.length)

    // The finding: nothing the real widgets and their frames ran was refused for eval.
    const evalRefused = violations.filter(isEval)
    rec.check('no eval-blocked CSP violation from the page, the frames or the bundled widgets', evalRefused.length === 0 && refusals.length === 0, { violations: evalRefused, console: refusals })
    rec.check('no CSP violation of any kind from the bundled widgets', violations.length === 0, violations)

    // The canary: the recorder must see a refusal where one is raised, in every frame, by code that is not zod.
    const before = violations.length
    for (const f of frameDocs) {
      await f.evaluate(() => { setTimeout(() => { try { new Function('return 1')() } catch { /* the point */ } }, 0) })
    }
    await sleep(500)
    const canary = violations.slice(before).filter(isEval)
    rec.check('canary: the recorder sees the refusal of a deliberate eval in each frame', canary.length === frameDocs.length, { frames: frameDocs.length, seen: canary })

    // The plugin pages that run in a frame. A page is never lazy, so its frame exists as soon as the route renders.
    // Reached through the shell's own navigation, as a person would, so the frame starts inside a running app.
    const beforePages = violations.length
    const refusedBefore = refusals.length
    for (const [title, chunk] of PAGES) {
      const href = BUNDLED_PLUGINS.find((m) => m.name === title)?.contributes.pages[0]
      const id = BUNDLED_PLUGINS.find((m) => m.name === title)?.id
      await page.locator(`nav a[href="/p/${id}/${href?.path}"]`).first().click()
      await page.waitForFunction((t) => {
        const frames = [...document.querySelectorAll<HTMLIFrameElement>(`iframe[title^="${t}"]`)]
        return frames.length === 1 && frames.every((f) => f.style.visibility === 'visible')
      }, title, { timeout: 30_000 }).catch(() => undefined)
      await sleep(1500)
      const frames = await page.locator(`iframe[title^="${title}"]`).count()
      rec.check(`${title}: its page frame is on the page`, frames === 1, frames)
      rec.check(`${title}: its page chunk was loaded`, scripts.some((u) => chunk.test(new URL(u).pathname)), scripts.filter((u) => u.includes('/plugins/')).slice(-8))
      const pageAlerts = await Promise.all(page.frames().filter((f) => f.url().includes('kind=page')).map((f) => f.locator('p[role=alert]').allTextContents().catch(() => [])))
      rec.check(`${title}: its page frame shows no load error`, pageAlerts.length === 1 && pageAlerts.every((a) => a.length === 0), pageAlerts.flat())
    }
    const pageViolations = violations.slice(beforePages)
    rec.check('no eval-blocked CSP violation from a plugin page or its frame', pageViolations.filter(isEval).length === 0 && refusals.length === refusedBefore, { violations: pageViolations.filter(isEval), console: refusals.slice(refusedBefore) })
    rec.check('no CSP violation of any kind from a plugin page', pageViolations.length === 0, pageViolations)
    // The canary, in the page frame: the recorder sees a deliberate eval where the page runs.
    const pageFrames = page.frames().filter((f) => f.url().includes('kind=page'))
    const beforeCanary = violations.length
    for (const f of pageFrames) await f.evaluate(() => { setTimeout(() => { try { new Function('return 1')() } catch { /* the point */ } }, 0) })
    await sleep(500)
    rec.check('canary: the recorder sees the refusal of a deliberate eval in the page frame', violations.slice(beforeCanary).filter(isEval).length === pageFrames.length && pageFrames.length === PAGES.length, { frames: pageFrames.length, seen: violations.slice(beforeCanary) })

    const out = process.env['EVAL_VIOLATIONS_OUT']
    if (out !== undefined) writeFileSync(out, JSON.stringify({ violations, refusals, canary: canary.length, scripts: scripts.filter((u) => u.includes('.js')) }, null, 2))
  } finally {
    await browser.close()
    await server.close()
  }
  console.log(`\n${rec.checks.length} checks, ${rec.failed} failed.`)
  process.exit(rec.failed === 0 ? 0 : 1)
}

main().catch((error: unknown) => { console.error(error); process.exit(2) })
