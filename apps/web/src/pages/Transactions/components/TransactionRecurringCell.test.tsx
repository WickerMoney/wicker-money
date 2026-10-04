import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { useActionStatus } from '../../../hooks/useActionStatus.js'
import type {
  RecurringOccurrence, Transaction, TransactionCandidates, TransactionMatchList,
} from '../../../models/index.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { useTransactionMatches } from '../hooks/useTransactionMatches.js'
import { TransactionTable } from './TransactionTable.js'

function occurrence(over: Partial<RecurringOccurrence>): RecurringOccurrence {
  return {
    itemId: 'rent', date: '2026-10-01', nominalDate: '2026-10-01', expectedDate: '2026-10-01', status: 'late',
    moved: false, changed: false, name: 'Rent', kind: 'bill', categoryId: null, amount: '-1550.0000',
    legs: [{ accountId: 'chk', amount: '-1550.0000', transaction: null }], ...over,
  }
}

const candidate = {
  transactionId: 'suggested', date: '2026-10-02', amount: '-1550.0000', merchant: 'CHECK #1042',
  dayDifference: 1, amountDifference: '0.0000', confident: true,
}

const items: Transaction[] = [
  makeTransaction({ id: 'paid', merchant: 'Oakwood Rent', amount: '-1550.00' }),
  makeTransaction({ id: 'suggested', merchant: 'CHECK #1042', amount: '-1550.00' }),
  makeTransaction({ id: 'garden', merchant: 'Garden Centre', amount: '-42.00', transaction_date: '2026-10-02' }),
  makeTransaction({ id: 'coffee', merchant: 'Coffee', amount: '-4.50', transaction_date: '2026-10-03' }),
]

const summaries: TransactionMatchList = {
  today: '2026-10-04',
  transactions: [
    { transactionId: 'paid', linked: occurrence({ itemId: 'phone', name: 'Phone', status: 'cleared' }), suggestion: null, dismissed: [] },
    { transactionId: 'suggested', linked: null, suggestion: { occurrence: occurrence({}), accountId: 'chk', candidate }, dismissed: [] },
    { transactionId: 'garden', linked: null, suggestion: null, dismissed: [occurrence({ itemId: 'lawn', name: 'Lawn Service' })] },
  ],
}

const picker: TransactionCandidates = {
  today: '2026-10-04',
  transactionId: 'coffee',
  linked: null,
  candidates: [{
    occurrence: occurrence({ itemId: 'cafe', name: 'Coffee Club', amount: '-5.0000', legs: [{ accountId: 'chk', amount: '-5.0000', transaction: null }] }),
    accountId: 'chk',
    candidate: { ...candidate, transactionId: 'coffee', amount: '-4.5000', dayDifference: 2, confident: true },
    dismissed: false,
  }],
}

/** The table as the panel wires it: the matching hook fed the listed rows. */
function Harness({ rows }: { rows: readonly Transaction[] }) {
  const status = useActionStatus()
  const matches = useTransactionMatches(rows, status)
  return (
    <TransactionTable
      items={rows} selected={new Set()} onlyUncategorized={false} categoryOptionsFor={() => []} status={status}
      matches={matches} onToggleSelected={() => {}} onToggleAllSelected={() => {}} onChanged={async () => {}}
    />
  )
}

function serve() {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/recurring-items/transaction-matches?')) return summaries
    if (path === '/recurring-items/transaction-matches/coffee') return picker
    throw new Error(`unexpected GET ${path}`)
  })
}

/** The table row showing a merchant. */
async function rowOf(merchant: string): Promise<HTMLElement> {
  const cell = await screen.findByText(merchant)
  return cell.closest('tr') as HTMLElement
}

afterEach(() => { vi.restoreAllMocks() })

