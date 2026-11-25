/**
 * Browser check for toasts raised by real Transactions actions (ADR 0009, U1c-1).
 *
 * Starts the real API (built web app) against a seeded development database,
 * signs in as the seeded `hero` persona and drives the real Transactions page at
 * desktop and phone width, in light and dark. It does real actions (changes a
 * category, edits a merchant in the dialog, deletes a row) and checks that:
 *
 * - a delete asks for `?undo=1` and offers Undo (ADR 0016); Undo puts the row back and says "Restored ...", an expired
 *   Undo (the restore answered 410) says "It is too late to undo that." in place of the Undo toast, and what the check
 *   deleted is put back through the API when the context ends;
 *
 * - each says what happened, in the toast and in the announcer, and `show()`
 *   leaves focus where it was;
 * - a toast raised by saving the edit dialog is delivered after the dialog closed;
 * - axe finds nothing new with the toasts showing (it is compared with the same
 *   page before any toast, because the page itself may have findings of its own);
 * - Escape on a focused toast closes it;
 * - the real height of one-line and two-line toasts, and of a stack, is measured;
 * - the recurring picker (seeded `household`): Not this keeps it open with the focus inside and says so in a toast,
 *   Close and Match put focus on Link, and a toast raised after the picker closed does not take it;
 * - with the banner stuck to the top, Shift+Tab up a long list never leaves the
 *   focused control behind the banner (the row scroll margin).
 *
 * Needs: `pnpm build` done (apps/web/dist), a migrated and seeded database
 * (`pnpm migrate`, `pnpm --filter @wickermoney/api seed`), Chromium
 * (`CHROMIUM_PATH`), playwright-core (`PLAYWRIGHT_CORE`) and an axe-core build
 * (`AXE_PATH`, the path of `axe.min.js`; not a dependency of the repo). Run from
 * apps/api so its dependencies resolve, with the `.env` loaded:
 *
 *   cd apps/api && AXE_PATH=/path/to/axe.min.js npx tsx --env-file=../../.env ../web/browser-check/transactionsToast.ts
 *
 * `SHOTS_DIR=dir` keeps screenshots, `BROWSER_CHECK_OUT=file.json` keeps the report
 * (checks and measurements).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type * as Playwright from 'playwright-core'
import { buildApp } from '../../api/src/app.js'
import { loadConfig } from '../../api/src/config.js'
import { KyselyUnitOfWork } from '../../api/src/data/KyselyUnitOfWork.js'
import { configureTenantContext } from '../../api/src/db/configureTenantContext.js'
import { createDb } from '../../api/src/db/client.js'
import { BUNDLED_PLUGINS } from '../../api/src/plugins/bundled.js'
import { PluginService } from '../../api/src/plugins/service/PluginService.js'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '..', 'dist')
const CHROMIUM = process.env['CHROMIUM_PATH'] ?? '/opt/pw-browsers/chromium'
const AXE = readFileSync(process.env['AXE_PATH'] ?? 'axe.min.js', 'utf8')
const SHOTS = process.env['SHOTS_DIR']
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })

interface Check { readonly name: string; readonly pass: boolean; readonly detail?: unknown }
const checks: Check[] = []
const measurements: Record<string, unknown> = {}
const measure = (name: string, value: unknown): void => { measurements[name] = value; console.log(`MEASURE ${name}  ${JSON.stringify(value)}`) }
const check = (name: string, pass: boolean, detail?: unknown): void => {
  checks.push({ name, pass, ...(detail !== undefined ? { detail } : {}) })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function startServer() {
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
  await app.listen({ port: Number(process.env['PORT'] ?? 0), host: '127.0.0.1' })
  const port = (app.server.address() as AddressInfo).port
  return { base: `http://127.0.0.1:${port}`, close: async () => { await app.close(); await db.destroy() } }
}

/** Signs in and returns the refresh cookie value and an access token (for calling the API from the check itself). */
async function loginSession(base: string, email: string, password: string): Promise<{ refresh: string; access: string }> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wickermoney_refresh='))
  if (cookie === undefined) throw new Error('no refresh cookie')
  const body = await res.json() as { accessToken?: string }
  if (body.accessToken === undefined) throw new Error('no access token')
  return { refresh: cookie.split(';')[0]!.split('=')[1]!, access: body.accessToken }
}

