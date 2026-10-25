import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DebtPayoffPage from './DebtPayoffPage.js'
import type { Debt } from './models/index.js'
import { makeBackend, type Backend } from './testing/makeBackend.js'
import { makeCtx } from './testing/makeCtx.js'
import { descriptionOf } from './testing/descriptionOf.js'
import { makeDebt } from './testing/makeDebt.js'

const visa = (): Debt => makeDebt({ id: 'visa', name: 'Visa', balance: '1500.0000', apr: '22.9900', minimumPayment: '45.0000' })
const car = (): Debt => makeDebt({ id: 'car', name: 'Car loan', balance: '8000.0000', apr: '6.5000', minimumPayment: '250.0000' })
const store = (): Debt => makeDebt({ id: 'store', name: 'Store card', balance: '300.0000', apr: '0.0000', minimumPayment: '25.0000' })

async function open(backend: Backend, ctx = makeCtx(backend.api)) {
  const user = userEvent.setup()
  render(<DebtPayoffPage ctx={ctx} />)
  await screen.findByText(/Debt free|Not debt free/)
  return { user, ctx }
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
const orderRows = () =>
  within(screen.getByRole('table', { name: 'Debts in the order the plan pays them' }))
    .getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]?.textContent)

describe('the plan', () => {
  it('lists the debts and answers when the last one is paid', async () => {
    await open(makeBackend([visa(), car(), store()]))
    const debts = screen.getByRole('table', { name: 'Your debts' })
    expect(within(debts).getAllByRole('row')).toHaveLength(4)
    expect(within(debts).getByText('Car loan')).not.toBeNull()
    expect(screen.getByText(/Debt free on \d{4}-\d{2}-\d{2}, .* from now\./)).not.toBeNull()
    expect(screen.getByText('Debt-free date')).not.toBeNull()
    expect(screen.getByText('Interest saved vs minimums only')).not.toBeNull()
    expect(screen.getByText(/Paying only the minimums: debt free/)).not.toBeNull()
  })

  it('states its assumptions on the page', async () => {
    await open(makeBackend([visa()]))
    expect(screen.getByText(/nominal rate, compounded monthly/)).not.toBeNull()
    expect(screen.getByText(/rounded once for each debt each month, to four decimal places, with halves rounded away from zero/))
      .not.toBeNull()
  })

  it('orders the payoff by the chosen strategy and saves the choice', async () => {
    const backend = makeBackend([visa(), car(), store()])
    const { user } = await open(backend)
    expect(pressed('Avalanche')).toBe('true')
    expect(orderRows()[0]).toContain('Visa')

    await user.click(screen.getByRole('button', { name: 'Snowball' }))
    await waitFor(() => expect(pressed('Snowball')).toBe('true'))
    expect(backend.api.put).toHaveBeenCalledWith(expect.stringContaining('/settings'), { strategy: 'snowball' })
    await waitFor(() => expect(orderRows()[0]).toContain('Store card'))
    expect(backend.calls().some((c) => c.includes('/plan?strategy=snowball'))).toBe(true)
  })

  it('refuses a bad extra amount on its own field, then applies a good one', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    const extra = screen.getByLabelText('Extra each month')

    await user.clear(extra)
    await user.type(extra, '1,5')
    await user.click(screen.getByRole('button', { name: 'Update plan' }))
    expect(extra.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(extra)
    expect(descriptionOf(extra)).toMatch(/at most four decimal places/)
    expect(backend.api.put).not.toHaveBeenCalled()

    const before = screen.getByText(/Debt free on/).textContent
    await user.clear(extra)
    await user.type(extra, '200')
    await user.click(screen.getByRole('button', { name: 'Update plan' }))
    await waitFor(() => expect(screen.getByText(/Debt free on/).textContent).not.toBe(before))
    expect(backend.api.put).toHaveBeenCalledWith(expect.stringContaining('/settings'), { extraPayment: '200' })
    expect(extra.getAttribute('aria-invalid')).not.toBe('true')
  })

  it('warns when a minimum does not cover its interest', async () => {
    await open(makeBackend([makeDebt({ name: 'Runaway', balance: '10000', apr: '30', minimumPayment: '10' })]))
    expect(screen.getByText(/minimum on Runaway does not cover its first month of interest/)).not.toBeNull()
    expect(screen.getByText(/not paid off within|grow faster/)).not.toBeNull()
    expect(screen.getByText(/Not debt free within/)).not.toBeNull()
  })

  it('says so when every debt is already at zero', async () => {
    const backend = makeBackend([makeDebt({ balance: '0' })])
    render(<DebtPayoffPage ctx={makeCtx(backend.api)} />)
    expect(await screen.findByText(/already at zero/)).not.toBeNull()
  })

  it('shows a failure as an alert', async () => {
    const backend = makeBackend([visa()])
    backend.api.get.mockImplementation(async (path: string) => {
      if (path.includes('/debts')) throw new Error('The server is down.')
      return { debts: [], accounts: [] }
    })
    render(<DebtPayoffPage ctx={makeCtx(backend.api)} />)
    expect((await screen.findByRole('alert')).textContent).toContain('The server is down.')
  })
})

