/**
 * Browser check for the action feedback on the Accounts, Categories and
 * Settings pages (ADR 0009, U1c-2).
 *
 * Builds a small harness (`feedback-harness/`: the real AppShell, the real
 * pages, app.css and ui-kit, a stand-in account menu and a fake sign-in) and
 * answers the API itself with Playwright route handlers, so it needs no server
 * and no database. What is real is everything the person touches: the page's
 * own handlers raise a real toast through the real provider, banner and
 * announcer. For desktop and a 390 px phone, in light and dark, it:
 *
 * - raises a toast from an Accounts action (the "safe to spend" checkbox, then
 *   a refusal), a Categories action (disable), and from four Settings actions
 *   (time zone, plugin switch, role, export, the last after its dialog closes);
 * - checks each toast is in the banner (first child of <main>), is announced
 *   once, and that nothing is left in the old page banner;
 * - checks where keyboard focus is after the action, which is what the time
 *   zone Save button's disabling puts at risk;
 * - runs axe with the toasts showing, and presses Escape on a toast.
 *
 * Needs: a Chromium (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`, default
 * `playwright-core`) and an axe-core build (`AXE_PATH`, the path of
 * `axe.min.js`; not a dependency of the repo). Run from apps/api so its
 * dependencies resolve:
 *
 *   AXE_PATH=/path/to/axe.min.js pnpm --filter @wickermoney/api exec tsx ../web/browser-check/feedback.ts
 *
 * `SHOTS_DIR=dir` keeps screenshots, `BROWSER_CHECK_OUT=file.json` keeps the report.
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = join(here, '..')
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AXE = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
const SHOTS = process.env['SHOTS_DIR']
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })

interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const notes: { name: string; detail: unknown }[] = []
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function buildHarness(outDir: string): Promise<void> {
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    root: join(here, 'feedback-harness'), configFile: false, logLevel: 'warn', publicDir: join(webRoot, 'public'),
    // Baked in by the real build; AboutSection reads it.
    define: { __APP_VERSION__: JSON.stringify('0.0.0') },
    plugins: [
      react(),
      {
        name: 'stub-account-menu',
        enforce: 'pre',
        resolveId(id, importer) {
          if (id === './AccountMenu.js' && importer?.endsWith('AppShell.tsx') === true) return join(here, 'toast-harness/AccountMenuStub.tsx')
          return null
        },
      },
    ],
    resolve: { alias: { '@wickermoney/ui-kit': join(webRoot, '../../packages/ui-kit/src/index.ts') } },
    build: { outDir, emptyOutDir: true, target: 'esnext' },
  })
}

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
}
async function serve(dir: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]!))
    const file = existsSync(path) && statSync(path).isFile() ? path : join(dir, 'index.html')
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  })
  await new Promise<void>((r) => server.listen(0, 'localhost', r))
  const port = (server.address() as AddressInfo).port
  return { base: `http://localhost:${port}`, close: () => new Promise((r) => server.close(() => { r() })) }
}

interface Axe { violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[] }
async function axeOf(page: Playwright.Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE })
  const result = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<Axe> } }).axe.run())
  return result.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.nodes.map((n) => String(n.target[0])).slice(0, 3).join(', ')}`)
}

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 800 },
] as const

const NOW = '2026-10-25T12:00:00.000Z'
const account = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, accountType: 'checking', initialBalance: '100.00', balance: '250.00', currencyCode: 'USD',
  bufferAmount: '0.00', spendable: true, archivedAt: null, ...over,
})
const plugin = (id: string, name: string, enabled: boolean) => ({
  id, name, description: `${name} does things.`, author: 'Wicker', version: '0.1.0', bundled: true, enabled,
  status: enabled ? 'enabled' : 'disabled', failure: null, origin: null, tables: [],
  contributes: { pages: [name], widgets: [], endpoints: false },
})
const person = (id: string, role: string) => ({ id, email: `${id}@example.com`, role, createdAt: NOW })
const changedBy = { id: 'u1', email: 'owner@example.com' }

/** What the check makes the API refuse, to see the error toast. */
interface Faults { failSpendableFor: string | null }

