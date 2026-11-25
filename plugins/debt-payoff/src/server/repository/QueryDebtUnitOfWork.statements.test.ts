import type { Query } from '@wickermoney/plugin-sdk/server'
import { describe, expect, it } from 'vitest'
import { DebtPayoffService } from '../service/DebtPayoffService.js'
import { createDebtRepositories } from './createDebtRepositories.js'
import { QueryDebtUnitOfWork } from './QueryDebtUnitOfWork.js'

/**
 * How many statements a plan request sends through the real `Query*`
 * repositories, and which tables every repository statement touches. The query
 * runner is a recorder that answers from canned rows, so no database is
 * needed; the SQL itself is exercised by the API's integration tests.
 *
 * Guards against the plan growing a read per debt, and against the plugin ever
 * reaching a table it was not granted (another plugin's, or the ledger).
 */

const USER = 'user-1'
const NOW = new Date('2026-10-10T12:00:00Z')

interface Recorded {
  readonly sql: string
  readonly values: readonly unknown[]
}

function debtRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: `Debt ${i}`,
    balance: '1000.0000', apr: '12.0000', minimum_payment: '50.0000', account_id: null, sort_order: i, archived: false,
  }))
}

/** A runner that records every statement and answers the debt payoff reads from fixed rows. */
function recorder(debts: number): { q: Query; seen: Recorded[] } {
  const seen: Recorded[] = []
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    seen.push({ sql, values })
    if (sql.includes('FROM plugin_debt_payoff.lump_sums')) return []
    if (sql.includes('FROM plugin_debt_payoff.debts')) return debtRows(debts)
    if (sql.includes('FROM plugin_debt_payoff.plan_settings')) return [{ extra_payment: '100.0000', strategy: 'snowball' }]
    return []
  }) as Query
  return { q, seen }
}

async function planRequest(debts: number, request: { strategy?: 'snowball'; extraPayment?: string }) {
  const { q, seen } = recorder(debts)
  const uow = new QueryDebtUnitOfWork((_userId, work) => work(q))
  await new DebtPayoffService(uow, () => NOW).getPlan(USER, { timezone: 'UTC', ...request })
  return seen
}

describe('plan statements', () => {
  it.each([0, 1, 5, 50])('reads the debts, the lump sums and the settings once each with %i debts', async (debts) => {
    const seen = await planRequest(debts, {})
    expect(seen).toHaveLength(3)
    expect(seen.filter((s) => s.sql.includes('FROM plugin_debt_payoff.debts'))).toHaveLength(1)
    expect(seen.filter((s) => s.sql.includes('FROM plugin_debt_payoff.lump_sums'))).toHaveLength(1)
    expect(seen.filter((s) => s.sql.includes('FROM plugin_debt_payoff.plan_settings'))).toHaveLength(1)
  })

  it('reads every lump sum and its allocations in one statement, however many there are', async () => {
    const seen: Recorded[] = []
    const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      seen.push({ sql, values })
      if (sql.includes('FROM plugin_debt_payoff.lump_sums')) {
        return Array.from({ length: 200 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, on_date: '2027-01-15', amount: '10.0000', note: '',
          allocations: [{ debt_id: debtRows(1)[0]?.id, amount: '5.0000' }],
        }))
      }
      if (sql.includes('FROM plugin_debt_payoff.debts')) return debtRows(3)
      return [{ extra_payment: '0.0000', strategy: 'avalanche' }]
    }) as Query
    await new DebtPayoffService(new QueryDebtUnitOfWork((_userId, work) => work(q)), () => NOW).getPlan(USER, { timezone: 'UTC' })
    expect(seen).toHaveLength(3)
  })

  it('does not read the settings when the request names both the strategy and the extra', async () => {
    const seen = await planRequest(20, { strategy: 'snowball', extraPayment: '25.0000' })
    expect(seen).toHaveLength(2)
    expect(seen.some((s) => s.sql.includes('FROM plugin_debt_payoff.plan_settings'))).toBe(false)
  })

  it('reads the settings when only one of the two is named', async () => {
    expect(await planRequest(3, { strategy: 'snowball' })).toHaveLength(3)
    expect(await planRequest(3, { extraPayment: '25.0000' })).toHaveLength(3)
  })

  it('writes nothing', async () => {
    const seen = await planRequest(5, {})
    expect(seen.filter((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.sql))).toEqual([])
  })
})

describe('reordering', () => {
  it.each([1, 5, 50])('writes once however many debts there are (%i): a read, one UPDATE, a read', async (count) => {
    const { q, seen } = recorder(count)
    const ids = debtRows(count).map((d) => d.id)
    await new DebtPayoffService(new QueryDebtUnitOfWork((_userId, work) => work(q)), () => NOW).reorderDebts(USER, ids)

    expect(seen).toHaveLength(3)
    const writes = seen.filter((s) => /\bUPDATE\b/i.test(s.sql))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.values).toEqual([ids])
    expect(writes[0]?.sql).toContain('unnest(')
  })
})

describe('the tables the repositories touch', () => {
  /** Every relation named after FROM, JOIN, INTO or UPDATE in a statement. */
  function relations(sql: string): string[] {
    return [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+\.[a-z_]+)/gi)].map((m) => (m[1] ?? '').toLowerCase())
  }

  it('are the plugin\'s own four and core accounts, and nothing else', async () => {
    const { q, seen } = recorder(2)
    const { debts, lumpSums, settings, accounts } = createDebtRepositories(q)
    const row = { name: 'x', balance: '1', apr: '1', minimumPayment: '1', accountId: null, sortOrder: 0, archived: false, included: true, extraPayment: '0',
      repaymentStartsOn: null, promoApr: null, promoEndsOn: null, promoDeferredInterest: false, promoInterestBase: 'original' as const, compounding: 'monthly' as const }
    // allSettled: the recorder answers no rows, so a lump sum's insert reports it was not saved after sending its statements.
    await Promise.allSettled([
      debts.list(true), debts.find('a'), debts.findForUpdate('a'), debts.countActive(),
      debts.insert({ ...row, sortOrder: undefined }), debts.replace('a', row), debts.reorder(['a', 'b']), debts.delete('a'), debts.listAll(),
      lumpSums.list(), lumpSums.find('a'), lumpSums.count(), lumpSums.listAll(), lumpSums.delete('a'),
      lumpSums.insert({ onDate: '2027-01-15', amount: '1', note: '', allocations: [{ debtId: 'a', amount: '1' }] }),
      lumpSums.replace('a', { onDate: '2027-01-15', amount: '1', note: '', allocations: [{ debtId: 'a', amount: '1' }] }),
      settings.get(), settings.save('1', 'snowball'), settings.getForExport(),
      accounts.find('a'), accounts.listLiabilities(),
    ])

    const touched = new Set(seen.flatMap((s) => relations(s.sql)))
    expect([...touched].sort()).toEqual([
      'core.accounts', 'plugin_debt_payoff.debts', 'plugin_debt_payoff.lump_sum_allocations',
      'plugin_debt_payoff.lump_sums', 'plugin_debt_payoff.plan_settings',
    ])
    expect(seen.every((s) => !/plugin_(budgets|import_csv)/.test(s.sql))).toBe(true)
  })

  it('never write to core accounts', async () => {
    const { q, seen } = recorder(1)
    const { accounts } = createDebtRepositories(q)
    await accounts.find('a')
    await accounts.listLiabilities()
    expect(seen.every((s) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(s.sql))).toBe(true)
  })
})
