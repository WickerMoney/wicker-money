import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import DebtFreeWidget from './DebtFreeWidget.js'
import { DEBT_PAYOFF_PAGE_PATH } from './helpers/DEBT_PAYOFF_PAGE_PATH.js'
import { makeBackend } from './testing/makeBackend.js'
import { makeCtx } from './testing/makeCtx.js'
import { makeDebt } from './testing/makeDebt.js'
import type { WidgetSize } from '@wickermoney/plugin-sdk'

const debts = () => [
  makeDebt({ id: 'visa', name: 'Visa', balance: '1500.0000', apr: '22.9900', minimumPayment: '45.0000' }),
  makeDebt({ id: 'store', name: 'Store card', balance: '300.0000', apr: '0.0000', minimumPayment: '25.0000' }),
]

function show(backend: ReturnType<typeof makeBackend>, size: WidgetSize) {
  const ctx = makeCtx(backend.api)
  render(<DebtFreeWidget ctx={ctx} size={size} />)
  return ctx
}

describe('DebtFreeWidget', () => {
  it('at sm shows the date and the next debt in line, and nothing more', async () => {
    show(makeBackend(debts()), 'sm')
    expect(await screen.findByText('Debt-free date')).toBeTruthy()
    expect(screen.getByText(/^\d{4}-\d{2}-\d{2}$/)).toBeTruthy()
    expect(screen.getByText(/to go, avalanche plan/)).toBeTruthy()
    expect(screen.getByText('Next in line')).toBeTruthy()
    // Avalanche aims at the highest rate first.
    expect(screen.getByText('Visa')).toBeTruthy()
    expect(screen.queryByText(/against\s+paying only the minimums/)).toBeNull()
  })

  it('at md adds what the plan saves against the minimums', async () => {
    show(makeBackend(debts()), 'md')
    expect(await screen.findByText(/of interest and .* against\s+paying only the minimums/)).toBeTruthy()
  })

  it('asks for the plan with the saved settings, in the user’s zone', async () => {
    const backend = makeBackend(debts())
    show(backend, 'sm')
    await screen.findByText('Next in line')
    expect(backend.calls()).toEqual(['GET /plan?tz=UTC'])
  })

  it('opens the page', async () => {
    const backend = makeBackend(debts())
    const ctx = show(backend, 'sm')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Open debt payoff' }))
    expect(ctx.navigate).toHaveBeenCalledWith(DEBT_PAYOFF_PAGE_PATH)
    expect(DEBT_PAYOFF_PAGE_PATH).toBe('/p/wickermoney.debt-payoff/debt-payoff')
  })

  it('invites the first debt when there are none', async () => {
    const backend = makeBackend([])
    const ctx = show(backend, 'sm')
    expect(await screen.findByText('No debts tracked')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a debt' }))
    expect(ctx.navigate).toHaveBeenCalledWith(DEBT_PAYOFF_PAGE_PATH)
  })

  it('does not invent a date for a plan that never ends', async () => {
    show(makeBackend([makeDebt({ name: 'Runaway', balance: '10000', apr: '30', minimumPayment: '10' })]), 'md')
    expect(await screen.findByText(/^Not within 50 years$/)).toBeTruthy()
    expect(screen.getByText(/Raise the extra payment/)).toBeTruthy()
    expect(screen.queryByText(/of interest and/)).toBeNull()
  })

  it('shows a failure in place of the card', async () => {
    const backend = makeBackend(debts())
    backend.api.get.mockRejectedValue(new Error('Nope.'))
    show(backend, 'sm')
    await waitFor(() => expect(screen.getByText('Debt payoff unavailable')).toBeTruthy())
    expect(screen.getByText('Nope.')).toBeTruthy()
  })
})
