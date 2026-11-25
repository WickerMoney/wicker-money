import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import DebtPayoffPage from './DebtPayoffPage.js'
import type { Debt, LumpSum } from './models/index.js'
import { makeBackend, type Backend } from './testing/makeBackend.js'
import { makeCtx } from './testing/makeCtx.js'
import { descriptionOf } from './testing/descriptionOf.js'
import { makeDebt } from './testing/makeDebt.js'
import { makeLumpSum } from './testing/makeLumpSum.js'

const visa = (): Debt => makeDebt({ id: 'visa', name: 'Visa', balance: '1500.0000', apr: '22.9900', minimumPayment: '45.0000' })
const car = (): Debt => makeDebt({ id: 'car', name: 'Car loan', balance: '8000.0000', apr: '6.5000', minimumPayment: '250.0000' })

async function open(backend: Backend) {
  const user = userEvent.setup()
  render(<DebtPayoffPage ctx={makeCtx(backend.api)} />)
  await screen.findByText(/Debt free|Not debt free/)
  // The lump sums load on their own request.
  await waitFor(() => expect(screen.queryByText('Loading your lump sums')).toBeNull())
  return { user }
}

const live = () => document.querySelector('[aria-live="polite"].wm-visually-hidden')?.textContent
const lumpTable = () => screen.getByRole('table', { name: 'Lump sums' })
const whatIf = () => within(screen.getByRole('form', { name: 'What if' }))

