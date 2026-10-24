/**
 * Browser check for the notification toast (ADR 0009).
 *
 * Builds a small harness (`toast-harness/`: the real AppShell, app.css and
 * ui-kit with a stand-in account menu and a long Transactions-like page),
 * serves it from memory-free static files and drives Chromium over it. No API
 * and no database. For each of desktop, 414 px and 360 px, in light and dark,
 * it checks:
 *
 * - axe finds no violations with toasts of every kind showing, with the phone
 *   drawer open, and with a dialog open;
 * - the banner is the first child of <main>, is in the flow (the page title
 *   moves down), sticks under the phone bar when scrolled, never covers the
 *   title or filters at the top, and adds no horizontal scroll;
 * - three toasts show on desktop and two on a phone, the rest wait;
 * - a toast raised while a Dialog is open is held until it closes;
 * - show() does not move focus, and Escape on a toast closes it and gives
 *   focus back;
 * - with reduced motion emulated there is no animation, transition or transform.
 *
 * Needs: a Chromium (`CHROMIUM_PATH`, default the preinstalled one),
 * playwright-core (`PLAYWRIGHT_CORE`, default `playwright-core`) and an axe-core
 * build (`AXE_PATH`, the path of `axe.min.js`; not a dependency of the repo).
 * Run from apps/api so its dependencies resolve:
 *
 *   AXE_PATH=/path/to/axe.min.js pnpm --filter @wickermoney/web test:toast
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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function buildHarness(outDir: string): Promise<void> {
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  await build({
    root: join(here, 'toast-harness'), configFile: false, logLevel: 'warn', publicDir: join(webRoot, 'public'),
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
  { name: 'desktop', width: 1280, height: 800, limit: 3 },
  { name: '414', width: 414, height: 800, limit: 2 },
  { name: '360', width: 360, height: 740, limit: 2 },
] as const

async function run(pw: typeof Playwright, base: string): Promise<void> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  try {
    for (const vp of VIEWPORTS) {
      for (const scheme of ['light', 'dark'] as const) {
        const tag = `${vp.name}/${scheme}`
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme })
        const page = await ctx.newPage()
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(String(e)))
        await page.goto(`${base}/`)
        await page.waitForSelector('#title')
        const show = (message: string, kind: string, key?: string): Promise<string> =>
          page.evaluate(([m, k, key2]) => window.__toast.show(m!, { kind: k as 'info', ...(key2 !== undefined ? { key: key2 } : {}) }), [message, kind, key] as const)
        const count = (): Promise<number> => page.locator('.wm-toast').count()
        const shot = async (name: string): Promise<void> => { if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}-${vp.name}-${scheme}.png`) }) }

        // Layout: in flow, first child of main, no cover, no horizontal scroll.
        const titleBefore = (await page.locator('#title').boundingBox())!.y
        const focusTarget = page.locator('#search')
        await focusTarget.focus()
        await show('Deleted Coffee (-$4.50).', 'success')
        await show('Rule saved.', 'info')
        await page.waitForSelector('.wm-toast')
        await sleep(350)
        const titleAfter = (await page.locator('#title').boundingBox())!.y
        const group = page.getByRole('group', { name: 'Notifications' })
        const box = (await group.boundingBox())!
        check(`${tag}: banner is the first child of <main>`, await page.evaluate(() => document.querySelector('main')!.firstElementChild?.getAttribute('aria-label') === 'Notifications'))
        check(`${tag}: banner is in the flow and pushes the page down`, titleAfter > titleBefore + 40, { titleBefore, titleAfter })
        check(`${tag}: banner does not cover the title or filters`, box.y + box.height <= titleAfter + 0.5 && (await page.locator('#search').boundingBox())!.y >= box.y + box.height, { box, titleAfter })
        check(`${tag}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        check(`${tag}: show() did not move focus`, await page.evaluate(() => document.activeElement?.id === 'search'))
        const live = await page.evaluate(() => {
          const s = document.querySelector('[role="status"][aria-live="polite"]')
          return { atomic: s?.getAttribute('aria-atomic'), outside: s !== null && s.closest('main, header') === null, text: s?.textContent }
        })
        check(`${tag}: announcer is outside main and header, atomic`, live.atomic === 'true' && live.outside, live)
        await shot('toast-2')
        let v = await axeOf(page)
        check(`${tag}: axe, success + info showing`, v.length === 0, v)

        // Queue and the per-width limit; every kind.
        await show('Disk almost full.', 'warning')
        await show('Could not delete.', 'error')
        await sleep(350)
        check(`${tag}: ${vp.limit} toasts show, the rest wait`, (await count()) === vp.limit, await count())
        check(`${tag}: Dismiss all appears`, await page.getByRole('button', { name: 'Dismiss all' }).isVisible())
        v = await axeOf(page)
        check(`${tag}: axe, ${vp.limit} toasts showing`, v.length === 0, v)
        await shot('toast-stack')

        // Sticky: scrolled down, the banner stays just under the phone bar (or the top on desktop).
        await page.evaluate(() => window.scrollTo(0, 900))
        await sleep(150)
        const sticky = await page.evaluate(() => {
          const g = document.querySelector('[aria-label="Notifications"]')!.getBoundingClientRect()
          const bar = document.querySelector('.shell__bar') as HTMLElement
          const barBottom = getComputedStyle(bar).display === 'none' ? 0 : bar.getBoundingClientRect().bottom
          return { top: g.top, barBottom, scrolled: window.scrollY }
        })
        check(`${tag}: banner sticks under the top (bar bottom ${sticky.barBottom}px)`, sticky.scrolled > 500 && Math.abs(sticky.top - sticky.barBottom) <= 1, sticky)
        await shot('toast-scrolled')
        await page.evaluate(() => window.scrollTo(0, 0))

        // Escape on a focused toast closes it and gives focus back.
        await focusTarget.focus()
        const before = await count()
        await page.locator('.wm-toast__close').first().focus()
        await page.keyboard.press('Escape')
        await sleep(100)
        check(`${tag}: Escape closes the focused toast and returns focus`, (await page.evaluate(() => document.activeElement?.id)) === 'search' && (await count()) <= before, {
          active: await page.evaluate(() => document.activeElement?.id), before, after: await count(),
        })
        await page.getByRole('button', { name: 'Dismiss all' }).click().catch(() => undefined)
        for (let i = 0; i < 4 && (await count()) > 0; i++) { await page.getByRole('button', { name: 'Dismiss all' }).click().catch(async () => { await page.locator('.wm-toast__close').first().click() }); await sleep(100) }
        check(`${tag}: everything can be dismissed`, (await count()) === 0, await count())

        // Dialog: a toast raised while it is open is held until it closes. The announcer is emptied
        // 1.5 s after its last update, so let the earlier ones clear before reading it as "nothing delivered".
        await sleep(1700)
        await page.getByRole('button', { name: 'Add transaction' }).click()
        await page.waitForSelector('dialog[open]')
        await show('After the dialog', 'success')
        await sleep(500)
        check(`${tag}: toast held while a dialog is open`, (await count()) === 0 && (await page.evaluate(() => document.querySelector('[role="status"][aria-live]')?.textContent)) === '')
        v = await axeOf(page)
        check(`${tag}: axe, dialog open`, v.length === 0, v)
        await page.keyboard.press('Escape')
        await page.waitForSelector('.wm-toast')
        check(`${tag}: toast delivered once the dialog closed`, (await count()) === 1)
        await page.locator('.wm-toast__close').first().click()

        // Drawer (phone widths): toasts and the announcer around an open drawer.
        if (vp.name !== 'desktop') {
          await show('Saved before the drawer.', 'success')
          await page.getByRole('button', { name: 'Menu' }).click()
          await sleep(350)
          check(`${tag}: drawer open makes the page (and banner) inert; announcer is not`, await page.evaluate(() =>
            document.querySelector('main')!.hasAttribute('inert') && document.querySelector('[role="status"][aria-live]')!.closest('[inert]') === null))
          await show('Raised under the drawer.', 'info')
          await sleep(350)
          v = await axeOf(page)
          check(`${tag}: axe, drawer open with toasts`, v.length === 0, v)
          await shot('toast-drawer')
          await page.keyboard.press('Escape')
        }
        check(`${tag}: no page errors`, errors.length === 0, errors)
        await ctx.close()
      }

      // Reduced motion: no animation, transition or transform.
      for (const reduce of [true, false]) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: reduce ? 'reduce' : 'no-preference' })
        const page = await ctx.newPage()
        await page.goto(`${base}/`)
        await page.waitForSelector('#title')
        await page.evaluate(() => window.__toast.show('Motion check', { kind: 'success' }))
        const toast = page.locator('.wm-toast').first()
        await toast.waitFor()
        const s = await toast.evaluate((el) => { const c = getComputedStyle(el); return { animation: c.animationName, transition: c.transitionDuration, transform: c.transform } })
        if (reduce) check(`${vp.name}: reduced motion has no animation, transition or transform`, s.animation === 'none' && /^0s(, 0s)*$/.test(s.transition) && s.transform === 'none', s)
        else check(`${vp.name}: default motion is the opacity fade only`, s.animation === 'wm-toast-in' && s.transform === 'none', s)
        await ctx.close()
      }
    }
  } finally { await browser.close() }
}

async function main(): Promise<void> {
  const mod = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright & { default?: typeof Playwright }
  const pw = mod.chromium === undefined && mod.default !== undefined ? mod.default : mod
  const out = join(tmpdir(), `wm-toast-harness-${process.pid}`)
  await buildHarness(out)
  const server = await serve(out)
  try { await run(pw, server.base) } finally { await server.close() }
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  const report = process.env['BROWSER_CHECK_OUT']
  if (report !== undefined) writeFileSync(report, JSON.stringify({ checks }, null, 2))
  if (failed.length > 0) process.exit(1)
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
