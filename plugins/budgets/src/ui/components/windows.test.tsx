import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Category, MonthLine, MonthResponse } from '../models/index.js'
import { BudgetLinesTable } from './BudgetLinesTable.js'
import { WindowForm } from './WindowForm.js'

const money = (v: string) => `$${v}`
const date = (v: string) => `<${v}>`

const gifts: MonthLine = {
  id: 'w1', categoryId: 'c-gifts', categoryName: 'Gifts', planned: '0.0000', carriedIn: '1300.0000',
  available: '1300.0000', spent: '300.0000', remaining: '1000.0000', rollover: false,
  used: 0.5 / 1.5, pace: 0.6, elapsed: 0.55, health: 'ahead', note: 'Christmas', draft: false,
  window: { start: '2026-10-01', through: '2026-12-25', funded: '1500.0000', spentToDate: '500.0000' },
}

const groceries: MonthLine = {
  id: 'l1', categoryId: 'c-groc', categoryName: 'Groceries', planned: '400.0000', carriedIn: '0.0000',
  available: '400.0000', spent: '100.0000', remaining: '300.0000', rollover: false,
  used: 0.25, pace: 0.5, elapsed: 0.5, health: 'ahead', note: null, draft: false, window: null,
}

const month = (lines: MonthLine[]): MonthResponse => ({
  monthKey: '2026-11', period: { start: '2026-11-01', end: '2026-12-01' }, today: '2026-11-15', draft: false,
  lines, unbudgeted: [],
  summary: {
    planned: '400.0000', available: '1700.0000', spent: '400.0000', remaining: '1300.0000',
    unbudgetedSpent: '0.0000', overCount: 0, atRiskCount: 0,
  },
})

describe('a window in the lines table', () => {
  function renderTable(onRemove = vi.fn(), onEditWindow = vi.fn()) {
    render(
      <BudgetLinesTable
        month={month([gifts, groceries])}
        edits={{}}
        busy={false}
        formatMoney={money}
        formatDate={date}
        onEditPlan={vi.fn()}
        onSave={vi.fn()}
        onRemove={onRemove}
        onEditWindow={onEditWindow}
      />,
    )
    return { onRemove, onEditWindow }
  }

  it('shows its dates and how much of the whole pot is spent so far', () => {
    renderTable()
    expect(screen.getByText(/<2026-10-01> – <2026-12-25>/)).toBeTruthy()
    expect(screen.getByText(/\$500\.0000 of \$1500\.0000 spent/)).toBeTruthy()
  })

  it('is not edited inline and has no rollover box', () => {
    renderTable()
    expect(screen.queryByLabelText('Planned for Gifts')).toBeNull()
    expect(screen.queryByLabelText('Gifts rolls over')).toBeNull()
    expect(screen.getByLabelText('Planned for Groceries')).toBeTruthy()
  })

  it('offers Edit and Remove window', () => {
    const { onRemove, onEditWindow } = renderTable()
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Remove window'))
    expect(onEditWindow).toHaveBeenCalledWith(gifts)
    expect(onRemove).toHaveBeenCalledWith(gifts)
  })

  it('labels its bar with the whole window', () => {
    renderTable()
    expect(screen.getByLabelText('Gifts: $500.0000 of $1500.0000 spent so far')).toBeTruthy()
  })
})

describe('the window form', () => {
  const categories: Category[] = [
    { id: 'c-gifts', name: 'Gifts', parent_id: null },
    { id: 'c-groc', name: 'Groceries', parent_id: null },
  ]

  it('starts a new window on the first of the month shown and sends what was typed', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <WindowForm categories={categories} monthKey="2026-10" editing={null} busy={false} onSave={onSave} onCancel={vi.fn()} />,
    )

    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-10-01')
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-12-25' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: ' 1500.00 ' } })
    fireEvent.click(screen.getByText('Add window'))

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({
      id: null, categoryId: 'c-gifts', start: '2026-10-01', through: '2026-12-25', planned: '1500.00', note: null,
    }))
  })

  it('keeps Add disabled until it has an end date and an amount', () => {
    render(
      <WindowForm categories={categories} monthKey="2026-10" editing={null} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    )
    expect((screen.getByText('Add window') as HTMLButtonElement).disabled).toBe(true)
  })

  it('prefills from the window being edited and saves it by id', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onCancel = vi.fn()
    render(
      <WindowForm categories={categories} monthKey="2026-11" editing={gifts} busy={false} onSave={onSave} onCancel={onCancel} />,
    )

    expect(screen.getByText('Edit the Gifts window')).toBeTruthy()
    expect((screen.getByLabelText('Through') as HTMLInputElement).value).toBe('2026-12-25')
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('1500.00')
    fireEvent.click(screen.getByText('Save window'))

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', note: 'Christmas' })))
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled())
  })
})
