import { expect, expectNoProblems, PERSONAS, test, type ApiClient, type PersonaKey } from '../fixtures/index.js'

/** One plugin as `GET /api/v1/plugins` lists it: the manifest, plus where its UI runs. */
interface ListedPlugin {
  id: string
  name: string
  bundled: boolean
  runtime: 'in-realm' | 'isolated'
  contributes: {
    pages: { path: string; title: string; nav?: { label: string } }[]
    widgets: { id: string; title: string }[]
  }
}

async function listPlugins(client: ApiClient): Promise<ListedPlugin[]> {
  const { plugins, failures } = await client.get<{ plugins: ListedPlugin[]; failures: unknown[] }>('/api/v1/plugins')
  expect(failures, 'plugins that failed to load').toEqual([])
  return plugins
}

test.describe('fresh stack', () => {
  test('is healthy, migrated and seeded', async ({ request, api }) => {
    const health = await request.get('/healthz')
    expect(health.ok()).toBe(true)
    // /readyz also reaches the database, so it proves the app role and the migrations.
    expect((await request.get('/readyz')).ok()).toBe(true)

    // The seed ran: every documented persona signs in.
    for (const persona of Object.keys(PERSONAS) as PersonaKey[]) {
      const client = await api(persona)
      expect(client.userId).toMatch(/[0-9a-f-]{36}/)
    }

    // The bundled plugins registered on first boot, and none failed to load.
    const hero = await api('hero')
    const plugins = await listPlugins(hero)
    expect(plugins.filter((p) => p.bundled).map((p) => p.id)).toEqual(
      expect.arrayContaining(['wickermoney.insights', 'wickermoney.budgets', 'wickermoney.forecast', 'wickermoney.debt-payoff']),
    )
  })
})

