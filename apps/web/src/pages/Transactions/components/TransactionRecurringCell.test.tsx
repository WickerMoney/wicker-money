import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { useActionStatus } from '../../../hooks/useActionStatus.js'
import type {
  RecurringOccurrence, Transaction, TransactionCandidate, TransactionCandidates, TransactionMatchList,
  TransactionMatchSummary,
} from '../../../models/index.js'
import { deferred } from '../../../testing/deferred.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { renderWithToasts } from '../../../testing/renderWithToasts.js'
import { shownToasts } from '../../../testing/shownToasts.js'
import { useTransactionMatches } from '../hooks/useTransactionMatches.js'
import { TransactionTable } from './TransactionTable.js'

function occurrence(over: Partial<RecurringOccurrence>): RecurringOccurrence {
  return {
    itemId: 'rent', date: '2026-10-01', nominalDate: '2026-10-01', expectedDate: '2026-10-01', status: 'late',
    moved: false, changed: false, name: 'Rent', kind: 'bill', categoryId: null, amount: '-1550.0000',
    legs: [{ accountId: 'chk', amount: '-1550.0000', transaction: null }], ...over,
  }
}

const candidateOf = (transactionId: string, dayDifference = 1) => ({
  transactionId, date: '2026-10-02', amount: '-1550.0000', merchant: transactionId,
  dayDifference, amountDifference: '0.0000', confident: true,
})

const rent = occurrence({})
const lawn = occurrence({ itemId: 'lawn', name: 'Lawn Service', nominalDate: '2026-10-21', expectedDate: '2026-10-21' })
const pool = occurrence({ itemId: 'pool', name: 'Pool Maintenance', nominalDate: '2026-10-19', expectedDate: '2026-10-19' })
const club = occurrence({
  itemId: 'club', name: 'Garden Club Dues', nominalDate: '2026-10-27', expectedDate: '2026-10-27', amount: '-40.0000',
  legs: [{ accountId: 'chk', amount: '-40.0000', transaction: null }],
})
const LONG = 'Quarterly estimated federal and state income tax payment (joint)'

const row = (id: string, merchant: string, transaction_date = '2026-10-02') =>
  makeTransaction({ id, merchant, amount: '-10.00', transaction_date })

const items: Transaction[] = [
  row('same', 'Oakwood Phone', '2026-10-01'),
  row('late', 'Oakwood Rent', '2026-10-03'),
  row('long', 'IRS Payment', '2026-10-15'),
  row('suggested', 'CHECK #1042'),
  row('garden', 'Garden Centre'),
  row('coffee', 'Coffee', '2026-10-03'),
  row('none', 'Newsstand'),
]

const candidate = (o: RecurringOccurrence, tx: string, dismissed = false): TransactionCandidate => ({
  occurrence: o, accountId: 'chk', candidate: candidateOf(tx), dismissed,
})

/** What the server holds; the mocked API reads and edits it, so a refresh shows the effect of an action. */
interface World {
  summaries: Map<string, TransactionMatchSummary>
  pickers: Map<string, TransactionCandidates>
}

function makeWorld(): World {
  const summary = (transactionId: string, over: Partial<TransactionMatchSummary>): [string, TransactionMatchSummary] =>
    [transactionId, { transactionId, linked: null, suggestion: null, dismissed: [], ...over }]
  const picker = (transactionId: string, candidates: TransactionCandidate[], linked: RecurringOccurrence | null = null):
    [string, TransactionCandidates] => [transactionId, { today: '2026-10-04', transactionId, linked, candidates }]
  return {
    summaries: new Map([
      summary('same', { linked: occurrence({ itemId: 'phone', name: 'Phone', nominalDate: '2026-10-01', status: 'cleared' }) }),
      summary('late', { linked: rent }),
      summary('long', { linked: occurrence({ itemId: 'tax', name: LONG, nominalDate: '2026-10-14' }) }),
      summary('suggested', {
        suggestion: { occurrence: rent, accountId: 'chk', candidate: candidateOf('suggested') }, dismissed: [lawn],
      }),
      summary('garden', { dismissed: [lawn, pool] }),
    ]),
    pickers: new Map([
      picker('suggested', [candidate(rent, 'suggested'), candidate(club, 'suggested'), candidate(pool, 'suggested', true)]),
      picker('garden', [candidate(pool, 'garden', true)]),
      picker('coffee', [candidate(occurrence({ itemId: 'cafe', name: 'Coffee Club', amount: '-5.0000', legs: [{ accountId: 'chk', amount: '-5.0000', transaction: null }] }), 'coffee')]),
      picker('same', [], occurrence({ itemId: 'phone', name: 'Phone', nominalDate: '2026-10-01', status: 'cleared' })),
      picker('none', []),
    ]),
  }
}

