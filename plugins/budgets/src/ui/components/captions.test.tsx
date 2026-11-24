import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AccountLine, MonthLine, MonthResponse } from '../models/index.js'
import { AccountLinesTable } from './AccountLinesTable.js'
import { BudgetLinesTable } from './BudgetLinesTable.js'
import { UnbudgetedPanel } from './UnbudgetedPanel.js'

const money = (v: string) => `$${v}`

const groceries: MonthLine = {
  id: 'l1', categoryId: 'c-groc', categoryName: 'Groceries', planned: '400.0000', carriedIn: '0.0000',
  available: '400.0000', spent: '100.0000', remaining: '300.0000', rollover: false,
  used: 0.25, pace: 0.5, elapsed: 0.5, health: 'ahead', note: null, draft: false, window: null,
}

const allowance: AccountLine = {
  id: 'al1', accountId: 'a-joint', accountName: 'Joint Checking', categoryId: 'account:a-joint',
  categoryName: 'Joint Checking spending', planned: '150.0000', carriedIn: '0.0000', available: '150.0000',
  spent: '60.0000', remaining: '90.0000', rollover: false, used: 0.4, pace: 1, elapsed: 0.3,
  health: 'on-track', excludedCategoryIds: [], note: null, draft: false,
}

const month: MonthResponse = {
  monthKey: '2026-11', period: { start: '2026-11-01', end: '2026-12-01' }, today: '2026-11-15', draft: false,
  lines: [groceries], unbudgeted: [{ categoryId: 'c-pets', categoryName: 'Pets', spent: '25.0000' }],
  summary: {
    planned: '400.0000', available: '400.0000', spent: '125.0000', remaining: '300.0000',
    unbudgetedSpent: '25.0000', overCount: 0, atRiskCount: 0,
  },
}

describe('the Budgets tables are named', () => {
  it('names the lines table', () => {
    render(
      <BudgetLinesTable
        month={month} edits={{}} busy={false} formatMoney={money} formatDate={(d) => d}
        onEditPlan={vi.fn()} onSave={vi.fn()} onRemove={vi.fn()} onEditWindow={vi.fn()}
      />,
    )
    expect(screen.getByRole('table', { name: 'Budget lines' })).toBeTruthy()
  })

  it('names the allowances table', () => {
    render(
      <AccountLinesTable
        lines={[allowance]} monthKey="2026-11" today="2026-11-15" busy={false}
        categoryName={() => 'x'} formatMoney={money} onEdit={vi.fn()} onRemove={vi.fn()}
      />,
    )
    expect(screen.getByRole('table', { name: 'Account allowances' })).toBeTruthy()
  })

  it('names the unbudgeted table', () => {
    render(<UnbudgetedPanel month={month} formatMoney={money} />)
    expect(screen.getByRole('table', { name: 'Spent with no budget' })).toBeTruthy()
  })
})