/** Answers the API the pages call. Anything unlisted is a 404, so a missed call fails loudly. */
async function stubApi(page: Playwright.Page, faults: Faults): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, '')
    const method = req.method()
    const body = req.postData() === null ? {} : JSON.parse(req.postData()!) as Record<string, unknown>
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (method === 'GET' && path === '/onboarding') return json({ onboardedAt: NOW, situations: ['always'], categoryCount: 2, groups: [] })
    if (method === 'GET' && path === '/accounts') return json([account('chk', 'Checking'), account('sav', 'Savings', { accountType: 'savings', spendable: false })])
    if (method === 'PATCH' && path.startsWith('/accounts/')) {
      if (faults.failSpendableFor !== null && path.endsWith(faults.failSpendableFor)) return json({ error: 'internal', message: 'The server could not save that account.' }, 500)
      return json({})
    }
    if (method === 'GET' && path === '/categories') return json([{ id: 'c1', name: 'Food', slug: 'food', parent_id: null, is_enabled: true, kind: 'expense' }])
    if (method === 'GET' && path === '/category-rules') return json([])
    if (method === 'PATCH' && path.startsWith('/categories/')) return json({})
    if (method === 'GET' && path === '/settings/config') {
      return json({ nodeEnv: 'test', logLevel: 'info', port: 8080, databaseName: 'wm', appRole: 'wm_app', latestMigration: '034' })
    }
    if (method === 'PATCH' && path === '/auth/me') return json({ id: 'u1', email: 'owner@example.com', timezone: body['timezone'], role: 'owner' })
    if (method === 'GET' && path === '/plugins/registry') return json({ plugins: [plugin('wickermoney.budgets', 'Budgets', true), plugin('wickermoney.forecast', 'Forecast', false)] })
    if (method === 'PATCH' && path.startsWith('/plugins/')) {
      const enabled = body['enabled'] === true
      return json({ plugin: plugin('wickermoney.budgets', 'Budgets', enabled), previous: { enabled: !enabled }, changed: true, changedBy, changedAt: NOW })
    }
    if (method === 'GET' && path === '/users') return json({ users: [person('u1', 'owner'), person('bob', 'member')] })
    if (method === 'PATCH' && path.startsWith('/users/')) {
      return json({ user: person('bob', String(body['role'])), previous: { role: 'member' }, changed: true, changedBy, changedAt: NOW })
    }
    if (method === 'POST' && path === '/settings/export-ticket') return json({ ticket: 't', expiresAt: NOW })
    if (method === 'GET' && path === '/settings/export') return json({ core: {} })
    return json({ error: 'not_found', message: `Unstubbed ${method} ${path}` }, 404)
  })
}

