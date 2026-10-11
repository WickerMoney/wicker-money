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
  it.each([0, 1, 5, 50])('reads the debts and the settings once each with %i debts', async (debts) => {
    const seen = await planRequest(debts, {})
    expect(seen).toHaveLength(2)
    expect(seen.filter((s) => s.sql.includes('FROM plugin_debt_payoff.debts'))).toHaveLength(1)
    expect(seen.filter((s) => s.sql.includes('FROM plugin_debt_payoff.plan_settings'))).toHaveLength(1)
  })

  it('does not read the settings when the request names both the strategy and the extra', async () => {
    const seen = await planRequest(20, { strategy: 'snowball', extraPayment: '25.0000' })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.sql).toContain('FROM plugin_debt_payoff.debts')
  })

  it('reads the settings when only one of the two is named', async () => {
    expect(await planRequest(3, { strategy: 'snowball' })).toHaveLength(2)
    expect(await planRequest(3, { extraPayment: '25.0000' })).toHaveLength(2)
  })

  it('writes nothing', async () => {
    const seen = await planRequest(5, {})
    expect(seen.filter((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.sql))).toEqual([])
  })
})

describe('the tables the repositories touch', () => {
  /** Every relation named after FROM, JOIN, INTO or UPDATE in a statement. */
  function relations(sql: string): string[] {
    return [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+\.[a-z_]+)/gi)].map((m) => (m[1] ?? '').toLowerCase())
  }

  it('are the plugin\'s own two and core accounts, and nothing else', async () => {
    const { q, seen } = recorder(2)
    const { debts, settings, accounts } = createDebtRepositories(q)
    const row = { name: 'x', balance: '1', apr: '1', minimumPayment: '1', accountId: null, sortOrder: 0, archived: false }
    await Promise.all([
      debts.list(true), debts.find('a'), debts.findForUpdate('a'), debts.countActive(),
      debts.insert({ ...row, sortOrder: undefined }), debts.replace('a', row), debts.delete('a'), debts.listAll(),
      settings.get(), settings.save('1', 'snowball'), settings.getForExport(),
      accounts.find('a'), accounts.listLiabilities(),
    ])

    const touched = new Set(seen.flatMap((s) => relations(s.sql)))
    expect([...touched].sort()).toEqual(['core.accounts', 'plugin_debt_payoff.debts', 'plugin_debt_payoff.plan_settings'])
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