test.describe('sign-in and the pages that matter', () => {
  test('hero signs in and reaches the dashboard', async ({ page, signIn }) => {
    await signIn('hero')
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  })

  test('household reaches the forecast page, which runs in a frame', async ({ page, signIn, watch }) => {
    await signIn('household')
    const seen = watch()
    await page.locator('nav a[href="/p/wickermoney.forecast/forecast"]').first().click()
    // Forecast is an isolated plugin: the page's own heading is inside the sandboxed frame, which the host titles
    // "<plugin name> · <page title>".
    const frame = page.frameLocator('iframe[title="Forecast · Forecast"]')
    await expect(frame.getByRole('heading', { level: 1, name: 'Forecast' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expectNoProblems(seen)
  })

  test('household reaches the debt payoff page, which runs in a frame', async ({ page, signIn, watch }) => {
    await signIn('household')
    const seen = watch()
    await page.locator('nav a[href="/p/wickermoney.debt-payoff/debt-payoff"]').first().click()
    // Debt payoff is an isolated plugin too: its heading is inside the sandboxed frame.
    const frame = page.frameLocator('iframe[title="Debt Payoff · Debt payoff"]')
    await expect(frame.getByRole('heading', { level: 1, name: 'Debt payoff' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expectNoProblems(seen)
  })
})

test.describe('bundled plugins', () => {
  test('every in-realm plugin page loads without console errors or failed requests', async ({ page, signIn, api, watch }) => {
    // The list comes from the running app (bundled.ts through the API), not from
    // this file: plugins move between runtimes from release to release.
    const plugins = (await listPlugins(await api('hero'))).filter((p) => p.bundled && p.runtime === 'in-realm')
    const pages = plugins.flatMap((p) => p.contributes.pages.map((pg) => ({ plugin: p, page: pg })))
    expect(pages.length, 'in-realm plugin pages found').toBeGreaterThan(0)

    await signIn('hero')
    const seen = watch()
    for (const { plugin, page: pluginPage } of pages) {
      const href = `/p/${plugin.id}/${pluginPage.path}`
      // In-app navigation, not page.goto: a full load spends a refresh-token
      // request and the auth rate limit is shared by every spec.
      await page.locator(`nav a[href="${href}"]`).first().click()
      await expect(page.getByRole('heading', { name: pluginPage.title }).first(), `${plugin.id} page "${pluginPage.title}"`).toBeVisible()
      await page.waitForLoadState('networkidle')
    }
    expectNoProblems(seen)
  })

  test('the dashboard loads every widget, and the isolated ones run in frames with no console errors or CSP violations', async ({ page, signIn, api, watch }) => {
    const plugins = (await listPlugins(await api('hero'))).filter((p) => p.bundled)
    const widgets = plugins.flatMap((p) => p.contributes.widgets.map((w) => ({ plugin: p, widget: w })))
    const isolated = widgets.filter((w) => w.plugin.runtime === 'isolated')
    expect(isolated.map((w) => w.plugin.id), 'bundled plugins whose widgets are isolated').toEqual(
      expect.arrayContaining(['wickermoney.insights', 'wickermoney.spending-trends']),
    )

    await signIn('hero')
    const seen = watch()
    await page.locator('nav a[href="/"]').first().click()

    for (const { plugin, widget } of widgets) {
      const card = page.getByRole('heading', { name: widget.title, exact: true }).first()
      // A widget below the fold may not exist yet (frames can be created as they
      // approach the viewport), so bring each into view before looking for it.
      await card.scrollIntoViewIfNeeded()
      await expect(card, `${plugin.id} widget "${widget.title}"`).toBeVisible()
    }

    for (const { plugin, widget } of isolated) {
      // The host titles each frame "<plugin name> · <widget title>".
      const frameTitle = `${plugin.name} · ${widget.title}`
      const frame = page.locator(`iframe[title="${frameTitle}"]`)
      await frame.scrollIntoViewIfNeeded()
      await expect(frame, `frame for ${plugin.id} "${widget.title}"`).toHaveCount(1)
      // The widget rendered something inside the frame: the handshake completed
      // and it was given its context. An empty frame or a "could not load"
      // notice has no chart, table or empty-state text.
      const body = page.frameLocator(`iframe[title="${frameTitle}"]`).locator('body')
      await expect(body, `content of ${widget.title}`).not.toBeEmpty()
      await expect(body.getByText(/could not|failed|error/i), `error text in ${widget.title}`).toHaveCount(0)
    }
    await page.waitForLoadState('networkidle')
    expectNoProblems(seen)
  })
})

interface AccountRow { id: string; name: string }
interface TransactionRow { id: string }

test.describe('tenant isolation, from outside', () => {
  test('hero cannot read household data through the API or the UI', async ({ page, signIn, api }) => {
    const household = await api('household')
    const hero = await api('hero')

    const householdAccounts = await household.get<AccountRow[]>('/api/v1/accounts')
    expect(householdAccounts.length).toBeGreaterThan(0)
    const heroAccounts = await hero.get<AccountRow[]>('/api/v1/accounts')
    const heroIds = new Set(heroAccounts.map((a) => a.id))

    for (const account of householdAccounts) {
      expect(heroIds.has(account.id), `hero's account list contains household account ${account.name}`).toBe(false)
      // By id, directly: a tenant boundary answers "not found", not the row.
      expect(await hero.status(`/api/v1/accounts/${account.id}`), `hero reading household account ${account.name}`).toBe(404)
    }

    const householdTx = await household.get<{ items: TransactionRow[] }>('/api/v1/transactions?limit=50')
    const heroTx = await hero.get<{ items: TransactionRow[] }>('/api/v1/transactions?limit=200')
    expect(householdTx.items.length).toBeGreaterThan(0)
    const heroTxIds = new Set(heroTx.items.map((t) => t.id))
    for (const t of householdTx.items) expect(heroTxIds.has(t.id), `household transaction ${t.id} in hero's list`).toBe(false)
    const first = householdTx.items[0]
    if (first === undefined) throw new Error('the household has no transactions')
    expect(await hero.status(`/api/v1/transactions/${first.id}/splits`), 'hero reading a household transaction').toBe(404)

    // And the UI says the same: an account only the household has never shows up for hero.
    const heroNames = new Set(heroAccounts.map((a) => a.name))
    const onlyHousehold = householdAccounts.find((a) => !heroNames.has(a.name))
    if (onlyHousehold === undefined) throw new Error('the household has no account name hero lacks')
    await signIn('hero')
    await page.locator('nav a[href="/accounts"]').first().click()
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
    await expect(page.getByText(heroAccounts[0]?.name ?? '', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(onlyHousehold.name, { exact: true })).toHaveCount(0)
  })
})

/** "$43,613.32" or "-$1.00" as a number of cents, so two readings can be subtracted exactly. */
function cents(text: string): number {
  const negative = text.includes('-') || text.includes('(')
  const digits = text.replace(/[^0-9.]/g, '')
  return Math.round(Number(digits) * 100) * (negative ? -1 : 1)
}

test.describe('golden path', () => {
  test('a transaction added in the UI appears in the ledger and moves the dashboard', async ({ page, signIn }) => {
    // Unique per run (and per retry), so the row is found whatever else is in the ledger.
    const merchant = `E2E coffee ${Date.now()}`
    const account = 'Everyday Checking'
    // Upcoming runs in a sandboxed frame, so its figure is in the frame's document, not the page's. The widget is
    // the first card on the dashboard, so its frame starts at once; the locator waits for it.
    const safeToSpend = page.frameLocator('iframe[title="Upcoming · Until payday"]')
      .locator('.upc-head').filter({ hasText: 'Safe to spend' }).locator('.upc-head__value')

    await signIn('hero')
    await expect(safeToSpend).toBeVisible()
    const before = cents(await safeToSpend.innerText())

    await page.locator('nav a[href="/transactions"]').first().click()
    await page.getByRole('button', { name: 'Add transaction' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Account').selectOption({ label: account })
    await dialog.getByLabel('Merchant').fill(merchant)
    await dialog.getByLabel('Amount').fill('-123.45')
    // The Date field defaults to today in the browser's zone (UTC here).
    await dialog.getByRole('button', { name: 'Record' }).click()
    await expect(dialog.getByRole('status')).toContainText('Recorded')
    await dialog.getByRole('button', { name: /close/i }).click()

    await expect(page.getByRole('row', { name: new RegExp(merchant) })).toBeVisible()

    // The dashboard's "Until payday" widget counts the account, so its figure drops by the amount.
    await page.locator('nav a[href="/"]').first().click()
    await expect(safeToSpend).toBeVisible()
    await expect.poll(async () => before - cents(await safeToSpend.innerText())).toBe(12345)
  })
})