describe('recurring matches on the Transactions page', () => {
  it('asks once for the whole page, not once per row', async () => {
    const get = serve()
    render(<Harness rows={items} />)
    await screen.findByText(/Looks like/)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]?.[0]).toBe('/recurring-items/transaction-matches?transactionIds=paid,suggested,garden,coffee')
  })

  it('confirms a suggested match', async () => {
    const get = serve()
    const post = vi.spyOn(api, 'post').mockResolvedValue(occurrence({ status: 'cleared' }))
    const user = userEvent.setup()
    render(<Harness rows={items} />)
    const row = await rowOf('CHECK #1042')
    expect(within(row).getByText('Rent')).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: 'Match CHECK #1042 to Rent' }))
    expect(post).toHaveBeenCalledWith('/recurring-items/rent/occurrences/2026-10-01/matches', { transactionId: 'suggested' })
    // The column is re-read; the list itself is not.
    await waitFor(() => { expect(get).toHaveBeenCalledTimes(2) })
  })

  it('dismisses a suggestion, and undoes a dismissal', async () => {
    serve()
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<Harness rows={items} />)

    await user.click(await screen.findByRole('button', { name: 'CHECK #1042 is not Rent' }))
    expect(post).toHaveBeenCalledWith('/recurring-items/rent/occurrences/2026-10-01/dismissals', { transactionId: 'suggested' })

    const garden = await rowOf('Garden Centre')
    expect(within(garden).getByText(/Not Lawn Service/)).toBeTruthy()
    await user.click(within(garden).getByRole('button', { name: 'Undo: Garden Centre is not Lawn Service' }))
    expect(del).toHaveBeenCalledWith('/recurring-items/lawn/occurrences/2026-10-01/dismissals/garden')
  })

  it('unmatches a linked transaction', async () => {
    serve()
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<Harness rows={items} />)
    const row = await rowOf('Oakwood Rent')
    expect(within(row).getByText('Phone')).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: 'Unmatch Oakwood Rent from Phone' }))
    expect(del).toHaveBeenCalledWith('/recurring-items/phone/occurrences/2026-10-01/matches/paid')
  })

  it('lists the occurrences a transaction could be and matches the one picked', async () => {
    const get = serve()
    const post = vi.spyOn(api, 'post').mockResolvedValue({})
    const user = userEvent.setup()
    render(<Harness rows={items} />)

    await user.click(await screen.findByRole('button', { name: 'Match Coffee to a recurring item' }))
    expect(get).toHaveBeenCalledWith('/recurring-items/transaction-matches/coffee')
    const list = await screen.findByRole('list', { name: 'Recurring items Coffee could be' })
    expect(within(list).getByText(/Coffee Club/)).toBeTruthy()
    expect(within(list).getByText(/2 days late/)).toBeTruthy()

    await user.click(within(list).getByRole('button', { name: 'Match to Coffee Club 2026-10-01' }))
    expect(post).toHaveBeenCalledWith('/recurring-items/cafe/occurrences/2026-10-01/matches', { transactionId: 'coffee' })
    await waitFor(() => { expect(screen.queryByRole('list', { name: 'Recurring items Coffee could be' })).toBeNull() })
  })

  it('shows the API message when a match is refused', async () => {
    serve()
    vi.spyOn(api, 'post').mockRejectedValue(new Error('That leg of this occurrence is already matched. Unmatch it first.'))
    const user = userEvent.setup()
    function WithStatus() {
      const status = useActionStatus()
      const matches = useTransactionMatches(items, status)
      return (
        <>
          {status.message !== null ? <p role="alert">{status.message}</p> : null}
          <TransactionTable
            items={items} selected={new Set()} onlyUncategorized={false} categoryOptionsFor={() => []} status={status}
            matches={matches} onToggleSelected={() => {}} onToggleAllSelected={() => {}} onChanged={async () => {}}
          />
        </>
      )
    }
    render(<WithStatus />)
    await user.click(await screen.findByRole('button', { name: 'Match CHECK #1042 to Rent' }))
    expect((await screen.findByRole('alert')).textContent).toContain('already matched')
  })
})