async function run(pw: typeof Playwright, base: string): Promise<void> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  try {
    for (const vp of VIEWPORTS) {
      for (const scheme of ['light', 'dark'] as const) {
        const tag = `${vp.name}/${scheme}`
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, acceptDownloads: true })
        const page = await ctx.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(String(e)))
        const faults: Faults = { failSpendableFor: null }
        await stubApi(page, faults)
        const texts = (): Promise<string[]> => page.locator('.wm-toast__text').allTextContents()
        const shot = async (name: string): Promise<void> => { if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}-${vp.name}-${scheme}.png`) }) }
        const active = (): Promise<string> => page.evaluate(() => {
          const e = document.activeElement as HTMLElement | null
          return e === null || e === document.body ? 'body' : `${e.tagName.toLowerCase()}${e.id !== '' ? `#${e.id}` : ''}[${e.getAttribute('aria-label') ?? e.textContent?.slice(0, 30) ?? ''}]`
        })
        const bannerOk = (): Promise<boolean> => page.evaluate(() => document.querySelector('main')!.firstElementChild?.getAttribute('aria-label') === 'Notifications')
        const noOldBanner = (): Promise<boolean> => page.evaluate(() => document.querySelectorAll('main .page > [role="alert"]').length === 0)
        const announced = (): Promise<string> => page.evaluate(() => document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '')

        // ---- Accounts --------------------------------------------------------------------------
        await page.goto(`${base}/accounts`)
        await page.waitForSelector('text=Checking')
        const spendable = page.getByLabel('Count Checking toward safe to spend')
        await spendable.focus()
        await page.keyboard.press('Space')
        await page.waitForSelector('.wm-toast')
        await sleep(200)
        check(`${tag}: Accounts, safe to spend: toast says what changed`, (await texts()).join('|') === "'Checking' no longer counts toward safe to spend.", await texts())
        check(`${tag}: Accounts, safe to spend: announced once, in the banner, old page banner empty`, (await announced()) === "'Checking' no longer counts toward safe to spend." && await bannerOk() && await noOldBanner(), { announced: await announced() })
        const focusAfter = await active()
        // Recorded, not asserted: the table's controls are disabled while any request runs (`disabled={busy}`),
        // which in Chromium sends focus to <body>. That predates this change and spans every table on these pages.
        console.log(`NOTE  ${tag}: focus after the safe-to-spend checkbox saved: ${focusAfter}`)
        notes.push({ name: `${tag}: focus after the safe-to-spend checkbox saved`, detail: focusAfter })
        let v = await axeOf(page)
        check(`${tag}: Accounts, axe with a success toast`, v.length === 0, v)
        await shot('accounts-success')

        faults.failSpendableFor = '/sav'
        await page.getByLabel('Count Savings toward safe to spend').click()
        await page.waitForFunction(() => document.querySelector('.wm-toast__text')?.textContent?.startsWith('Error:') === true)
        await sleep(200)
        check(`${tag}: Accounts, refusal: error toast replaces the success (same key), prefixed`, (await texts()).join('|') === 'Error: The server could not save that account.', await texts())
        check(`${tag}: Accounts, refusal: nothing in the old page banner`, await noOldBanner())
        v = await axeOf(page)
        check(`${tag}: Accounts, axe with an error toast`, v.length === 0, v)
        await shot('accounts-error')

        // Escape on a toast closes it and gives focus back.
        await page.getByLabel('Count Savings toward safe to spend').focus()
        await page.locator('.wm-toast__close').first().focus()
        await page.keyboard.press('Escape')
        await sleep(150)
        check(`${tag}: Accounts, Escape closes the toast`, (await page.locator('.wm-toast').count()) === 0)
        check(`${tag}: Accounts, Escape returns focus to the control it came from`, (await active()).includes('Count Savings'), await active())

        // ---- Categories ------------------------------------------------------------------------
        await page.goto(`${base}/categories`)
        await page.waitForSelector('text=Food')
        await page.getByRole('button', { name: 'Disable' }).first().click()
        await page.waitForSelector('.wm-toast')
        check(`${tag}: Categories, disable: toast names the category`, (await texts()).join('|').startsWith("Disabled 'Food'."), await texts())
        check(`${tag}: Categories, old page banner empty`, await noOldBanner() && await bannerOk())
        v = await axeOf(page)
        check(`${tag}: Categories, axe with a success toast`, v.length === 0, v)

        // ---- Settings --------------------------------------------------------------------------
        await page.goto(`${base}/settings`)
        await page.waitForSelector('text=bob@example.com', { timeout: 10_000 }).catch(async () => { console.log((await page.locator('main').innerText()).slice(0, 1500)); throw new Error('settings did not load') })

        // Time zone: keyboard only. Save disables itself on success.
        await page.getByLabel('Time zone', { exact: true }).selectOption('Asia/Tokyo')
        const save = page.getByRole('button', { name: 'Save', exact: true })
        await save.focus()
        await page.keyboard.press('Enter')
        await page.waitForSelector('.wm-toast')
        await sleep(300)
        check(`${tag}: Settings, time zone: toast replaces the inline "Saved."`, (await texts()).join('|') === 'Saved your time zone as Asia/Tokyo.' && (await page.getByText('Saved.', { exact: true }).count()) === 0, await texts())
        check(`${tag}: Settings, time zone: Save has disabled itself`, await save.isDisabled())
        const tzFocus = await active()
        check(`${tag}: Settings, time zone: keyboard focus stays in the section (on the picker)`, tzFocus.startsWith('select'), tzFocus)
        v = await axeOf(page)
        check(`${tag}: Settings, axe with the time zone toast`, v.length === 0, v)

        // Three toasts show on desktop and two on a phone, the rest wait: on a phone, clear the stack as we go.
        const clearIfPhone = async (): Promise<void> => {
          if (vp.name === 'desktop') return
          await page.getByRole('button', { name: 'Dismiss all' }).or(page.locator('.wm-toast__close').first()).first().click()
          await sleep(150)
        }

        // Plugin switch.
        await clearIfPhone()
        await page.getByRole('switch', { name: 'Enable Budgets' }).click()
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.wm-toast__text')).some((e) => e.textContent === 'Turned off Budgets.'))
        check(`${tag}: Settings, plugin switch: toast names the plugin`, (await texts()).includes('Turned off Budgets.'), await texts())

        // Role change.
        await clearIfPhone()
        await page.getByRole('combobox', { name: 'Role for bob@example.com' }).selectOption('owner')
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.wm-toast__text')).some((e) => e.textContent === 'bob@example.com is now an owner.'))
        check(`${tag}: Settings, role change: toast replaces the status line under the table`, (await page.locator('.people-announcement').count()) === 0, await texts())
        await shot('settings-stacked-toasts')
        v = await axeOf(page)
        check(`${tag}: Settings, axe with the stacked toasts`, v.length === 0, v)

        // Clear the stack so the export's toast is not queued behind the others.
        await page.getByRole('button', { name: 'Dismiss all' }).or(page.locator('.wm-toast__close').first()).first().click()
        await sleep(150)

        // Export: the toast waits for the password dialog to close, then is announced.
        await page.getByRole('button', { name: 'Download my data…' }).scrollIntoViewIfNeeded()
        await page.getByRole('button', { name: 'Download my data…' }).click()
        await page.getByRole('textbox', { name: 'Your password' }).fill('correct horse battery')
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Download my data', exact: true }).click()
        await download
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.wm-toast__text')).some((e) => e.textContent === 'Downloaded your data as a JSON file.'))
        await sleep(200)
        check(`${tag}: Settings, export: dialog is closed and the toast is raised after it`, (await page.locator('dialog[open]').count()) === 0 && (await texts()).includes('Downloaded your data as a JSON file.'), await texts())
        check(`${tag}: Settings, export: focus is back on the button`, (await active()).includes('Download my data'), await active())
        check(`${tag}: Settings, nothing in the old page banner`, await noOldBanner() && await bannerOk())

        // Escape closes the focused toast.
        const shown = await page.locator('.wm-toast').count()
        await page.locator('.wm-toast__close').first().focus()
        await page.keyboard.press('Escape')
        await sleep(150)
        check(`${tag}: Settings, Escape closes the focused toast`, (await page.locator('.wm-toast').count()) === shown - 1, { shown, now: await page.locator('.wm-toast').count() })
        check(`${tag}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        check(`${tag}: no page errors`, errors.length === 0, errors)
        await ctx.close()
      }
    }
  } finally { await browser.close() }
}

async function main(): Promise<void> {
  const mod = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright & { default?: typeof Playwright }
  const pw = mod.chromium === undefined && mod.default !== undefined ? mod.default : mod
  const out = join(tmpdir(), `wm-feedback-harness-${process.pid}`)
  await buildHarness(out)
  const server = await serve(out)
  try { await run(pw, server.base) } finally { await server.close() }
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  const report = process.env['BROWSER_CHECK_OUT']
  if (report !== undefined) writeFileSync(report, JSON.stringify({ checks, notes }, null, 2))
  if (failed.length > 0) process.exit(1)
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
