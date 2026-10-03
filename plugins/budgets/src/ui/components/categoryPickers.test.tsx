import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Category, MonthLine } from '../models/index.js'
import { AddLineForm } from './AddLineForm.js'
import { WindowForm } from './WindowForm.js'

// Out of display order on purpose: the API sends one flat list and the
// grouping is the picker's job.
const categories: Category[] = [
  { id: 'gifts', name: 'Gifts', parent_id: 'holiday' },
  { id: 'food', name: 'Food', parent_id: null },
  { id: 'groceries', name: 'Groceries', parent_id: 'food' },
  { id: 'holiday', name: 'Holiday', parent_id: null },
  { id: 'dining', name: 'Dining out', parent_id: 'food' },
  { id: 'rent', name: 'Rent', parent_id: null },
]

const groupsOf = (select: HTMLElement) =>
  [...select.querySelectorAll('optgroup')].map((g) => [
    g.label,
    [...g.querySelectorAll('option')].map((o) => o.textContent),
  ])

describe('the add-a-line picker', () => {
  it('groups categories under their parents and leaves out ones already in the month', () => {
    const groceries = { categoryId: 'groceries' } as MonthLine
    render(<AddLineForm categories={categories} lines={[groceries]} busy={false} onAdd={vi.fn()} />)

    const select = screen.getByLabelText('Add a category')
    expect(groupsOf(select)).toEqual([
      ['Food', ['Food', 'Dining out']],
      ['Holiday', ['Holiday', 'Gifts']],
    ])
    expect(within(select).getByRole('option', { name: 'Rent' })).toBeTruthy()
    expect(within(select).queryByRole('option', { name: 'Groceries' })).toBeNull()
  })

  it('preselects the first category the dropdown shows', () => {
    render(<AddLineForm categories={categories} lines={[]} busy={false} onAdd={vi.fn()} />)
    expect((screen.getByLabelText('Add a category') as HTMLSelectElement).value).toBe('food')
  })
})

describe('the window form picker', () => {
  it('groups categories under their parents', () => {
    render(
      <WindowForm categories={categories} monthKey="2026-10" editing={null} busy={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    )
    const select = screen.getByLabelText('Category')
    expect(groupsOf(select)).toEqual([
      ['Food', ['Food', 'Groceries', 'Dining out']],
      ['Holiday', ['Holiday', 'Gifts']],
    ])
    expect((select as HTMLSelectElement).value).toBe('food')
  })
})
