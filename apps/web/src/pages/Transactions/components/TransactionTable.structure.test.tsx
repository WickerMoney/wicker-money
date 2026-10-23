import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useActionStatus } from '../../../hooks/useActionStatus.js'
import type { RecurringOccurrence, Transaction, TransactionMatchSummary } from '../../../models/index.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import type { TransactionMatches } from '../hooks/useTransactionMatches.js'
import { TransactionTable } from './TransactionTable.js'

/**
 * What the table's CSS relies on. The layouts themselves (the seven-column
 * table, the three-line rows at tablet widths, the phone cards) are placed by
 * `data-col`, measured by a container query on `.txn-list`, and read in DOM
 * order; none of that can be tested without a browser, so these tests hold the
 * markup the CSS and the screen readers depend on.
 */

function occurrence(over: Partial<RecurringOccurrence>): RecurringOccurrence {
  return {
    itemId: 'phone', date: '2026-10-01', nominalDate: '2026-10-01', expectedDate: '2026-10-01', status: 'cleared',
    moved: false, changed: false, name: 'Phone', kind: 'bill', categoryId: null, amount: '-55.0000',
    legs: [{ accountId: 'chk', amount: '-55.0000', transaction: null }], ...over,
  }
}

const items: Transaction[] = [
  makeTransaction({ id: 'a', merchant: 'Oakwood Phone', amount: '-55.00', transaction_date: '2026-10-01' }),
  makeTransaction({ id: 'b', merchant: 'Coffee', amount: '-4.50', transaction_date: '2026-10-02' }),
]

const linked: TransactionMatchSummary = { transactionId: 'a', linked: occurrence({}), suggestion: null, dismissed: [] }

function makeMatches(): TransactionMatches {
  const noop = vi.fn(async () => undefined)
  return {
    byId: new Map([['a', linked]]), picker: null,
    openPicker: noop, closePicker: vi.fn(), confirm: noop, match: noop, unmatch: noop, dismiss: noop, undismiss: noop,
  }
}

const matches = makeMatches()
const onChanged = async () => undefined

function Harness({ withMatches = true, onToggleAll = () => undefined }: {
  withMatches?: boolean
  onToggleAll?: () => void
}) {
  const status = useActionStatus()
  return (
    <TransactionTable
      items={items} selected={new Set()} onlyUncategorized={false} categoryOptionsFor={() => []} status={status}
      {...(withMatches ? { matches } : {})}
      onToggleSelected={() => undefined} onToggleAllSelected={onToggleAll} onChanged={onChanged}
    />
  )
}

const COLUMNS = ['sel', 'date', 'merchant', 'cat', 'amt', 'recur', 'actions']

describe('TransactionTable structure', () => {
  it('names the table and gives every header cell a scope and something to announce', () => {
    render(<Harness />)
    const table = screen.getByRole('table', { name: 'Transactions' })
    const headers = [...table.querySelectorAll('thead th')]
    expect(headers).toHaveLength(COLUMNS.length)
    for (const th of headers) {
      expect(th.getAttribute('scope')).toBe('col')
      const announced = (th.textContent ?? '').trim() !== '' || th.querySelector('[aria-label]') !== null
      expect(announced).toBe(true)
    }
    // The column of buttons is announced as "Actions" even though nothing shows it.
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'Recurring' })).toBeTruthy()
  })

  it('keeps the cells in one order, which the layouts place by data-col and the keyboard follows', () => {
    render(<Harness />)
    const table = screen.getByRole('table', { name: 'Transactions' })
    expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('data-col'))).toEqual(COLUMNS)
    for (const tr of table.querySelectorAll('tbody tr')) {
      expect([...tr.querySelectorAll('td')].map((td) => td.getAttribute('data-col'))).toEqual(COLUMNS)
    }
  })

  it('leaves the Recurring column out without matches, and the other columns in their order', () => {
    render(<Harness withMatches={false} />)
    const table = screen.getByRole('table', { name: 'Transactions' })
    expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('data-col')))
      .toEqual(['sel', 'date', 'merchant', 'cat', 'amt', 'actions'])
  })

  it('puts the select-all and the table in the one wrapper the container query measures', () => {
    const { container } = render(<Harness />)
    const wrapper = container.querySelector('.txn-list')
    expect(wrapper).not.toBeNull()
    const selectAll = wrapper!.querySelector('.txn-select-all')
    const scroller = wrapper!.querySelector('.txn-table')
    expect(selectAll).not.toBeNull()
    expect(scroller).not.toBeNull()
    // The label comes first, so it is first in the tab order when a layout shows it.
    expect(selectAll!.compareDocumentPosition(scroller!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('selects every row from the visible select-all and from the header checkbox', async () => {
    const onToggleAll = vi.fn()
    render(<Harness onToggleAll={onToggleAll} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }))
    expect(onToggleAll).toHaveBeenCalledTimes(2)
  })

  it('tabs through a row as the cells run: checkbox, category, recurring, then Edit and Delete', async () => {
    render(<Harness />)
    const row = screen.getByRole('checkbox', { name: 'Select Oakwood Phone' }).closest('tr')!
    const inRow = within(row)
    await userEvent.click(inRow.getByRole('checkbox', { name: 'Select Oakwood Phone' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(inRow.getByRole('combobox', { name: 'Category for Oakwood Phone' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(inRow.getByRole('button', { name: 'Unmatch Oakwood Phone from Phone' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(inRow.getByRole('button', { name: 'Edit' }))
    await userEvent.tab()
    expect(document.activeElement).toBe(inRow.getByRole('button', { name: 'Delete' }))
  })
})