describe('leaving a debt out of the plan', () => {
  const mortgage = (): Debt =>
    makeDebt({ id: 'mortgage', name: 'Mortgage', balance: '300000.0000', apr: '6.0000', minimumPayment: '1800.0000' })
  const inPlan = (name: string) => screen.getByRole('checkbox', { name: `Include ${name} in the payoff plan` }) as HTMLInputElement

  it('has a box for every debt, ticked unless the debt is left out', async () => {
    await open(makeBackend([visa(), makeDebt({ id: 'out', name: 'Out', included: false })]))
    expect(inPlan('Visa').checked).toBe(true)
    expect(inPlan('Out').checked).toBe(false)
  })

  it('saves at once, takes the debt out of the plan, and says what the date leaves out', async () => {
    const backend = makeBackend([mortgage(), visa(), store()])
    const { user } = await open(backend)
    expect(screen.getByText(/^Debt free on /)).not.toBeNull()
    expect(orderRows().join()).toContain('Mortgage')

    await user.click(inPlan('Mortgage'))
    await waitFor(() => expect(screen.getByText(/^Debt free \(excluding Mortgage\) on \d{4}-\d{2}-\d{2}, .* from now\.$/)).not.toBeNull())
    expect(backend.api.put).toHaveBeenCalledWith(expect.stringContaining('/debts/mortgage'), { included: false })
    expect(document.querySelector('[aria-live="polite"].wm-visually-hidden')?.textContent)
      .toBe('Mortgage left out of the plan. Updating the plan.')

    // Gone from the order and the schedule; still in the list, marked, with no payoff date.
    expect(orderRows().join()).not.toContain('Mortgage')
    const row = within(screen.getByRole('table', { name: 'Your debts' })).getAllByRole('row')
      .find((r) => within(r).queryByText('Mortgage') !== null)!
    expect(within(row).getByText('Not in plan', { selector: '.dp-tag' })).not.toBeNull()
    expect(within(row).getAllByText('Not in plan')).toHaveLength(2)
    expect(screen.getByText(/Not in this plan: Mortgage\./)).not.toBeNull()
  })

  it('brings it back with the same box', async () => {
    const backend = makeBackend([mortgage(), visa()])
    const { user } = await open(backend)
    await user.click(inPlan('Mortgage'))
    await waitFor(() => expect(screen.getByText(/excluding Mortgage/)).not.toBeNull())
    await user.click(inPlan('Mortgage'))
    await waitFor(() => expect(screen.queryByText(/excluding Mortgage/)).toBeNull())
    expect(backend.api.put).toHaveBeenLastCalledWith(expect.stringContaining('/debts/mortgage'), { included: true })
    expect(orderRows().join()).toContain('Mortgage')
  })

  it('names several, and says nothing is in the plan when all are out', async () => {
    const backend = makeBackend([mortgage(), visa(), store()])
    const { user } = await open(backend)
    await user.click(inPlan('Visa'))
    await waitFor(() => expect(inPlan('Visa').checked).toBe(false))
    await user.click(inPlan('Store card'))
    await waitFor(() => expect(screen.getByText(/^Debt free \(excluding Visa and Store card\) on /)).not.toBeNull())

    await user.click(inPlan('Mortgage'))
    expect((await screen.findByText(/Nothing is in the plan/)).getAttribute('role')).toBe('status')
    expect(screen.queryByText(/Debt free/)).toBeNull()
    // The list is still there, and so is the way back.
    expect(screen.getAllByRole('checkbox', { name: /in the payoff plan$/ })).toHaveLength(3)
  })

  it('disables the box on an archived debt', async () => {
    const backend = makeBackend([visa(), makeDebt({ id: 'old', name: 'Old', archived: true })])
    const { user } = await open(backend)
    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await screen.findByText('Old')
    expect(inPlan('Old').disabled).toBe(true)
    expect(inPlan('Old').checked).toBe(false)
  })

  it('shows a failure to save as an alert and leaves the box as it was', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    backend.api.put.mockRejectedValueOnce(new Error('Could not reach the server.'))
    await user.click(inPlan('Visa'))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server.')
    expect(inPlan('Visa').checked).toBe(true)
  })

  it('is offered in the dialog, on by default, and sent with the debt', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a debt' })
    const box = within(dialog).getByRole('checkbox', { name: /Include in the payoff plan/ }) as HTMLInputElement
    expect(box.checked).toBe(true)
    await user.type(within(dialog).getByLabelText('Name'), 'Mortgage')
    await user.type(within(dialog).getByLabelText('Balance'), '300000')
    await user.type(within(dialog).getByLabelText('Interest rate (% a year)'), '6')
    await user.type(within(dialog).getByLabelText('Minimum payment (a month)'), '1800')
    await user.click(box)
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.post).toHaveBeenCalledWith(expect.stringContaining('/debts'), expect.objectContaining({ included: false }))
    expect(await screen.findByText(/Not in this plan: Mortgage\./)).not.toBeNull()
  })

  it('is read from the saved debt when editing, and an archived debt cannot be switched on', async () => {
    const backend = makeBackend([makeDebt({ id: 'out', name: 'Out', included: false }), visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Edit Out' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Out' })
    const box = within(dialog).getByRole('checkbox', { name: /Include in the payoff plan/ }) as HTMLInputElement
    expect(box.checked).toBe(false)
    await user.click(within(dialog).getByRole('checkbox', { name: /Archive this debt/ }))
    expect(box.disabled).toBe(true)
    expect(within(dialog).getByText(/An archived debt is never in the plan/)).not.toBeNull()
  })

  it('keeps keyboard focus on the In plan box while the change saves', async () => {
    const { user } = await open(makeBackend([makeDebt({ id: 'm', name: 'Mortgage' }), visa()]))
    const box = screen.getByRole('checkbox', { name: 'Include Mortgage in the payoff plan' }) as HTMLInputElement
    box.focus()
    await user.keyboard(' ')
    await screen.findByText(/Not in this plan: Mortgage\./)
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Include Mortgage in the payoff plan' }))
  })

  it('states the rule on the page', async () => {
    await open(makeBackend([visa()]))
    expect(screen.getByText(/a debt with "In plan" switched off stays in your list but is not counted anywhere/i)).not.toBeNull()
  })
})

