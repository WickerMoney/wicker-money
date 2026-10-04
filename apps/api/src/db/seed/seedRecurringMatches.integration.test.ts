import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServices } from '../../composition/createServices.js'
import type { Services } from '../../composition/Services.js'
import { KyselyUnitOfWork } from '../../data/KyselyUnitOfWork.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../../testing/harness.js'
import { accountDefsFor, createAccounts } from './seedAccounts.js'
import { PERSONAS } from './seedPersonas.js'
import { createRecurringItems, recurringItemDefsFor } from './seedRecurringItems.js'
import { LAWN_SERVICE, seedRecurringMatches, type SeededMatches } from './seedRecurringMatches.js'

/**
 * The household persona's matching demo: seeded on a fresh test user exactly
 * as `pnpm seed` does it, then read back through the API the pages use.
 */

let h: Harness
let user: TestUser
let seeded: SeededMatches
let ids: Map<string, string>

interface Occurrence { itemId: string; name: string; nominalDate: string; status: string }

async function get<T>(url: string): Promise<T> {
  const res = await h.app.inject({ method: 'GET', url, headers: auth(user) })
  expect(res.statusCode, res.body).toBe(200)
  return res.json() as T
}

beforeAll(async () => {
  h = await createHarness()
  const services: Services = createServices(h.db, new KyselyUnitOfWork(h.db), h.config)
  user = await createUser(h)
  const household = PERSONAS.find((p) => p.key === 'household')
  if (household === undefined) throw new Error('no household persona')
  const accountIds = await createAccounts(services.accounts, user.id, accountDefsFor(household))
  await createRecurringItems(h.db, user.id, recurringItemDefsFor('household'), accountIds, new Map())
  seeded = await seedRecurringMatches(services, user.id, accountIds, new Map())
  const list = await get<{ items: { id: string; name: string }[] }>('/api/v1/recurring-items')
  ids = new Map(list.items.map((i) => [i.name, i.id]))
})

afterAll(async () => {
  await h.close()
})

describe('the household matching demo', () => {
  it('shows cleared, late and skipped occurrences', async () => {
    const lawn = ids.get(LAWN_SERVICE) as string
    const status = async (itemId: string, date: string) =>
      (await get<Occurrence>(`/api/v1/recurring-items/${itemId}/occurrences/${date}`)).status

    expect(seeded.cleared).toHaveLength(4)
    for (const c of seeded.cleared) expect(await status(ids.get(c.item) as string, c.nominalDate)).toBe('cleared')
    expect(await status(lawn, seeded.late)).toBe('late')
    expect(await status(lawn, seeded.skipped)).toBe('skipped')
  })

  it('offers Sam’s paycheck as a suggestion and lists the dismissed one for undo', async () => {
    const list = await get<{
      suggestions: { occurrence: Occurrence; candidate: { transactionId: string } }[]
      dismissed: { occurrence: Occurrence; transaction: { id: string } }[]
    }>('/api/v1/recurring-items/suggestions')
    expect(list.suggestions.map((s) => [s.occurrence.name, s.candidate.transactionId]))
      .toEqual([['Sam Paycheck', seeded.suggestedTransactionId]])
    expect(list.dismissed.map((d) => [d.occurrence.name, d.occurrence.nominalDate, d.transaction.id]))
      .toEqual([[LAWN_SERVICE, seeded.late, seeded.dismissedTransactionId]])
  })

  it('shows the same on the Transactions page', async () => {
    const page = await get<{ items: { id: string }[] }>('/api/v1/transactions?limit=50')
    const matches = await get<{ transactions: { transactionId: string; linked: Occurrence | null; suggestion: unknown; dismissed: Occurrence[] }[] }>(
      `/api/v1/recurring-items/transaction-matches?transactionIds=${page.items.map((t) => t.id).join(',')}`,
    )
    const byId = new Map(matches.transactions.map((t) => [t.transactionId, t]))
    expect(page.items).toHaveLength(8)
    expect(matches.transactions.filter((t) => t.linked !== null)).toHaveLength(6)
    expect(byId.get(seeded.suggestedTransactionId)?.suggestion).not.toBeNull()
    expect(byId.get(seeded.dismissedTransactionId)?.dismissed.map((o) => o.name)).toEqual([LAWN_SERVICE])
  })
})
