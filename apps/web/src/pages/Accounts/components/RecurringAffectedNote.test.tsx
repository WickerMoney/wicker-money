import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RecurringItem } from '../../../models/index.js'
import { RecurringAffectedNote } from './RecurringAffectedNote.js'

function item(id: string, name: string, kind: RecurringItem['kind'], accounts: string[]): RecurringItem {
  return {
    id, name, kind, frequency: 'monthly', seriesStartDate: '2026-01-01', endDate: null, semimonthlyDays: null,
    categoryId: null, amount: '1.0000', monthlyEquivalent: '1.0000', nextDue: '2026-10-01', tracked: false, late: [],
    legs: accounts.map((accountId, i) => ({ accountId, amount: kind === 'income' ? '1.0000' : i === 0 ? '-1.0000' : '1.0000' })),
  }
}

const items = [
  item('rent', 'Rent', 'bill', ['a']),
  item('split', 'Paycheck', 'income', ['a', 'b']),
  item('move', 'To savings', 'transfer', ['a', 'b']),
  item('card', 'Card payment', 'debt_payment', ['a', 'c']),
]

describe('RecurringAffectedNote', () => {
  it('names every item and warns that deleting removes each whole', () => {
    render(<RecurringAffectedNote accountName="Checking" items={items} moveTo={null} />)
    for (const name of ['Rent', 'Paycheck', 'To savings', 'Card payment']) expect(screen.getByText(name)).toBeTruthy()
    expect(screen.getByText(/removes each of these entirely/)).toBeTruthy()
    expect(screen.getAllByText(/also uses another account/)).toHaveLength(3)
  })

  it('says what a move does to each item', () => {
    render(<RecurringAffectedNote accountName="Checking" items={items} moveTo={{ id: 'b', name: 'Savings' }} />)
    const text = (name: string) => screen.getByText(name).closest('li')?.textContent ?? ''
    expect(text('Rent')).toContain('moves to Savings')
    expect(text('Paycheck')).toContain('combined into Savings')
    expect(text('To savings')).toContain('removed')
    expect(text('Card payment')).toContain('moves to Savings')
  })

  it('renders nothing when no recurring item uses the account', () => {
    const { container } = render(<RecurringAffectedNote accountName="Checking" items={[]} moveTo={null} />)
    expect(container.innerHTML).toBe('')
  })
})