describe('the chart', () => {
  it('can be read by keyboard and as a table', async () => {
    const { user } = await open(makeBackend([visa(), car()]))
    const chart = screen.getByRole('img', { name: /Total owed, month by month/ })
    expect(chart.getAttribute('tabindex')).toBe('0')

    // A live region that is mounted before anything is said, so it is announced.
    const live = chart.parentElement!.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')
    chart.focus()
    await waitFor(() => expect(live.textContent).toMatch(/^Today, \d{4}-\d{2}-\d{2}: \$9500\.0000 still owed\.$/))
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(live.textContent).toMatch(/paid; .* of interest added/))
    await user.keyboard('{End}')
    await waitFor(() => expect(live.textContent).toMatch(/Paid off: .*\$0\.0000 still owed|still owed\. .*Paid off/))

    await user.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table', { name: 'The payoff plan, month by month' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Month', 'Date', 'Paid', 'Interest added', 'Still owed', 'Paid off',
    ])
    expect(within(table).getAllByRole('row')).toHaveLength(25)
    expect(screen.getByText(/Showing 24 of \d+ months\./)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /Show all \d+/ }))
    expect(screen.getByText(/Showing (\d+) of \1 months\./)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show as chart' }))
    expect(screen.getByRole('img', { name: /Total owed/ })).not.toBeNull()
  })

  it('has a key naming every band', async () => {
    await open(makeBackend([visa(), car(), store()]))
    const key = screen.getByRole('list', { name: /Key to the chart/ })
    expect(within(key).getAllByRole('listitem').map((li) => li.textContent)).toHaveLength(3)
  })
})