/** The table as the panel wires it: the matching hook fed the listed rows. */
function Harness({ rows = items }: { rows?: readonly Transaction[] }) {
  const status = useActionStatus()
  const matches = useTransactionMatches(rows, status)
  return (
    <>
      <TransactionTable
        items={rows} selected={new Set()} onlyUncategorized={false} categoryOptionsFor={() => []} status={status}
        matches={matches} onToggleSelected={() => {}} onToggleAllSelected={() => {}} onChanged={async () => {}}
      />
    </>
  )
}

function serve(world = makeWorld()) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/recurring-items/transaction-matches?')) {
      return { today: '2026-10-04', transactions: [...world.summaries.values()] } satisfies TransactionMatchList
    }
    const id = /\/transaction-matches\/(.+)$/.exec(path)?.[1]
    const picker = id === undefined ? undefined : world.pickers.get(id)
    if (picker !== undefined) return picker
    throw new Error(`unexpected GET ${path}`)
  })
  return { get, world }
}

/** The table row showing a merchant. */
async function rowOf(merchant: string): Promise<HTMLElement> {
  const cell = await screen.findByText(merchant)
  return cell.closest('tr') as HTMLElement
}
const recurCell = (r: HTMLElement) => r.querySelector('td[data-col="recur"]') as HTMLElement
const linkIn = (r: HTMLElement) => within(r).getByRole('button', { name: /^(Link|Change recurring item for) / })
const pickerOf = (merchant: string) => screen.getByRole('group', { name: `Recurring items for ${merchant}` })

afterEach(() => { vi.restoreAllMocks() })

