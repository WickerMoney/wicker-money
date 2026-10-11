import { expect } from 'vitest'
import { addDays } from '@wickermoney/plugin-sdk/date'
import { auth, type Harness, type TestUser } from './harness.js'

/**
 * @module
 * Builds a household that has a row in every table that holds user data, using
 * the real API, so what an erase has to remove is what a real user would have
 * made. Used by the erase tests; a table nobody can reach through the API is
 * exactly the kind of table the "every table is handled" test should fail on.
 */

const BUDGETS = 'wickermoney.budgets'
const IMPORT = 'wickermoney.import-csv'
const DEBTS = 'wickermoney.debt-payoff'

/** Ids of the main things a {@link seedHousehold} call created. */
export interface Household {
  readonly checkingId: string
  readonly savingsId: string
  readonly groceriesId: string
  readonly transactionId: string
  readonly billId: string
}

async function call(
  h: Harness, user: TestUser, method: 'POST' | 'PUT', url: string, payload: Record<string, unknown>, plugin?: string,
): Promise<Record<string, unknown>> {
  const res = await h.app.inject({
    method, url, payload,
    headers: { ...auth(user), ...(plugin === undefined ? {} : { 'x-wickermoney-plugin': plugin }) },
  })
  if (res.statusCode >= 300) throw new Error(`${method} ${url} failed: ${res.statusCode} ${res.body}`)
  return res.json() as Record<string, unknown>
}

/**
 * Gives `user` at least one row in every table the schema has for user data:
 * accounts, a category and a child category, a rule with a condition, a split
 * transaction, a recurring bill with an overridden occurrence and a dismissed
 * suggestion, a budget line and an account allowance, a debt and its payoff settings, an import with its saved
 * mapping and batch, a finished setup wizard and (because the user signed in) a
 * session.
 *
 * @param h - The running harness.
 * @param user - A user from `createUser`.
 * @param label - Text woven into names, so two households can be told apart.
 * @returns Ids of the main rows.
 */
export async function seedHousehold(h: Harness, user: TestUser, label: string): Promise<Household> {
  // Category slugs allow lowercase letters, digits and hyphens only.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const checking = await call(h, user, 'POST', '/api/v1/accounts', { name: `${label} checking`, accountType: 'checking', initialBalance: '1000.00' })
  const savings = await call(h, user, 'POST', '/api/v1/accounts', { name: `${label} savings`, accountType: 'savings', initialBalance: '500.00' })
  const checkingId = checking['id'] as string
  const savingsId = savings['id'] as string

  const groceries = await call(h, user, 'POST', '/api/v1/categories', { name: `${label} groceries`, slug: `groceries-${slug}` })
  const groceriesId = groceries['id'] as string
  const produce = await call(h, user, 'POST', '/api/v1/categories', { name: `${label} produce`, slug: `produce-${slug}`, parentId: groceriesId })

  await call(h, user, 'POST', '/api/v1/category-rules', {
    categoryId: groceriesId, priority: 0,
    conditions: [{ conditionType: 'merchant_contains', textValue: `${label}-rule` }],
  })

  const today = await todayFor(h, user)
  const tx = await call(h, user, 'POST', '/api/v1/transactions', {
    accountId: checkingId, amount: '-90.00', merchant: `${label} shop`, transactionDate: addDays(today, -30), categoryId: groceriesId,
  })
  await call(h, user, 'PUT', `/api/v1/transactions/${tx['id']}/splits`, {
    splits: [
      { amount: '-60.00', categoryId: groceriesId },
      { amount: '-30.00', categoryId: produce['id'] as string },
    ],
  })

  // A bill due two days ago, a payment that looks like it, and a dismissed match between them.
  const due = addDays(today, -2)
  const bill = await call(h, user, 'POST', '/api/v1/recurring-items', {
    name: `${label} internet`, kind: 'bill', frequency: 'monthly', seriesStartDate: due,
    legs: [{ accountId: checkingId, amount: '-80.00' }],
  })
  const billId = bill['id'] as string
  const payment = await call(h, user, 'POST', '/api/v1/transactions', {
    accountId: checkingId, amount: '-78.00', merchant: `${label} isp`, transactionDate: addDays(today, -1),
  })
  // Recording a different amount for the occurrence creates the occurrence and its legs.
  await call(h, user, 'PUT', `/api/v1/recurring-items/${billId}/occurrences/${due}`, {
    skipped: false, legs: [{ accountId: checkingId, amount: '-85.00' }],
  })
  await call(h, user, 'POST', `/api/v1/recurring-items/${billId}/occurrences/${due}/dismissals`, { transactionId: payment['id'] as string })

  await call(h, user, 'PUT', `/api/v1/p/${BUDGETS}/line`, { month: '2031-03', categoryId: groceriesId, planned: '400.0000', rollover: false }, BUDGETS)
  await call(h, user, 'PUT', `/api/v1/p/${BUDGETS}/account-line`, { month: '2031-03', accountId: checkingId, planned: '150.00' }, BUDGETS)

  const card = await call(h, user, 'POST', '/api/v1/accounts', { name: `${label} card`, accountType: 'credit_card', initialBalance: '0.00' })
  await call(h, user, 'POST', `/api/v1/p/${DEBTS}/debts`, {
    name: `${label} card`, balance: '1000.00', apr: '12', minimumPayment: '100.00', accountId: card['id'] as string,
  }, DEBTS)
  await call(h, user, 'PUT', `/api/v1/p/${DEBTS}/settings`, { strategy: 'snowball', extraPayment: '50' }, DEBTS)

  await call(h, user, 'POST', `/api/v1/p/${IMPORT}/mappings`, {
    sourceName: `${label} Saved Bank`,
    columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
    dateFormat: 'MM/DD/YYYY', amountStyle: 'signed', invertAmount: false,
  }, IMPORT)
  await call(h, user, 'POST', `/api/v1/p/${IMPORT}/commit`, {
    accountId: checkingId, fileName: `${label}.csv`,
    csv: `Date,Description,Amount,Id\n03/04/2026,${label} IMPORTED,-4.50,${label}-1`,
    sourceName: `${label} Bank`,
    columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
    dateFormat: 'MM/DD/YYYY', amountStyle: 'signed', invertAmount: false,
  }, IMPORT)

  await call(h, user, 'POST', '/api/v1/onboarding/complete', { situations: [] })

  return { checkingId, savingsId, groceriesId, transactionId: tx['id'] as string, billId }
}

/** The user's "today" as the API reports it, so dates relative to it match the server's idea of the present. */
async function todayFor(h: Harness, user: TestUser): Promise<string> {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/recurring-items', headers: auth(user) })
  expect(res.statusCode).toBe(200)
  return (res.json() as { today: string }).today
}