describe('adding and editing a debt', () => {
  it('shows every problem on its field, focuses the first, and sends nothing', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a debt' })
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))

    for (const label of ['Name', 'Balance', 'Interest rate (% a year)', 'Minimum payment (a month)']) {
      expect(within(dialog).getByLabelText(label).getAttribute('aria-invalid')).toBe('true')
    }
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'))
    expect(backend.api.post).not.toHaveBeenCalled()

    // Fixing a field clears its message.
    await user.type(within(dialog).getByLabelText('Name'), 'Loan')
    expect(within(dialog).getByLabelText('Name').getAttribute('aria-invalid')).not.toBe('true')
  })

  it('adds a debt, closes, and updates the list and the plan', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a debt' })
    await user.type(within(dialog).getByLabelText('Name'), 'Dentist')
    await user.type(within(dialog).getByLabelText('Balance'), '640')
    await user.type(within(dialog).getByLabelText('Interest rate (% a year)'), '9.9')
    await user.type(within(dialog).getByLabelText('Minimum payment (a month)'), '40')
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.post).toHaveBeenCalledWith(expect.stringContaining('/debts'), {
      name: 'Dentist', balance: '640', apr: '9.9', minimumPayment: '40', accountId: null, included: true,
    })
    expect(await within(screen.getByRole('table', { name: 'Your debts' })).findByText('Dentist')).not.toBeNull()
    expect(document.querySelector('[aria-live="polite"].wm-visually-hidden')?.textContent).toBe('Dentist added. Updating the plan.')
    await waitFor(() => expect(orderRows().join()).toContain('Dentist'))
  })

  it('puts a server refusal on the field it names', async () => {
    const backend = makeBackend([], [{ id: 'acct', name: 'Chase', accountType: 'credit_card', debtId: null }])
    backend.api.post.mockRejectedValueOnce(Object.assign(new Error('refused'), {
      issues: [{ path: ['accountId'], message: 'That account is already tracked by another debt.' }],
    }))
    render(<DebtPayoffPage ctx={makeCtx(backend.api)} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add Chase' }))
    const dialog = screen.getByRole('dialog')
    // The account's name fills an empty name.
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Chase')
    expect((within(dialog).getByLabelText(/Linked account/) as HTMLInputElement).value).toBe('acct')
    await user.type(within(dialog).getByLabelText('Balance'), '100')
    await user.type(within(dialog).getByLabelText('Interest rate (% a year)'), '20')
    await user.type(within(dialog).getByLabelText('Minimum payment (a month)'), '25')
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))

    const select = await within(dialog).findByLabelText(/Linked account/)
    await waitFor(() => expect(select.getAttribute('aria-invalid')).toBe('true'))
    expect(descriptionOf(select)).toMatch(/already tracked by another debt/)
    expect(document.activeElement).toBe(select)
  })

  it('shows a general failure beside the button', async () => {
    const backend = makeBackend([visa()])
    backend.api.post.mockRejectedValueOnce(new Error('You can track at most 50 debts.'))
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name'), 'One more')
    await user.type(within(dialog).getByLabelText('Balance'), '1')
    await user.type(within(dialog).getByLabelText('Interest rate (% a year)'), '1')
    await user.type(within(dialog).getByLabelText('Minimum payment (a month)'), '1')
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))
    expect((await within(dialog).findByRole('alert')).textContent).toContain('at most 50 debts')
  })

  it('edits a saved debt from its values and can archive it', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Edit Visa' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Visa' })
    expect((within(dialog).getByLabelText('Balance') as HTMLInputElement).value).toBe('1500.00')
    expect((within(dialog).getByLabelText('Interest rate (% a year)') as HTMLInputElement).value).toBe('22.99')

    await user.click(within(dialog).getByRole('checkbox', { name: /Archive this debt/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.put).toHaveBeenCalledWith(expect.stringContaining('/debts/visa'), expect.objectContaining({ archived: true }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit Visa' })).toBeNull())
  })

  it('asks once before removing a debt, and keeps it on "Keep it"', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Edit Visa' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove this debt' }))
    expect(document.activeElement).toBe(within(dialog).getByRole('group', { name: 'Remove Visa' }))
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Remove this debt' }))
    expect(backend.api.del).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Remove this debt' }))
    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.del).toHaveBeenCalledWith(expect.stringContaining('/debts/visa'))
    await waitFor(() => expect(screen.queryByText('Visa')).toBeNull())
    // The row that opened the dialog is gone, so focus lands on a control that exists.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a debt' })))
  })
})