describe('the lump sums list', () => {
  it('starts empty, with the what-if offered', async () => {
    await open(makeBackend([visa()]))
    expect(screen.getByText('No lump sums')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Show what it changes' })).not.toBeNull()
  })

  it('is not shown when there are no debts to pay', async () => {
    render(<DebtPayoffPage ctx={makeCtx(makeBackend().api)} />)
    await screen.findByText('No debts yet')
    expect(screen.queryByRole('button', { name: 'Add a lump sum' })).toBeNull()
  })

  it('lists each with what the plan did with it', async () => {
    const lump = makeLumpSum({ id: 'a', note: 'Tax refund', allocations: [{ debtId: 'visa', amount: '200.0000' }] })
    await open(makeBackend([visa(), car()], [], [lump]))
    const row = within(lumpTable()).getAllByRole('row')[1] as HTMLElement
    expect(within(row).getByText('2027-03-15')).not.toBeNull()
    expect(within(row).getByText('$500.0000')).not.toBeNull()
    expect(row.textContent).toContain('Tax refund. $200.0000 to Visa; the rest follows the strategy.')
    expect(row.textContent).toMatch(/Paid on 2027-04-10 in the plan\./)
  })

  it('says a past-dated lump sum is ignored, and offers to remove it', async () => {
    const past = makeLumpSum({ id: 'old', onDate: '2026-01-05', amount: '300.0000' })
    const backend = makeBackend([visa()], [], [past])
    const { user } = await open(backend)
    expect(screen.getByText(/One lump sum has a date that has passed/)).not.toBeNull()
    expect(within(lumpTable()).getByText(/The date has passed, so the plan ignores it/)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove the lump sum of $300.0000 on 2026-01-05' }))
    await waitFor(() => expect(screen.getByText('No lump sums')).not.toBeNull())
    expect(backend.api.del).toHaveBeenCalledWith(expect.stringContaining('/lump-sums/old'))
    expect(live()).toBe('Lump sum of $300.0000 on 2026-01-05 removed. Updating the plan.')
  })

  it('offers no quick remove for one the plan uses', async () => {
    await open(makeBackend([visa()], [], [makeLumpSum()]))
    expect(screen.queryByRole('button', { name: /^Remove the lump sum/ })).toBeNull()
  })

  it('moves the debt-free date earlier', async () => {
    const without = makeBackend([visa(), car()])
    await open(without)
    const before = screen.getByText(/Debt free on/).textContent
    document.body.innerHTML = ''
    await open(makeBackend([visa(), car()], [], [makeLumpSum({ amount: '3000.0000', onDate: '2026-11-10' })]))
    expect(screen.getByText(/Debt free on/).textContent).not.toBe(before)
  })
})

describe('adding and editing a lump sum', () => {
  it('shows every problem on its field, focuses the first, and sends nothing', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a lump sum' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a lump sum' })
    await user.click(within(dialog).getByRole('button', { name: 'Add lump sum' }))
    expect(within(dialog).getByLabelText('Date paid').getAttribute('aria-invalid')).toBe('true')
    expect(within(dialog).getByLabelText('Amount').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Date paid'))
    expect(backend.api.post).not.toHaveBeenCalled()
  })

  it('refuses zero, and parts that add up to more than the whole', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a lump sum' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Date paid'), '2027-01-10')
    await user.type(within(dialog).getByLabelText('Amount'), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Add lump sum' }))
    expect(descriptionOf(within(dialog).getByLabelText('Amount'))).toMatch(/more than zero/)

    await user.clear(within(dialog).getByLabelText('Amount'))
    await user.type(within(dialog).getByLabelText('Amount'), '100')
    await user.type(within(dialog).getByLabelText('To Visa'), '80')
    await user.type(within(dialog).getByLabelText('To Car loan'), '40')
    await user.click(within(dialog).getByRole('button', { name: 'Add lump sum' }))
    expect(within(dialog).getByText(/add up to more than the lump sum/)).not.toBeNull()
    expect(backend.api.post).not.toHaveBeenCalled()
  })

  it('adds one, closes, lists it, and announces it', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a lump sum' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Date paid'), '2027-01-10')
    await user.type(within(dialog).getByLabelText('Amount'), '750')
    await user.type(within(dialog).getByLabelText('Note (optional)'), '  Bonus ')
    await user.type(within(dialog).getByLabelText('To Car loan'), '250')
    await user.click(within(dialog).getByRole('button', { name: 'Add lump sum' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.post).toHaveBeenCalledWith(expect.stringContaining('/lump-sums'), {
      onDate: '2027-01-10', amount: '750', note: 'Bonus', allocations: [{ debtId: 'car', amount: '250' }],
    })
    expect(await within(lumpTable()).findByText('2027-01-10')).not.toBeNull()
    expect(live()).toBe('Lump sum of $750 on 2027-01-10 added. Updating the plan.')
  })

  it('puts a server refusal on the debt it names', async () => {
    const backend = makeBackend([visa(), car()])
    backend.api.post.mockRejectedValueOnce(Object.assign(new Error('refused'), {
      issues: [{ path: ['allocations', 0, 'debtId'], message: 'That debt is not yours.' }],
    }))
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Add a lump sum' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Date paid'), '2027-01-10')
    await user.type(within(dialog).getByLabelText('Amount'), '100')
    await user.type(within(dialog).getByLabelText('To Visa'), '50')
    await user.click(within(dialog).getByRole('button', { name: 'Add lump sum' }))
    const field = await within(dialog).findByLabelText('To Visa')
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'))
    expect(descriptionOf(field)).toMatch(/not yours/)
    expect(document.activeElement).toBe(field)
  })

  it('edits a saved one from its values', async () => {
    const lump = makeLumpSum({ id: 'e', amount: '500.0000', note: 'Gift', allocations: [{ debtId: 'visa', amount: '100.0000' }] })
    const backend = makeBackend([visa()], [], [lump])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: 'Edit the lump sum of $500.0000 on 2027-03-15' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit lump sum' })
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('500.00')
    expect((within(dialog).getByLabelText('Note (optional)') as HTMLInputElement).value).toBe('Gift')
    expect((within(dialog).getByLabelText('To Visa') as HTMLInputElement).value).toBe('100.00')
    await user.clear(within(dialog).getByLabelText('Amount'))
    await user.type(within(dialog).getByLabelText('Amount'), '600')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.put).toHaveBeenCalledWith(expect.stringContaining('/lump-sums/e'), {
      onDate: '2027-03-15', amount: '600', note: 'Gift', allocations: [{ debtId: 'visa', amount: '100.00' }],
    })
  })

  it('asks once before removing, and keeps it on "Keep it"', async () => {
    const backend = makeBackend([visa()], [], [makeLumpSum({ id: 'r' })])
    const { user } = await open(backend)
    await user.click(screen.getByRole('button', { name: /^Edit the lump sum/ }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove this lump sum' }))
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    expect(backend.api.del).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Remove this lump sum' }))
    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(backend.api.del).toHaveBeenCalledWith(expect.stringContaining('/lump-sums/r'))
  })
})