interface Axe { violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[] }
async function axeOf(page: Playwright.Page): Promise<string[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(AXE) // the page's CSP refuses an injected script tag; evaluate does not go through it
  const result = await page.evaluate(() => (window as unknown as { axe: { run: () => Promise<Axe> } }).axe.run())
  return result.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.nodes.map((n) => String(n.target[0])).slice(0, 3).join(', ')}`)
}

const ALL_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, limit: 3 },
  { name: 'phone-390', width: 390, height: 844, limit: 2 },
  { name: 'phone-360', width: 360, height: 740, limit: 2 },
] as const
// `ONLY_VIEWPORTS=desktop,phone-390` and `ONLY_SCHEMES=light` narrow a run while iterating.
const VIEWPORTS = ALL_VIEWPORTS.filter((v) => process.env['ONLY_VIEWPORTS'] === undefined || process.env['ONLY_VIEWPORTS'].split(',').includes(v.name))
const SCHEMES = (['light', 'dark'] as const).filter((c) => process.env['ONLY_SCHEMES'] === undefined || process.env['ONLY_SCHEMES'].split(',').includes(c))

const LONG_MERCHANT = 'Quarterly estimated federal and state income tax payment (joint filing, second instalment)'

/** The visible toasts as a person reads them, newest first. */
const toastTexts = (page: Playwright.Page): Promise<string[]> =>
  page.locator('.wm-toast__text').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

/** The height of each visible toast and of the whole banner, in px. */
const bannerHeights = (page: Playwright.Page): Promise<{ toasts: number[]; banner: number }> =>
  page.evaluate(() => ({
    toasts: [...document.querySelectorAll('.wm-toast')].map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10),
    banner: Math.round((document.querySelector('[aria-label="Notifications"]')?.getBoundingClientRect().height ?? 0) * 10) / 10,
  }))

async function waitToast(page: Playwright.Page, text: RegExp | string): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    if ((await toastTexts(page)).some((t) => (typeof text === 'string' ? t === text : text.test(t)))) return true
    await sleep(50)
  }
  return false
}

async function run(pw: typeof Playwright, base: string): Promise<void> {
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] })
  try {
    for (const vp of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        const tag = `${vp.name}/${scheme}`
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme })
        const session = await loginSession(base, 'hero@seed.wickermoney.test', 'SeedHero!2026')
        await ctx.addCookies([{ name: 'wickermoney_refresh', value: session.refresh, url: base }])
        const page = await ctx.newPage()
        const errors: string[] = []
        // What a delete saved (ADR 0016), so the end of this context can put back whatever Undo did not.
        const snapshots: string[] = []
        const deleteUrls: string[] = []
        page.on('response', (res) => {
          if (res.request().method() !== 'DELETE' || !/\/api\/v1\/transactions\/[^/?]+/.test(res.url())) return
          deleteUrls.push(res.url())
          void res.json().then((b: { undo?: { id?: string } | null }) => { if (typeof b.undo?.id === 'string') snapshots.push(b.undo.id) }, () => undefined)
        })
        page.on('pageerror', (e) => errors.push(String(e)))
        let lastConfirm = ''
        page.on('dialog', (d) => { lastConfirm = d.message(); void d.accept() })
        const shot = async (name: string): Promise<void> => { if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, `${name}-${vp.name}-${scheme}.png`) }) }

        await page.goto(`${base}/transactions`)
        await page.locator('.txn-table tbody tr').first().waitFor()
        const rows = (): Playwright.Locator => page.locator('.txn-table tbody tr:not(.wm-table__detail)')
        const announcer = (): Promise<string> => page.evaluate(() => document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '')

        const baseline = await axeOf(page)
        check(`${tag}: no toast yet, banner not drawn`, (await page.locator('[aria-label="Notifications"]').count()) === 0)

        // 1. A category change on a row: real select, real request. Focus stays on the select.
        const select = rows().first().locator('select.cat-cell__select')
        const merchant1 = (await rows().first().locator('td[data-col="merchant"]').innerText()).trim()
        const current = await select.inputValue()
        const options = await select.locator('option').evaluateAll((os) => os.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
        const next = options.find((o) => o.value !== '' && o.value !== current)!
        await select.focus()
        await select.selectOption(next.value)
        check(`${tag}: a category change says what it did`, await waitToast(page, `Set '${merchant1}' to ${next.text}.`), await toastTexts(page))
        check(`${tag}: the toast did not take focus from the select`, await select.evaluate((el) => el === document.activeElement))
        await sleep(200)
        measure(`${tag}: one category toast`, await bannerHeights(page))
        check(`${tag}: the announcer carries the same words`, (await announcer()).includes(`Set '${merchant1}'`), await announcer())

        // 2. Saving the edit dialog: the toast is delivered after the dialog has closed.
        const editLong = async (n: number): Promise<void> => {
          await rows().nth(n).getByRole('button', { name: 'Edit', exact: true }).click()
          const dialog = page.getByRole('dialog')
          await dialog.getByLabel('Merchant').fill(LONG_MERCHANT)
          await dialog.getByRole('button', { name: 'Save' }).click()
          await dialog.waitFor({ state: 'detached' })
        }
        await editLong(1)
        check(`${tag}: saving an edit says so after the dialog closed`, await waitToast(page, `Updated '${LONG_MERCHANT}'.`), await toastTexts(page))
        await sleep(200)
        measure(`${tag}: category toast + long edit toast`, await bannerHeights(page))

        // 3. Delete a row: names it, no Undo anywhere. Earlier toasts are closed first: on a phone only two show
        // and a third waits for a slot, because nothing is evicted.
        const dismissAll = async (): Promise<void> => {
          for (let i = 0; i < 6 && (await page.locator('.wm-toast').count()) > 0; i++) {
            const all = page.getByRole('button', { name: 'Dismiss all' })
            if (await all.count() > 0) await all.click()
            else await page.locator('.wm-toast__close').first().click()
            await sleep(120)
          }
        }
        await dismissAll()
        check(`${tag}: everything can be closed`, (await page.locator('.wm-toast').count()) === 0)
        const rowsBefore = await rows().count()
        const third = rows().nth(2)
        const merchant3 = (await third.locator('td[data-col="merchant"]').innerText()).trim()
        lastConfirm = ''
        // Hold the DELETE open, so what the controls do while a request runs can be read (a request this size is over in
        // milliseconds otherwise): the control that was pressed keeps focus (`aria-disabled`, not `disabled`, which would
        // drop focus to <body>), every other control in the row is busy too, a second activation sends nothing, and the
        // announcer says why.
        let release: () => void = () => undefined
        const held = new Promise<void>((resolve) => { release = resolve })
        let deleteRequests = 0
        await page.route('**/api/v1/transactions/*', async (route) => {
          if (route.request().method() === 'DELETE') { deleteRequests += 1; await held }
          // `unroute` below can tear this route down while the released request is still being continued.
          await route.continue().catch(() => undefined)
        })
        const deleteButton = third.getByRole('button', { name: 'Delete' })
        await deleteButton.click()
        for (let i = 0; i < 40 && lastConfirm === ''; i++) await sleep(50) // the dialog event arrives separately from the click
        for (let i = 0; i < 40 && deleteRequests === 0; i++) await sleep(50)
        const during = await deleteButton.evaluate((el) => {
          const row = el.closest('tr')!
          return {
            focused: el === document.activeElement,
            ariaDisabled: el.getAttribute('aria-disabled'),
            disabled: (el as HTMLButtonElement).disabled,
            rowButtons: [...row.querySelectorAll('button')].map((b) => ({ label: b.getAttribute('aria-label') ?? b.textContent ?? '', aria: b.getAttribute('aria-disabled'), disabled: b.disabled })),
            activeTag: document.activeElement?.tagName ?? '',
          }
        })
        check(`${tag}: while a delete runs, focus stays on the Delete button`, during.focused, during)
        check(`${tag}: and it is aria-disabled, not disabled`, during.ariaDisabled === 'true' && !during.disabled, during)
        check(`${tag}: every other button in the row is busy the same way`, during.rowButtons.length >= 2 && during.rowButtons.every((b) => b.aria === 'true' && !b.disabled), during.rowButtons)
        await page.keyboard.press('Enter')
        await sleep(250)
        check(`${tag}: pressing it again sends nothing`, deleteRequests === 1, deleteRequests)
        const said = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent ?? '').join(' | '))
        check(`${tag}: and the announcer says it is still working`, said.includes('Still working'), said)
        release()
        // A transfer has its own wording (both legs go), so the page's own confirm dialog says which kind this row is,
        // and the seeded order of rows (the dates move with the day) does not matter.
        const isTransfer = lastConfirm.startsWith('Delete this transfer of ')
        const deletedText = isTransfer
          ? /^Deleted transfer of .+\. Both sides were removed\.$/
          : new RegExp(`^Deleted '${merchant3.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' \\(.+\\)\\.$`)
        await page.unroute('**/api/v1/transactions/*')
        check(`${tag}: a delete names what was deleted`, await waitToast(page, deletedText), { confirm: lastConfirm, toasts: await toastTexts(page) })
        check(`${tag}: the delete asked for ?undo=1`, deleteUrls.length === 1 && deleteUrls[0]!.endsWith('?undo=1'), deleteUrls)
        check(`${tag}: the delete toast offers one Undo`, (await page.getByRole('button', { name: 'Undo' }).count()) === 1)
        check(`${tag}: the announcer says Undo is available`, (await announcer()).includes('Undo is available.'), await announcer())
        await sleep(350)
        measure(`${tag}: one delete toast`, await bannerHeights(page))
        await shot('transactions-toast')

        // axe with the toast showing: nothing the page did not already have.
        const withToasts = await axeOf(page)
        const fresh = withToasts.filter((v) => !baseline.includes(v))
        check(`${tag}: axe finds nothing new with a toast showing (page had ${baseline.length} before)`, fresh.length === 0, fresh)
        if (baseline.length > 0) measure(`${tag}: axe before any toast`, baseline)

        // Nothing dismisses itself.
        await sleep(2000)
        check(`${tag}: nothing dismisses itself`, (await page.locator('.wm-toast').count()) === 1)

        // 3b. Undo: the row comes back, the toast says so, and focus is not lost to <body>.
        await page.getByRole('button', { name: 'Undo' }).click()
        check(`${tag}: Undo says what it restored`, await waitToast(page, /^Restored /), await toastTexts(page))
        await page.waitForFunction((n) => document.querySelectorAll('.txn-table tbody tr:not(.wm-table__detail)').length === n, rowsBefore, { timeout: 5000 }).catch(() => undefined)
        check(`${tag}: the row is back in the list (${rowsBefore} rows)`, (await rows().count()) === rowsBefore, await rows().count())
        check(`${tag}: the Undo toast is gone and focus is not on <body>`, (await page.getByRole('button', { name: 'Undo' }).count()) === 0
          && await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null))
        await shot('transactions-restored')

        // 4. Escape on a focused toast closes it.
        const text = (await toastTexts(page))[0]!
        await page.locator('.wm-toast__close').first().focus()
        await page.keyboard.press('Escape')
        await sleep(150)
        check(`${tag}: Escape closes the focused toast`, !(await toastTexts(page)).includes(text), await toastTexts(page))

        // 4b. An Undo that is too late (the restore answers 410): the error takes the Undo toast's place.
        await dismissAll()
        await page.route('**/api/v1/transaction-undos/*/restore', (route) => route.fulfill({
          status: 410, contentType: 'application/json', body: JSON.stringify({ code: 'undo_expired', message: 'It is too late to undo that.' }),
        }))
        await rows().nth(2).getByRole('button', { name: 'Delete' }).click()
        check(`${tag}: a second delete offers Undo again`, await waitToast(page, /^Deleted /), await toastTexts(page))
        await page.getByRole('button', { name: 'Undo' }).click()
        check(`${tag}: a late Undo says so`, await waitToast(page, /It is too late to undo that\./), await toastTexts(page))
        check(`${tag}: and no Undo is left on screen`, (await page.getByRole('button', { name: 'Undo' }).count()) === 0)
        await page.unroute('**/api/v1/transaction-undos/*/restore')
        await dismissAll()

        // 5. A full stack (every family raised, one with a long name), then the keyboard: the banner is stuck to
        // the top, and Shift+Tab up the list must not leave the focused control behind it.
        await select.selectOption(options.find((o) => o.value !== '' && o.value !== next.value)!.value)
        await editLong(3)
        await rows().nth(4).getByRole('button', { name: 'Delete' }).click()
        await sleep(500)
        const stack = await bannerHeights(page)
        measure(`${tag}: full stack (${vp.limit} show)`, { ...stack, texts: await toastTexts(page) })
        check(`${tag}: ${vp.limit} toasts at most show at once`, stack.toasts.length <= vp.limit && stack.toasts.length >= 2, stack)
        await shot('transactions-stack')
        // A row action's scroll margin is the phone bar + the published banner height + 8 px, not a measurement of its own.
        const margin = await page.evaluate(() => {
          const bar = document.querySelector('.shell__bar') as HTMLElement | null
          const barBottom = bar !== null && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().bottom : 0
          const banner = Math.ceil(document.querySelector('[aria-label="Notifications"]')!.getBoundingClientRect().height)
          const action = document.querySelector('.txn-list tbody button, .txn-list button')!
          return { margin: parseFloat(getComputedStyle(action).scrollMarginTop), expected: barBottom + banner + 8,
            published: document.querySelector('main')!.style.getPropertyValue('--wm-toast-height'), banner }
        })
        check(`${tag}: a row action's scroll margin is the bar, the published banner height and 8px`,
          Math.abs(margin.margin - margin.expected) <= 1 && margin.published === `${margin.banner}px`, margin)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await sleep(200)
        await rows().last().getByRole('button', { name: 'Edit', exact: true }).focus()
        let hidden: unknown = null
        let steps = 0
        const covered = (): Promise<{ id: string; top: number; bannerBottom: number; margin: string; clear: string } | null> => page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          const banner = document.querySelector('[aria-label="Notifications"]')
          if (el === null || banner === null) return null
          const bar = document.querySelector('.shell__bar') as HTMLElement | null
          const barBottom = bar !== null && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().bottom : 0
          const bannerBottom = banner.getBoundingClientRect().bottom
          const top = el.getBoundingClientRect().top
          const hiddenBehind = window.scrollY > 0 && top < Math.max(bannerBottom, barBottom) - 0.5 && !banner.contains(el)
          return hiddenBehind ? {
            id: el.getAttribute('aria-label') ?? el.tagName, top, bannerBottom,
            margin: getComputedStyle(el).scrollMarginTop, clear: document.querySelector<HTMLElement>('main')?.style.getPropertyValue('--wm-toast-height') ?? '',
          } : null
        })
        // Up through 60 tab stops, which crosses the rows on screen and those above it.
        for (; steps < 60 && hidden === null; steps++) {
          await page.keyboard.press('Shift+Tab')
          await sleep(30)
          hidden = await covered()
        }
        check(`${tag}: Shift+Tab up the list never leaves the focus behind the banner (${steps} stops)`, hidden === null, hidden)
        await shot('transactions-keyboard')

        // Put back what is still deleted (a 409 `already_undone` is the one Undo restored already).
        let putBack = 0
        for (const id of snapshots) {
          const res = await fetch(`${base}/api/v1/transaction-undos/${id}/restore`, { method: 'POST', headers: { authorization: `Bearer ${session.access}` } })
          if (res.ok) putBack += 1
          else if (res.status !== 409) check(`${tag}: put back a deleted row (${id})`, false, res.status)
        }
        measure(`${tag}: snapshots made / put back by the check`, { made: snapshots.length, putBack })
        await ctx.close()
        check(`${tag}: no page errors`, errors.length === 0, errors)
      }
      if (vp.name !== 'phone-360') await pickerFlow(browser, base, vp)
    }
  } finally { await browser.close() }
}

