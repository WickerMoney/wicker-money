import { describe, expect, it } from 'vitest'
import type { Query } from '@wickermoney/plugin-sdk/server'
import { BudgetService } from '../service/BudgetService.js'
import { QueryBudgetUnitOfWork } from './QueryBudgetUnitOfWork.js'

/**
 * How many statements a month request sends through the real `Query*`
 * repositories, and what the ledger reads are asked for. The query runner is a
 * recorder that answers from canned rows, so no database is needed; the SQL
 * itself is exercised by the API's integration tests.
 *
 * Guards against the request growing a ledger scan per window, and against
 * re-reading the current month or categories that do not roll over.
 */

const USER = 'user-1'
const NOW = new Date('2026-10-10T12:00:00Z')
const cat = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface Recorded {
  readonly sql: string
  readonly values: readonly unknown[]
}

/** A runner that records every statement and answers the budgets reads from fixed rows. */
function recorder(windows: number, rolling: readonly string[]): { q: Query; seen: Recorded[] } {
  const seen: Recorded[] = []
  const q = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?')
    seen.push({ sql, values })
    if (sql.includes('FROM core.categories')) {
      return [...rolling, ...Array.from({ length: windows }, (_, i) => cat(100 + i))].map((id) => ({ id, name: id, parent_id: null }))
    }
    if (sql.includes('NOT (period_start = date_trunc')) {
      return Array.from({ length: windows }, (_, i) => ({
        id: `window-${i}`, category_id: cat(100 + i), period_start: '2026-08-15', period_end: '2026-12-21',
        planned: '900.0000', note: null,
      }))
    }
    if (sql.includes('period_start = ?::date') && sql.includes('FROM plugin_budgets.budget_lines')) {
      return rolling.map((id) => ({ id: `line-${id}`, category_id: id, period_start: '2026-10-01', planned: '100.0000', rollover: true, note: null }))
    }
    if (sql.includes('ORDER BY category_id, period_start') && sql.includes('rollover')) {
      return rolling.flatMap((id) =>
        ['2026-08-01', '2026-09-01', '2026-10-01'].map((period_start) => ({ category_id: id, period_start, planned: '100.0000', rollover: true })),
      )
    }
    return []
  }) as Query
  return { q, seen }
}

async function monthRequest(windows: number, rolling: readonly string[]) {
  const { q, seen } = recorder(windows, rolling)
  const uow = new QueryBudgetUnitOfWork((_userId, work) => work(q))
  await new BudgetService(uow, () => NOW).getMonth(USER, '2026-10', 'UTC')
  return { seen, ledger: seen.filter((s) => s.sql.includes('core.transactions')) }
}

describe('getMonth statements', () => {
  it.each([0, 1, 3, 8])('reads the ledger a fixed number of times with %i windows', async (windows) => {
    const { seen, ledger } = await monthRequest(windows, [cat(1), cat(2)])
    // The month's spend, the earlier months of the rolling categories, and
    // (when there are windows) one query for all of them.
    expect(ledger).toHaveLength(windows === 0 ? 2 : 3)
    expect(seen).toHaveLength(windows === 0 ? 8 : 9)
  })

  it('asks for every window in one query, as a before and a month range each', async () => {
    const { ledger } = await monthRequest(3, [])
    const windowQuery = ledger.find((s) => s.sql.includes('jsonb_to_recordset'))!
    const ranges = JSON.parse(windowQuery.values[0] as string) as { key: string; category_id: string; from_date: string; to_date: string }[]

    expect(ranges).toHaveLength(6)
    expect(ranges.filter((r) => r.key.endsWith(':before'))).toEqual([0, 1, 2].map((i) => ({
      key: `window-${i}:before`, category_id: cat(100 + i), from_date: '2026-08-15', to_date: '2026-10-01',
    })))
    expect(ranges.filter((r) => r.key.endsWith(':now'))).toEqual([0, 1, 2].map((i) => ({
      key: `window-${i}:now`, category_id: cat(100 + i), from_date: '2026-10-01', to_date: '2026-11-01',
    })))
  })

  it('leaves out of the window query a range that is empty', async () => {
    // Starts after the month opens, so there is no "before"; a month it does not reach has no "now".
    const { q, seen } = recorder(0, [])
    const starting: Query = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('NOT (period_start = date_trunc')) {
        return [{ id: 'w', category_id: cat(100), period_start: '2026-10-15', period_end: '2026-10-20', planned: '10.0000', note: null }]
      }
      return q(strings, ...values)
    }) as Query
    const uow = new QueryBudgetUnitOfWork((_u, work) => work(starting))
    await new BudgetService(uow, () => NOW).getMonth(USER, '2026-10', 'UTC')

    const windowQuery = seen.find((s) => s.sql.includes('jsonb_to_recordset'))!
    expect(JSON.parse(windowQuery.values[0] as string)).toEqual([
      { key: 'w:now', category_id: cat(100), from_date: '2026-10-15', to_date: '2026-10-20' },
    ])
  })

  it('reads earlier months only, and only the rolling categories, for the carry-forward', async () => {
    const rolling = [cat(1), cat(2)]
    const { ledger } = await monthRequest(2, rolling)
    const history = ledger.find((s) => s.sql.includes('to_char(transaction_date') && s.values.some((v) => Array.isArray(v) && v.length > 0))!

    // Range ends where the month starts: the month itself comes from the one read of the whole month.
    expect(history.values).toContain('2024-10-01')
    expect(history.values).toContain('2026-10-01')
    expect(history.values).not.toContain('2026-11-01')
    expect(history.values.filter((v) => Array.isArray(v))).toEqual([rolling, rolling])
  })

  it('does not read earlier months at all when nothing rolls over', async () => {
    const { ledger } = await monthRequest(2, [])
    expect(ledger).toHaveLength(2)
  })
})