describe('recurring column and picker on the Transactions page', () => {
  it('asks once for the whole page, not once per row, and never fetches a picker until asked', async () => {
    const { get } = serve()
    renderWithToasts(<Harness />)
    await screen.findByText('Phone')
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]?.[0]).toBe('/recurring-items/transaction-matches?transactionIds=same,late,long,suggested,garden,coffee,none')
  })

  describe('the cell', () => {
    it('is empty for every unmatched row, whatever it has: nothing, a suggestion, dismissals', async () => {
      serve()
      renderWithToasts(<Harness />)
      await screen.findByText('Phone')
      for (const merchant of ['CHECK #1042', 'Garden Centre', 'Coffee', 'Newsstand']) {
        const r = await rowOf(merchant)
        expect(recurCell(r).childNodes).toHaveLength(0)
      }
      expect(screen.queryByText(/Looks like/)).toBeNull()
      expect(screen.queryByText(/Not Lawn Service/)).toBeNull()
      expect(screen.queryByRole('button', { name: /is not/ })).toBeNull()
    })

    it('looks the same with zero, one or three dismissals', async () => {
      const world = makeWorld()
      world.summaries.set('none', { transactionId: 'none', linked: null, suggestion: null, dismissed: [lawn, pool, club] })
      serve(world)
      renderWithToasts(<Harness />)
      await screen.findByText('Phone')
      const none = await rowOf('Newsstand')
      expect(recurCell(none).childNodes).toHaveLength(0)
      expect(linkIn(none).getAttribute('aria-label')).toBe('Link Newsstand to a recurring item')
      expect(linkIn(none).className).not.toContain('--suggest')
    })

    it('shows the pill with its remove button, and no date when it is the transaction date', async () => {
      serve()
      renderWithToasts(<Harness />)
      const r = await rowOf('Oakwood Phone')
      const cell = within(recurCell(r))
      expect(cell.getByText('Phone')).toBeTruthy()
      expect(cell.getByRole('button', { name: 'Unmatch Oakwood Phone from Phone' })).toBeTruthy()
      expect(cell.queryByText(/Occurrence date/)).toBeNull()
      expect(recurCell(r).querySelector('.recur2__date')).toBeNull()
    })

    it('shows the occurrence date after the pill when it differs, with a hidden label for screen readers', async () => {
      serve()
      renderWithToasts(<Harness />)
      const r = await rowOf('Oakwood Rent')
      const date = recurCell(r).querySelector('.recur2__date') as HTMLElement
      expect(date.textContent).toBe('Occurrence date: 10/1/2026')
      expect(date.querySelector('.wm-visually-hidden')?.textContent).toBe('Occurrence date: ')
      // The date follows the pill in the same line.
      const line = recurCell(r).querySelector('.recur2__line') as HTMLElement
      expect([...line.children].map((c) => c.className.split(' ')[0])).toEqual(['recur2__chip', 'wm-muted'])
    })

    it('keeps a long item name whole in the title and the remove button name, and cuts it in CSS', async () => {
      serve()
      renderWithToasts(<Harness />)
      const r = await rowOf('IRS Payment')
      const chip = recurCell(r).querySelector('.recur2__chip') as HTMLElement
      expect(chip.getAttribute('title')).toBe(LONG)
      expect(chip.querySelector('.recur2__chip-name')?.textContent).toBe(LONG)
      expect(within(chip).getByRole('button', { name: `Unmatch IRS Payment from ${LONG}` })).toBeTruthy()
    })

    it('unmatches from the pill and gives focus to the Link button', async () => {
      const { world } = serve()
      const del = vi.spyOn(api, 'del').mockImplementation(async () => { world.summaries.delete('same') })
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Oakwood Phone')
      await user.click(within(r).getByRole('button', { name: 'Unmatch Oakwood Phone from Phone' }))
      expect(del).toHaveBeenCalledWith('/recurring-items/phone/occurrences/2026-10-01/matches/same')
      await waitFor(() => { expect(recurCell(r).childNodes).toHaveLength(0) })
      await waitFor(() => { expect(document.activeElement).toBe(linkIn(r)) })
      expect(linkIn(r).getAttribute('aria-label')).toBe('Link Oakwood Phone to a recurring item')
      // A plain confirmation, not a banner and not an Undo: Restore in the picker is the way back.
      await waitFor(() => { expect(shownToasts()).toEqual(["Unmatched 'Oakwood Phone' from Phone."]) })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
    })

    it('disables the pill and the Link button while a request is in flight', async () => {
      serve()
      const gate = deferred<unknown>()
      vi.spyOn(api, 'del').mockReturnValue(gate.promise as Promise<void>)
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Oakwood Phone')
      await user.click(within(r).getByRole('button', { name: 'Unmatch Oakwood Phone from Phone' }))
      await waitFor(() => { expect((linkIn(r) as HTMLButtonElement).disabled).toBe(true) })
      expect((within(r).getByRole('button', { name: 'Unmatch Oakwood Phone from Phone' }) as HTMLButtonElement).disabled).toBe(true)
      expect((within(r).getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
      gate.resolve(undefined)
      await waitFor(() => { expect((linkIn(r) as HTMLButtonElement).disabled).toBe(false) })
    })
  })

  describe('the Link button', () => {
    it('comes first in the row actions, before Edit and Delete', async () => {
      serve()
      renderWithToasts(<Harness />)
      const r = await rowOf('Newsstand')
      const names = [...r.querySelectorAll('td[data-col="actions"] button')].map((b) => b.getAttribute('aria-label'))
      expect(names).toEqual(['Link Newsstand to a recurring item', 'Edit', 'Delete'])
    })

    it('is neutral without a suggestion and accent with a dot (and says so in its name) with one', async () => {
      serve()
      renderWithToasts(<Harness />)
      await screen.findByText('Phone')
      const plain = linkIn(await rowOf('Newsstand'))
      expect(plain.className).toBe('wm-btn wm-icon-btn recur-linkbtn')
      const suggested = linkIn(await rowOf('CHECK #1042'))
      expect(suggested.className).toContain('recur-linkbtn--suggest')
      expect(suggested.getAttribute('aria-label')).toBe('Link CHECK #1042 to a recurring item (suggestion: Rent)')
      expect(suggested.getAttribute('title')).toBe(suggested.getAttribute('aria-label'))
      // Only dismissed candidates: neutral. Matched: neutral, and named for the change.
      expect(linkIn(await rowOf('Garden Centre')).className).not.toContain('--suggest')
      const matched = linkIn(await rowOf('Oakwood Phone'))
      expect(matched.className).not.toContain('--suggest')
      expect(matched.getAttribute('aria-label')).toBe('Change recurring item for Oakwood Phone (linked to Phone)')
    })

    it('opens the picker in its own row under the row, moves focus into it and says so with aria-expanded', async () => {
      const { get } = serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Coffee')
      const link = linkIn(r)
      expect(link.getAttribute('aria-expanded')).toBe('false')
      await user.click(link)
      expect(get).toHaveBeenCalledWith('/recurring-items/transaction-matches/coffee')
      const picker = await waitFor(() => pickerOf('Coffee'))
      expect(link.getAttribute('aria-expanded')).toBe('true')
      expect(link.getAttribute('aria-controls')).toBe(picker.id)
      // Its own row, directly under the row it belongs to, as wide as the table.
      expect(r.nextElementSibling?.className).toBe('wm-table__detail')
      expect(r.nextElementSibling?.contains(picker)).toBe(true)
      expect(r.className).toBe('wm-table__row--open')
      expect(document.activeElement).toBe(picker)
    })

    it('closes the picker when pressed again, and keeps focus on itself', async () => {
      serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Coffee')
      await user.click(linkIn(r))
      await waitFor(() => pickerOf('Coffee'))
      await user.click(linkIn(r))
      expect(screen.queryByRole('group', { name: /Recurring items for/ })).toBeNull()
      expect(document.activeElement).toBe(linkIn(r))
    })

    it('has one picker at a time', async () => {
      serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      await user.click(linkIn(await rowOf('Coffee')))
      await waitFor(() => pickerOf('Coffee'))
      await user.click(linkIn(await rowOf('Newsstand')))
      await waitFor(() => pickerOf('Newsstand'))
      expect(screen.getAllByRole('group', { name: /Recurring items for/ })).toHaveLength(1)
    })
  })

  describe('the picker', () => {
    it('lists the suggestion, then the other items, then the dismissed ones, then Close, in tab order', async () => {
      serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      await user.click(linkIn(await rowOf('CHECK #1042')))
      const picker = await waitFor(() => pickerOf('CHECK #1042'))
      const sections = [...picker.querySelectorAll('.recur2__section')].map((e) => e.textContent)
      expect(sections).toEqual(['Suggested', 'Other items it could be', 'Dismissed for this transaction'])
      const suggested = within(picker.querySelector('ul[aria-label="Suggested for CHECK #1042"]') as HTMLElement)
      expect(suggested.getByText('Rent')).toBeTruthy()
      // Dismissed: the summary's dismissals and the candidates flagged dismissed, once each.
      const dismissed = within(screen.getByRole('list', { name: 'Dismissed for CHECK #1042' }))
      expect(dismissed.getAllByRole('listitem').map((li) => li.textContent?.replace(/Restore$/, ''))).toEqual([
        'Not Lawn Service (10/21/2026)', 'Not Pool Maintenance (10/19/2026)',
      ])
      // The suggestion is not repeated among the others, and a dismissed candidate is not offered a Match.
      const others = within(screen.getByRole('list', { name: 'Recurring items CHECK #1042 could be' }))
      expect(others.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: 'Match to Pool Maintenance 2026-10-19' })).toBeNull()

      const order = [
        'Match CHECK #1042 to Rent', 'CHECK #1042 is not Rent', 'Match to Garden Club Dues 2026-10-27',
        'Restore Lawn Service 2026-10-21 as a suggestion for CHECK #1042',
        'Restore Pool Maintenance 2026-10-19 as a suggestion for CHECK #1042', 'Close',
      ]
      for (const name of order) {
        await user.tab()
        expect(document.activeElement).toBe(within(picker).getByRole('button', { name }))
      }
    })

    it('shows the other items with a Match each when nothing is suggested, and matches the one picked', async () => {
      serve()
      const post = vi.spyOn(api, 'post').mockResolvedValue({})
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Coffee')
      await user.click(linkIn(r))
      const list = await screen.findByRole('list', { name: 'Recurring items Coffee could be' })
      expect(screen.getByText('It could be')).toBeTruthy()
      expect(within(list).getByText(/Coffee Club/)).toBeTruthy()
      expect(within(list).getByText(/1 day late/)).toBeTruthy()

      await user.click(within(list).getByRole('button', { name: 'Match to Coffee Club 2026-10-01' }))
      expect(post).toHaveBeenCalledWith('/recurring-items/cafe/occurrences/2026-10-01/matches', { transactionId: 'coffee' })
      await waitFor(() => { expect(screen.queryByRole('group', { name: /Recurring items for/ })).toBeNull() })
      await waitFor(() => { expect(document.activeElement).toBe(linkIn(r)) })
    })

    it('confirms the suggestion with Match, closes, and returns focus to Link', async () => {
      const { get } = serve()
      const post = vi.spyOn(api, 'post').mockResolvedValue(occurrence({ status: 'cleared' }))
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('CHECK #1042')
      await user.click(linkIn(r))
      await user.click(await screen.findByRole('button', { name: 'Match CHECK #1042 to Rent' }))
      expect(post).toHaveBeenCalledWith('/recurring-items/rent/occurrences/2026-10-01/matches', { transactionId: 'suggested' })
      // The column is re-read; the list itself is not.
      await waitFor(() => { expect(get.mock.calls.filter((c) => String(c[0]).includes('transaction-matches?'))).toHaveLength(2) })
      await waitFor(() => { expect(screen.queryByRole('group', { name: /Recurring items for/ })).toBeNull() })
      await waitFor(() => { expect(document.activeElement).toBe(linkIn(r)) })
      // Raised after the picker closed: it said what happened and left focus on Link.
      await waitFor(() => { expect(shownToasts()).toEqual(["Matched 'CHECK #1042' to Rent."]) })
      expect(document.activeElement).toBe(linkIn(r))
    })

    it('dismisses with Not this, keeps the picker open and refreshed, and puts focus on its first control', async () => {
      const { world, get } = serve()
      const post = vi.spyOn(api, 'post').mockImplementation(async () => {
        const s = world.summaries.get('suggested')!
        world.summaries.set('suggested', { ...s, suggestion: null, dismissed: [...s.dismissed, rent] })
        world.pickers.set('suggested', {
          ...world.pickers.get('suggested')!,
          candidates: [candidate(rent, 'suggested', true), candidate(club, 'suggested'), candidate(pool, 'suggested', true)],
        })
        return {}
      })
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('CHECK #1042')
      await user.click(linkIn(r))
      await user.click(await screen.findByRole('button', { name: 'CHECK #1042 is not Rent' }))
      expect(post).toHaveBeenCalledWith('/recurring-items/rent/occurrences/2026-10-01/dismissals', { transactionId: 'suggested' })

      // Still open, now without a suggestion, with Rent among the dismissed.
      await waitFor(() => { expect(screen.queryByText('Suggested')).toBeNull() })
      const picker = pickerOf('CHECK #1042')
      expect(within(picker).getByRole('button', { name: 'Restore Rent 2026-10-01 as a suggestion for CHECK #1042' })).toBeTruthy()
      await waitFor(() => { expect(document.activeElement).toBe(within(picker).getByRole('button', { name: 'Match to Garden Club Dues 2026-10-27' })) })
      // The picker was read again, and the Link button lost its dot.
      expect(get.mock.calls.filter((c) => c[0] === '/recurring-items/transaction-matches/suggested')).toHaveLength(2)
      expect(linkIn(r).className).not.toContain('--suggest')
      expect(r.nextElementSibling?.className).toBe('wm-table__detail')
      // The toast did not close the picker or move focus out of it.
      expect(shownToasts()).toEqual(["Marked 'CHECK #1042' as not Rent."])
      expect(pickerOf('CHECK #1042').contains(document.activeElement)).toBe(true)
    })

    it('restores a dismissal with Restore and keeps the picker open', async () => {
      const { world } = serve()
      const del = vi.spyOn(api, 'del').mockImplementation(async () => {
        world.summaries.set('garden', { transactionId: 'garden', linked: null, suggestion: null, dismissed: [pool] })
      })
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      await user.click(linkIn(await rowOf('Garden Centre')))
      const picker = await waitFor(() => pickerOf('Garden Centre'))
      expect(within(picker).getAllByRole('button', { name: /^Restore / })).toHaveLength(2)
      await user.click(within(picker).getByRole('button', { name: 'Restore Lawn Service 2026-10-21 as a suggestion for Garden Centre' }))
      expect(del).toHaveBeenCalledWith('/recurring-items/lawn/occurrences/2026-10-21/dismissals/garden')
      await waitFor(() => { expect(within(pickerOf('Garden Centre')).getAllByRole('button', { name: /^Restore / })).toHaveLength(1) })
      await waitFor(() => { expect(document.activeElement).toBe(within(pickerOf('Garden Centre')).getByRole('button', { name: /^Restore Pool/ })) })
      expect(shownToasts()).toEqual(["'Garden Centre' can be suggested for Lawn Service again."])
    })

    it('replaces the toast of the last match action instead of stacking them', async () => {
      const { world } = serve()
      vi.spyOn(api, 'del').mockImplementation(async () => {
        world.summaries.set('garden', { transactionId: 'garden', linked: null, suggestion: null, dismissed: [pool] })
      })
      vi.spyOn(api, 'post').mockResolvedValue({})
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      await user.click(linkIn(await rowOf('Garden Centre')))
      const picker = await waitFor(() => pickerOf('Garden Centre'))
      await user.click(within(picker).getByRole('button', { name: 'Restore Lawn Service 2026-10-21 as a suggestion for Garden Centre' }))
      await waitFor(() => { expect(shownToasts()).toHaveLength(1) })

      await user.click(linkIn(await rowOf('CHECK #1042')))
      await user.click(await screen.findByRole('button', { name: 'Match CHECK #1042 to Rent' }))

      await waitFor(() => { expect(shownToasts()).toEqual(["Matched 'CHECK #1042' to Rent."]) })
    })

    it('says so when there is nothing to offer', async () => {
      serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      await user.click(linkIn(await rowOf('Newsstand')))
      const picker = await waitFor(() => pickerOf('Newsstand'))
      expect(within(picker).getByText('No recurring item expects this within 10 days of 10/2/2026.')).toBeTruthy()
      expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close'])
    })

    it('shows only the linked item, with Unmatch, for a matched row', async () => {
      const { world } = serve()
      const del = vi.spyOn(api, 'del').mockImplementation(async () => {
        world.summaries.delete('same')
        world.pickers.set('same', { today: '2026-10-04', transactionId: 'same', linked: null, candidates: [candidate(lawn, 'same')] })
      })
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Oakwood Phone')
      await user.click(linkIn(r))
      const picker = await waitFor(() => pickerOf('Oakwood Phone'))
      expect(within(picker).getByText('Unmatch it to choose a different item.')).toBeTruthy()
      expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Unmatch', 'Close'])

      // Unmatching from the picker keeps it open, now offering what the transaction could be.
      await user.click(within(picker).getByRole('button', { name: 'Unmatch Oakwood Phone from Phone' }))
      expect(del).toHaveBeenCalledWith('/recurring-items/phone/occurrences/2026-10-01/matches/same')
      await waitFor(() => { expect(within(pickerOf('Oakwood Phone')).getByRole('button', { name: 'Match to Lawn Service 2026-10-21' })).toBeTruthy() })
      expect(recurCell(r).childNodes).toHaveLength(0)
    })

    it('closes with Close and returns focus to Link', async () => {
      serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Coffee')
      await user.click(linkIn(r))
      await user.click(await screen.findByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('group', { name: /Recurring items for/ })).toBeNull()
      await waitFor(() => { expect(document.activeElement).toBe(linkIn(r)) })
    })

    it('closes with Escape from inside it and returns focus to Link', async () => {
      serve()
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('Coffee')
      await user.click(linkIn(r))
      await waitFor(() => pickerOf('Coffee'))
      await user.tab()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('group', { name: /Recurring items for/ })).toBeNull()
      await waitFor(() => { expect(document.activeElement).toBe(linkIn(r)) })
    })

    it('disables every control in the row and the picker while a request is in flight', async () => {
      serve()
      const gate = deferred<unknown>()
      vi.spyOn(api, 'post').mockReturnValue(gate.promise)
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      const r = await rowOf('CHECK #1042')
      await user.click(linkIn(r))
      await user.click(await screen.findByRole('button', { name: 'CHECK #1042 is not Rent' }))
      const picker = pickerOf('CHECK #1042')
      await waitFor(() => { expect((linkIn(r) as HTMLButtonElement).disabled).toBe(true) })
      for (const b of within(picker).getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
      gate.resolve({})
      await waitFor(() => { expect((linkIn(r) as HTMLButtonElement).disabled).toBe(false) })
    })

    it('shows the API message when a match is refused, and leaves the picker open', async () => {
      serve()
      vi.spyOn(api, 'post').mockRejectedValue(new Error('That leg of this occurrence is already matched. Unmatch it first.'))
      const user = userEvent.setup()
      renderWithToasts(<Harness />)
      await user.click(linkIn(await rowOf('CHECK #1042')))
      await user.click(await screen.findByRole('button', { name: 'Match CHECK #1042 to Rent' }))
      // A refusal belongs to no field: an error toast, which stays, and the picker stays open.
      await waitFor(() => {
        expect(shownToasts()).toEqual(['Error: That leg of this occurrence is already matched. Unmatch it first.'])
      })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(pickerOf('CHECK #1042')).toBeTruthy()
    })
  })
})