describe('an empty page', () => {
  it('offers to start from the accounts it can see, and has no plan to show', async () => {
    const backend = makeBackend([], [
      { id: 'a1', name: 'Chase', accountType: 'credit_card', debtId: null },
      { id: 'a2', name: 'Auto loan', accountType: 'loan', debtId: null },
    ])
    render(<DebtPayoffPage ctx={makeCtx(backend.api)} />)
    expect(await screen.findByText('No debts yet')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Add Auto loan' })).not.toBeNull()
    expect(screen.queryByText('Payoff plan')).toBeNull()
    expect(screen.getByText(/nominal rate, compounded monthly/)).not.toBeNull()
  })
})

describe('a long list', () => {
  const fifty = () => Array.from({ length: 50 }, (_, i) =>
    makeDebt({ name: `Debt ${i + 1}`, balance: `${500 + i * 10}.0000`, apr: '15.0000', minimumPayment: `${30 + i}.1234` }))

  it('does not redraw the debts while the extra amount is typed, or when a dialog opens', async () => {
    const backend = makeBackend(fifty())
    const format = vi.fn((value: string) => `$${value}`)
    const ctx = { ...makeCtx(backend.api), formatMoney: format }
    const { user } = await open(backend, ctx)
    expect(screen.getAllByRole('button', { name: /^Edit Debt/ })).toHaveLength(50)

    // Typing lives in the form: nothing else on the page is formatted again.
    const before = format.mock.calls.length
    await user.type(screen.getByLabelText('Extra each month'), '12345')
    expect(format.mock.calls.length).toBe(before)

    // Opening a dialog re-renders the page, but the memoised debt list does not
    // format its minimums again. These minimums appear nowhere else on the page.
    const minimums = new Set(Array.from({ length: 50 }, (_, i) => `${30 + i}.1234`))
    const seen = () => format.mock.calls.filter(([v]) => minimums.has(v)).length
    const rowCalls = seen()
    expect(rowCalls).toBeGreaterThanOrEqual(50)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(seen()).toBe(rowCalls)
  })
})