/** The recurring picker, as `household` (who has suggestions): what a toast does to its focus and open state. */
async function pickerFlow(browser: Playwright.Browser, base: string, vp: { name: string; width: number; height: number }): Promise<void> {
  const tag = `${vp.name}/light picker`
  const session = await loginSession(base, 'household@seed.wickermoney.test', 'SeedHousehold!2026')
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'light' })
  await ctx.addCookies([{ name: 'wickermoney_refresh', value: session.refresh, url: base }])
  const page = await ctx.newPage()
  // Not this and Match change the seeded household for good: a dismissal takes the suggestion away and a match
  // uses the occurrence up. The next context (another width) would find no suggestion to open. So each context
  // records what it changed and puts it back when it is done, whether or not its checks passed.
  const changes: string[] = []
  page.on('response', (res) => {
    const m = /^(https?:\/\/[^/]+\/api\/v1\/recurring-items\/[^/]+\/occurrences\/[^/]+\/(?:dismissals|matches))$/.exec(res.url())
    if (m !== null && res.request().method() === 'POST' && res.ok()) {
      const body = res.request().postDataJSON() as { transactionId?: string } | null
      if (typeof body?.transactionId === 'string') changes.push(`${m[1]!}/${body.transactionId}`)
    }
  })
  try {
    await pickerChecks(page, tag, base)
  } finally {
    await ctx.close()
    for (const url of changes.reverse()) {
      const res = await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${session.access}` } })
      if (!res.ok) check(`${tag}: put back what the check changed (${url.replace(base, '')})`, false, res.status)
    }
  }
}

async function pickerChecks(page: Playwright.Page, tag: string, base: string): Promise<void> {
  await page.goto(`${base}/transactions`)
  await page.locator('.txn-table tbody tr').first().waitFor()
  await page.locator('.recur-linkbtn').first().waitFor()
  const picker = (): Playwright.Locator => page.getByRole('group', { name: /^Recurring items for/ })
  const activeId = (): Promise<string> => page.evaluate(() => document.activeElement?.id ?? '')
  const suggest = page.locator('.recur-linkbtn--suggest')
  // The matches arrive after the rows, so wait for the first dot before deciding there is none.
  await suggest.first().waitFor({ timeout: 5000 }).catch(() => undefined)
  if ((await suggest.count()) === 0) {
    check(`${tag}: the seeded household has a suggestion on the first page`, false, 'no suggestion to open')
    return
  }

  // Not this: the picker stays open, focus stays inside it, and the toast says what happened.
  await suggest.first().click()
  await picker().waitFor()
  await page.getByRole('button', { name: / is not / }).first().click()
  check(`${tag}: Not this says what it did`, await waitToast(page, /^Marked '.+' as not .+\.$/), await toastTexts(page))
  check(`${tag}: the picker is still open after the toast`, (await picker().count()) === 1)
  // The controls are disabled while the request runs and the picker is read again afterwards, so focus is back
  // inside it a moment after the toast, not at the same instant: wait for it to settle rather than sample once.
  const focusInside = await page.waitForFunction(() => {
    const el = document.querySelector('[role="group"][aria-label^="Recurring items for"]')
    return el !== null && el.contains(document.activeElement)
  }, undefined, { timeout: 3000 }).then(() => true, () => false)
  check(`${tag}: focus is still inside the picker`, focusInside, await page.evaluate(() => document.activeElement?.tagName ?? ''))

  // Close: focus goes to Link, and the toast is still there.
  await picker().getByRole('button', { name: 'Close' }).click()
  await picker().waitFor({ state: 'detached' })
  check(`${tag}: Close puts focus on Link`, (await activeId()).startsWith('recur-link-'), await activeId())
  check(`${tag}: the toast stays after the picker closed`, (await toastTexts(page)).some((t) => t.startsWith('Marked ')))

  // Match: the picker closes and the toast raised after it leaves focus on Link. Try the Link buttons in turn
  // until one picker offers a Match (a suggestion's picker does; a row with nothing to offer does not).
  let matched = false
  const links = page.locator('.recur-linkbtn')
  for (let i = 0; i < Math.min(await links.count(), 15) && !matched; i++) {
    await links.nth(i).click()
    await picker().waitFor()
    const match = picker().getByRole('button', { name: /^Match / }).first()
    if ((await match.count()) === 0) {
      await picker().getByRole('button', { name: 'Close' }).click()
      await picker().waitFor({ state: 'detached' })
      continue
    }
    matched = true
    await match.click()
    check(`${tag}: Match says what it did`, await waitToast(page, /^Matched '.+' to .+\.$/), await toastTexts(page))
    await picker().waitFor({ state: 'detached' })
    await sleep(300)
    check(`${tag}: the toast raised after the picker closed left focus on Link`, (await activeId()).startsWith('recur-link-'), await activeId())
  }
  if (!matched) check(`${tag}: a picker with a Match button to try`, false, 'none of the first 15 rows offers one')
}

async function main(): Promise<void> {
  const mod = await import(process.env['PLAYWRIGHT_CORE'] ?? 'playwright-core') as typeof Playwright & { default?: typeof Playwright }
  const pw = mod.chromium === undefined && mod.default !== undefined ? mod.default : mod
  const server = await startServer()
  try { await run(pw, server.base) } finally { await server.close() }
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  console.log(JSON.stringify(measurements, null, 2))
  const report = process.env['BROWSER_CHECK_OUT']
  if (report !== undefined) writeFileSync(report, JSON.stringify({ checks, measurements }, null, 2))
  if (failed.length > 0) process.exit(1)
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
