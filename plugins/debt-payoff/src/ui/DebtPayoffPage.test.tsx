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
    const extra = screen.getByLabelText('Extra for all debts (follows the strategy)')

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

describe('extra paid toward one debt', () => {
  const debtsTable = () => screen.getByRole('table', { name: 'Your debts' })
  const rowOf = (name: string) =>
    within(debtsTable()).getAllByRole('row').find((r) => within(r).queryByText(name) !== null)!

  it('is its own field in the dialog, with the rule beside it, and blank means none', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a debt' })
    const field = within(dialog).getByLabelText('Extra each month toward this debt (optional)')
    expect(descriptionOf(field)).toMatch(/does not move to another debt/)
    expect((field as HTMLInputElement).value).toBe('')

    await user.type(within(dialog).getByLabelText('Name'), 'Dentist')
    await user.type(within(dialog).getByLabelText('Balance'), '640')
    await user.type(within(dialog).getByLabelText('Interest rate (% a year)'), '9.9')
    await user.type(within(dialog).getByLabelText('Minimum payment (a month)'), '40')
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.post).toHaveBeenCalledWith(expect.stringContaining('/debts'), expect.objectContaining({ extraPayment: '0' }))
  })

  it('refuses a bad amount on its own field and sends nothing', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Edit Visa' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Visa' })
    const field = within(dialog).getByLabelText('Extra each month toward this debt (optional)')
    await user.type(field, '1,5')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field)
    expect(descriptionOf(field)).toMatch(/at most four decimal places/)
    expect(backend.api.put).not.toHaveBeenCalled()
  })

  it('saves an amount, shows it in the list and in the header, and moves the date later than the same money pooled', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    expect(screen.queryByText(/earmarked/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit Visa' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Visa' })
    await user.type(within(dialog).getByLabelText('Extra each month toward this debt (optional)'), '100')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.put).toHaveBeenCalledWith(expect.stringContaining('/debts/visa'), expect.objectContaining({ extraPayment: '100' }))

    // Minimums 45 + 250 are pooled; the 100 is earmarked for Visa alone.
    expect(await screen.findByText(/Each month: \$295\.0000 pooled \+ \$100\.0000 earmarked for single debts/)).not.toBeNull()
    expect(within(rowOf('Visa')).getByText('$100')).not.toBeNull()
    expect(within(rowOf('Car loan')).getByText('—')).not.toBeNull()
    expect(screen.getByText('Pooled each month')).not.toBeNull()
  })

  it('fills the field from the saved debt, and a debt with none is blank', async () => {
    const backend = makeBackend([makeDebt({ id: 'a', name: 'A', extraPayment: '25.5000' }), makeDebt({ id: 'b', name: 'B' })])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Edit A' }))
    expect((screen.getByLabelText('Extra each month toward this debt (optional)') as HTMLInputElement).value).toBe('25.50')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Edit B' }))
    expect((screen.getByLabelText('Extra each month toward this debt (optional)') as HTMLInputElement).value).toBe('')
  })

  it('is ignored, and says so, while the debt is not in the plan', async () => {
    const backend = makeBackend([visa(), makeDebt({ id: 'out', name: 'Out', extraPayment: '50.0000', included: false })])
    await open(backend)
    expect(within(rowOf('Out')).getByText('Not used: not in the plan')).not.toBeNull()
    // Nothing earmarked is in the plan, so there is no pooled/earmarked line.
    expect(screen.queryByText(/earmarked for single debts/)).toBeNull()
  })

  it('warns when an amount is more than the debt needs', async () => {
    await open(makeBackend([makeDebt({ id: 'tiny', name: 'Dentist', balance: '120.0000', apr: '0.0000', minimumPayment: '20.0000', extraPayment: '400.0000' })]))
    expect(screen.getByText(/The \$400\.0000 a month set on Dentist is more than it needs: it owes \$120\.0000, so it is paid off in the first month/))
      .not.toBeNull()
  })

  it('calls the shared amount what it is, and explains the rule on the page', async () => {
    await open(makeBackend([visa()]))
    expect(descriptionOf(screen.getByLabelText('Extra for all debts (follows the strategy)'))).toMatch(/set it on that debt/)
    expect(screen.getByText(/When that debt is paid off the amount stops; it does not move to another/)).not.toBeNull()
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
      name: 'Dentist', balance: '640', apr: '9.9', minimumPayment: '40', accountId: null, included: true, extraPayment: '0',
      repaymentStartsOn: null, promoApr: null, promoEndsOn: null, promoDeferredInterest: false, promoInterestBase: 'original', compounding: 'monthly',
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
    await user.type(screen.getByLabelText('Extra for all debts (follows the strategy)'), '12345')
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

describe('deferred loans, promotions and compounding', () => {
  const loan = (): Debt => makeDebt({
    id: 'loan', name: 'Student loan', balance: '10000.0000', apr: '6.0000', minimumPayment: '100.0000',
    repaymentStartsOn: '2027-04-10',
  })
  const promoCard = (): Debt => makeDebt({
    id: 'promo', name: 'Store card', balance: '1200.0000', apr: '24.9900', minimumPayment: '25.0000',
    promoApr: '0.0000', promoEndsOn: '2027-10-10', promoDeferredInterest: true,
  })

  it('says in the list when repayment starts and when a promotion ends', async () => {
    await open(makeBackend([loan(), promoCard()]))
    const debts = screen.getByRole('table', { name: 'Your debts' })
    expect(within(debts).getByText('Repayment starts 2027-04-10')).not.toBeNull()
    expect(within(debts).getByText(/0\.?0*% until 2027-10-10, interest charged back if not paid off/)).not.toBeNull()
  })

  it('warns that interest would be added, and what would clear it in time', async () => {
    await open(makeBackend([promoCard()]))
    expect(await screen.findByText(/Store card is not paid off by 2027-10-10 at these payments/)).not.toBeNull()
    expect(screen.getByText(/299\.88/)).not.toBeNull()
    expect(screen.getByText(/Another \$75\.0000 a month would clear it in time/)).not.toBeNull()
  })

  it('says the plan pays enough first when the budget allows', async () => {
    const backend = makeBackend([promoCard()])
    backend.state.settings = { strategy: 'avalanche', extraPayment: '75.0000', saved: true }
    await open(backend)
    expect(await screen.findByText(/pays at least \$100\.0000 a month toward it first/)).not.toBeNull()
  })

  it('says what a deferred loan will owe when repayment starts', async () => {
    await open(makeBackend([loan()]))
    expect(await screen.findByText(/No payment is due on Student loan until 2027-04-10/)).not.toBeNull()
    expect(screen.getByText(/so it will owe \$10252\.5126 by then instead of \$10000\.0000/)).not.toBeNull()
  })

  it('adds a deferred loan with a promotion from the section in the dialog, closed until needed', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a debt' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a debt' })
    const section = dialog.querySelector('details')
    expect(section?.open).toBe(false)

    await user.type(within(dialog).getByLabelText('Name'), 'Dental card')
    await user.type(within(dialog).getByLabelText('Balance'), '900')
    await user.type(within(dialog).getByLabelText('Interest rate (% a year)'), '26.99')
    await user.type(within(dialog).getByLabelText('Minimum payment (a month)'), '30')
    await user.click(within(dialog).getByText('Timing and interest (optional)'))
    expect(section?.open).toBe(true)

    await user.type(within(dialog).getByLabelText('Promotional rate (% a year)'), '0')
    const deferred = within(dialog).getByRole('checkbox', { name: /charged back to the start/ })
    await user.click(deferred)
    expect(within(dialog).getByLabelText('Charged back on')).not.toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))
    // A rate without an end date is refused on the end date.
    const end = within(dialog).getByLabelText('Promotional rate ends on')
    expect(end.getAttribute('aria-invalid')).toBe('true')
    expect(backend.api.post).not.toHaveBeenCalled()

    await user.type(end, '2027-10-10')
    await user.selectOptions(within(dialog).getByLabelText('How interest is worked out'), 'daily')
    await user.click(within(dialog).getByRole('button', { name: 'Add debt' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.post).toHaveBeenCalledWith(expect.stringContaining('/debts'), expect.objectContaining({
      promoApr: '0', promoEndsOn: '2027-10-10', promoDeferredInterest: true, promoInterestBase: 'original',
      compounding: 'daily', repaymentStartsOn: null,
    }))
  })

  it('opens the section when the debt already uses it, and when a problem is inside it', async () => {
    const { user } = await open(makeBackend([loan(), visa()]))
    await user.click(screen.getByRole('button', { name: 'Edit Student loan' }))
    const open1 = screen.getByRole('dialog', { name: 'Edit Student loan' })
    expect(open1.querySelector('details')?.open).toBe(true)
    expect((within(open1).getByLabelText('Repayment starts on') as HTMLInputElement).value).toBe('2027-04-10')
    await user.click(within(open1).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Edit Visa' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Visa' })
    expect(dialog.querySelector('details')?.open).toBe(false)
  })
})