describe('the what-if', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, date: string, amount: string) => {
    await user.type(whatIf().getByLabelText('Date paid'), date)
    await user.type(whatIf().getByLabelText('Amount'), amount)
  }

  it('says what it would change, announces it, and saves nothing', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    await fill(user, '2026-11-10', '2000')
    await user.click(whatIf().getByRole('button', { name: 'Show what it changes' }))
    const result = await screen.findByTestId('what-if-result')
    expect(result.textContent).toMatch(/With \$2000\.0000 on 2026-11-10 you would be debt free on \d{4}-\d{2}-\d{2}, .* from now: .* sooner, saving \$[\d.]+ in interest\./)
    expect(live()).toBe(result.textContent)
    expect(backend.api.post).toHaveBeenCalledTimes(1)
    expect(backend.api.post).toHaveBeenCalledWith(
      expect.stringContaining('/plan/what-if'),
      { onDate: '2026-11-10', amount: '2000', allocations: [], strategy: 'avalanche', extra: '0.0000', tz: 'UTC' },
    )
    expect(backend.state.lumpSums).toHaveLength(0)
  })

  it('says a past date changes nothing', async () => {
    const { user } = await open(makeBackend([visa()]))
    await fill(user, '2026-01-01', '500')
    await user.click(whatIf().getByRole('button', { name: 'Show what it changes' }))
    expect((await screen.findByTestId('what-if-result')).textContent).toMatch(/date has passed.*nothing would change/)
  })

  it('shows problems on the fields and sends nothing', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await user.click(whatIf().getByRole('button', { name: 'Show what it changes' }))
    expect(whatIf().getByLabelText('Date paid').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(whatIf().getByLabelText('Date paid'))
    expect(backend.api.post).not.toHaveBeenCalled()
  })

  it('stays busy and keeps focus on its button while it works', async () => {
    const backend = makeBackend([visa()])
    const { user } = await open(backend)
    await fill(user, '2026-11-10', '500')
    let release: (value: unknown) => void = () => undefined
    backend.api.post.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const button = whatIf().getByRole('button', { name: 'Show what it changes' })
    button.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'))
    expect(document.activeElement).toBe(button)
    release({
      current: { debtFreeDate: '2027-01-10', months: 3, totalInterest: '10.0000', capped: false },
      withLumpSum: { debtFreeDate: '2026-12-10', months: 2, totalInterest: '5.0000', capped: false },
      interestSaved: '5.0000', monthsSaved: 1,
      lumpSum: { id: 'x', onDate: '2026-11-10', amount: '500.0000', status: 'applied', month: 1, date: '2026-11-10', paid: '500.0000', unused: '0.0000' },
    })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'))
    expect(document.activeElement).toBe(button)
    expect(live()).toMatch(/1 month sooner, saving \$5\.0000 in interest/)
  })

  it('marks the answer out of date when the numbers change, and can save the lump sum', async () => {
    const backend = makeBackend([visa(), car()])
    const { user } = await open(backend)
    await fill(user, '2026-11-10', '2000')
    await user.click(whatIf().getByRole('button', { name: 'Show what it changes' }))
    await screen.findByTestId('what-if-result')
    await user.type(whatIf().getByLabelText('Amount'), '5')
    expect(screen.getByTestId('what-if-result').textContent).toMatch(/^Out of date/)
    expect(whatIf().queryByRole('button', { name: 'Save as a lump sum' })).toBeNull()

    await user.click(whatIf().getByRole('button', { name: 'Show what it changes' }))
    await waitFor(() => expect(screen.getByTestId('what-if-result').textContent).not.toMatch(/^Out of date/))
    await user.click(whatIf().getByRole('button', { name: 'Save as a lump sum' }))
    await waitFor(() => expect(backend.state.lumpSums).toHaveLength(1))
    expect(backend.state.lumpSums[0]?.amount).toBe('20005.0000')
    expect(await within(lumpTable()).findByText('2026-11-10')).not.toBeNull()
    expect((whatIf().getByLabelText('Amount') as HTMLInputElement).value).toBe('')
  })

  it('puts the strategy on the request', async () => {
    const backend = makeBackend([visa(), car()])
    backend.state.settings = { strategy: 'snowball', extraPayment: '25.0000', saved: true }
    const { user } = await open(backend)
    await fill(user, '2026-11-10', '100')
    await user.click(whatIf().getByRole('button', { name: 'Show what it changes' }))
    await screen.findByTestId('what-if-result')
    expect(backend.api.post).toHaveBeenCalledWith(
      expect.stringContaining('/plan/what-if'),
      expect.objectContaining({ strategy: 'snowball', extra: '25.0000' }),
    )
  })
})

export type { LumpSum }
