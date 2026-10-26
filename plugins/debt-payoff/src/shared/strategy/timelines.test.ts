import { describe, expect, it } from 'vitest'
import { buildPayoffPlan } from './buildPayoffPlan.js'
import type { DebtInput } from './DebtInput.js'
import type { PayoffPlan } from './PayoffPlan.js'
import { daysBetween } from './daysBetween.js'
import { periodInterest } from './periodInterest.js'
import type { Strategy } from './Strategy.js'

/**
 * Expected figures here were worked out separately with decimal arithmetic and
 * explicit half-up rounding, not by this module's integer formulation.
 */

const START = '2026-10-10'

const debt = (over: Partial<DebtInput> & Pick<DebtInput, 'id' | 'balance' | 'apr' | 'minimumPayment'>): DebtInput => ({
  name: over.id, ...over,
})

function plan(debts: readonly DebtInput[], extraPayment = '0', strategy: Strategy = 'avalanche'): PayoffPlan {
  return buildPayoffPlan(debts, { strategy, extraPayment, startDate: START })
}

const row = (p: PayoffPlan, month: number, id: string) => {
  const line = p.schedule[month - 1]?.debts.find((d) => d.debtId === id)
  if (line === undefined) throw new Error(`no ${id} in month ${month}`)
  return line
}

describe('daysBetween', () => {
  it('counts calendar days, across a leap day and a year end', () => {
    expect(daysBetween('2026-10-10', '2026-11-10')).toBe(31)
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})

describe('periodInterest', () => {
  const thousand = 10_000_000n // 1000.0000 in units
  const apr12 = 120_000n

  it('monthly is the nominal monthly rate', () => {
    expect(periodInterest('monthly', thousand, apr12, 31)).toBe(100_000n)
  })

  it('daily compounds over the days in the month', () => {
    expect(periodInterest('daily', thousand, apr12, 30)).toBe(99_102n)
    expect(periodInterest('daily', thousand, apr12, 31)).toBe(102_422n)
  })

  it('daily_simple is principal times APR over 365 times the days', () => {
    expect(periodInterest('daily_simple', thousand, apr12, 30)).toBe(98_630n)
  })

  it('is zero for a zero rate', () => {
    for (const mode of ['monthly', 'daily', 'daily_simple'] as const) {
      expect(periodInterest(mode, thousand, 0n, 31)).toBe(0n)
    }
  })
})

describe('defaults leave the plan alone', () => {
  const base = [
    debt({ id: 'a', balance: '5000', apr: '24', minimumPayment: '150' }),
    debt({ id: 'b', balance: '1200', apr: '8', minimumPayment: '50' }),
    debt({ id: 'c', balance: '8000', apr: '6', minimumPayment: '200' }),
  ]
  const spelled = base.map((d) => ({
    ...d, repaymentStartsOn: null, promoApr: null, promoEndsOn: null, promoDeferredInterest: false,
    promoInterestBase: 'original' as const, compounding: 'monthly' as const,
  }))

  it('gives the same plan with the new fields spelled out as their defaults', () => {
    for (const strategy of ['snowball', 'avalanche'] as const) {
      expect(plan(spelled, '100', strategy)).toEqual(plan(base, '100', strategy))
    }
  })

  it('reports no timeline on a plain debt', () => {
    const [first] = plan(base).debts
    expect(first).toMatchObject({ repaymentStartsOn: null, repaymentStartMonth: 1, compounding: 'monthly', promo: null })
  })
})

describe('a deferred loan', () => {
  const loan = debt({ id: 'loan', balance: '10000', apr: '6', minimumPayment: '100', repaymentStartsOn: '2027-04-10' })

  it('starts repaying in the first month whose payment is on or after the date', () => {
    expect(plan([loan]).debts[0]).toMatchObject({ repaymentStartsOn: '2027-04-10', repaymentStartMonth: 6 })
  })

  it('accrues interest into the balance and pays nothing until then', () => {
    const p = plan([loan])
    const balances = p.schedule.slice(0, 5).map((m) => m.balance)
    expect(balances).toEqual(['10050.0000', '10100.2500', '10150.7513', '10201.5051', '10252.5126'])
    expect(p.schedule.slice(0, 5).every((m) => m.payment === '0.0000')).toBe(true)
    expect(p.schedule[5]?.payment).toBe('100.0000')
  })

  it('treats a start date inside the first month as not deferred', () => {
    expect(plan([{ ...loan, repaymentStartsOn: '2026-11-05' }]).debts[0]?.repaymentStartMonth).toBe(1)
    expect(plan([{ ...loan, repaymentStartsOn: '2026-11-10' }]).debts[0]?.repaymentStartMonth).toBe(1)
    expect(plan([{ ...loan, repaymentStartsOn: '2026-11-11' }]).debts[0]?.repaymentStartMonth).toBe(2)
  })

  it('is skipped by the pooled money, which goes to the next debt', () => {
    const card = debt({ id: 'card', balance: '3000', apr: '10', minimumPayment: '60' })
    const p = plan([loan, card], '200')
    // Avalanche would aim at the 10% card anyway; make the loan the higher rate.
    const hot = plan([{ ...loan, apr: '30' }, card], '200')
    expect(row(hot, 1, 'loan').payment).toBe('0.0000')
    expect(row(hot, 1, 'card').payment).toBe('260.0000')
    expect(row(hot, 5, 'loan').payment).toBe('0.0000')
    expect(row(hot, 6, 'loan').payment).not.toBe('0.0000')
    expect(p.debts.find((d) => d.id === 'loan')?.repaymentStartMonth).toBe(6)
  })

  it('adds its minimum to the pool in its start month', () => {
    const card = debt({ id: 'card', balance: '30000', apr: '10', minimumPayment: '60' })
    const p = plan([loan, card], '200')
    expect(p.schedule[4]?.payment).toBe('260.0000')
    expect(p.schedule[5]?.payment).toBe('360.0000')
    expect(p.monthlyBudget).toBe('260.0000')
  })

  it('can be paid early by its earmark', () => {
    const p = plan([{ ...loan, extraPayment: '300' }])
    expect(row(p, 1, 'loan').payment).toBe('300.0000')
  })

  it('never adds a minimum to the pool if it is paid off first', () => {
    const small = debt({ id: 'small', balance: '500', apr: '0', minimumPayment: '40', repaymentStartsOn: '2027-04-10', extraPayment: '600' })
    const card = debt({ id: 'card', balance: '30000', apr: '0', minimumPayment: '60' })
    const p = plan([small, card], '200')
    expect(p.debts.find((d) => d.id === 'small')?.payoffMonth).toBe(1)
    expect(p.schedule[8]?.payment).toBe('260.0000')
  })

  it('counts a settled deferred debt as nothing owed', () => {
    const p = plan([{ ...loan, balance: '0' }])
    expect(p.schedule).toEqual([])
    expect(p.debts[0]).toMatchObject({ repaymentStartsOn: '2027-04-10', repaymentStartMonth: 6 })
  })

  it('keeps the minimums-only comparison honest about the deferral', () => {
    const p = plan([loan])
    expect(p.minimumsOnly.capped).toBe(false)
    expect(p.minimumsOnly.months).toBeGreaterThan(5)
  })
})

describe('compounding', () => {
  const loan = debt({ id: 'loan', balance: '10000', apr: '6', minimumPayment: '100', repaymentStartsOn: '2027-04-10' })

  it('daily_simple charges deferred interest on the starting principal only', () => {
    const p = plan([{ ...loan, compounding: 'daily_simple' }])
    expect(p.schedule.slice(0, 5).map((m) => m.interest)).toEqual([
      '50.9589', '49.3151', '50.9589', '50.9589', '46.0274',
    ])
    expect(p.schedule[4]?.balance).toBe('10248.2192')
  })

  it('daily compounds on the growing balance, so it costs more than daily_simple', () => {
    const daily = plan([{ ...loan, compounding: 'daily' }])
    const simple = plan([{ ...loan, compounding: 'daily_simple' }])
    expect(BigInt(daily.schedule[4]!.balance.replace('.', ''))).toBeGreaterThan(BigInt(simple.schedule[4]!.balance.replace('.', '')))
  })

  it('uses the real days in each month', () => {
    const feb = buildPayoffPlan(
      [debt({ id: 'x', balance: '1000', apr: '12', minimumPayment: '0', compounding: 'daily_simple' })],
      { strategy: 'avalanche', extraPayment: '0', startDate: '2027-01-31' },
    )
    // 2027-01-31 to 2027-02-28 is 28 days.
    expect(feb.schedule[0]?.interest).toBe('9.2055')
  })
})

describe('a promotion without deferred interest', () => {
  const promo = debt({ id: 'p', balance: '1000', apr: '20', minimumPayment: '100', promoApr: '0', promoEndsOn: '2027-01-10' })

  it('charges the promotional rate, then the standard rate', () => {
    const p = plan([promo])
    // Payments dated 2026-11-10, 12-10 and 2027-01-10 are inside the promotion.
    expect(p.schedule.slice(0, 3).map((m) => m.interest)).toEqual(['0.0000', '0.0000', '0.0000'])
    expect(p.schedule[3]?.interest).toBe('11.6667')
    expect(p.debts[0]?.promo).toMatchObject({ active: true, deferredInterest: false, requiredPayment: null, backdatedInterest: '0.0000' })
  })

  it('treats a promotion that ended before the first payment as over', () => {
    const p = plan([{ ...promo, promoEndsOn: '2026-10-20' }])
    expect(p.schedule[0]?.interest).toBe('16.6667')
    expect(p.debts[0]?.promo).toMatchObject({ active: false, clearedInTime: null })
  })
})

describe('deferred interest on a promotion', () => {
  const card = debt({
    id: 'card', balance: '1200', apr: '24.99', minimumPayment: '25',
    promoApr: '0', promoEndsOn: '2027-10-10', promoDeferredInterest: true,
  })

  it('adds interest back to the start when the balance is not cleared in time', () => {
    const p = plan([card])
    const promo = p.debts[0]?.promo
    expect(promo).toMatchObject({
      active: true, clearedInTime: false, backdatedInterest: '299.8800', requiredPayment: '100.0000', shortfall: '75.0000',
    })
    expect(p.schedule[11]?.balance).toBe('1199.8800')
    expect(p.schedule[11]?.interest).toBe('299.8800')
    expect(p.debts[0]?.totalInterest).toBeDefined()
  })

  it('charges on the falling balance when asked', () => {
    const p = plan([{ ...card, promoInterestBase: 'declining' }])
    expect(p.debts[0]?.promo?.backdatedInterest).toBe('265.5189')
    expect(p.debts[0]?.promo?.interestBase).toBe('declining')
  })

  it('pays what is needed to clear it in time when the budget allows', () => {
    const p = plan([card], '75')
    expect(p.debts[0]?.promo).toMatchObject({ clearedInTime: true, backdatedInterest: '0.0000', shortfall: '0.0000' })
    expect(p.debts[0]?.payoffMonth).toBe(12)
    expect(p.totalInterest).toBe('0.0000')
  })

  it('takes the required payment before the strategy, so the strategy cannot trigger the charge', () => {
    const hot = debt({ id: 'hot', balance: '4000', apr: '29.99', minimumPayment: '90' })
    const p = plan([card, hot], '100')
    // 100 extra and the card needs 75 above its minimum: 75 goes to the card, 25 to the hot card.
    expect(row(p, 1, 'card').payment).toBe('100.0000')
    expect(row(p, 1, 'hot').payment).toBe('115.0000')
    expect(p.debts.find((d) => d.id === 'card')?.promo?.clearedInTime).toBe(true)
  })

  it('serves the earliest deadline first when the budget cannot cover them all', () => {
    const later = { ...card, id: 'later', promoEndsOn: '2028-10-10' }
    const p = plan([later, card], '50')
    expect(row(p, 1, 'card').payment).toBe('75.0000')
    expect(row(p, 1, 'later').payment).toBe('25.0000')
  })

  it('counts an earmark toward what is needed', () => {
    const p = plan([{ ...card, extraPayment: '75' }])
    expect(p.debts[0]?.promo).toMatchObject({ clearedInTime: true, shortfall: '0.0000' })
  })

  it('does not apply to the minimums-only comparison', () => {
    const p = plan([card])
    expect(p.minimumsOnly.totalInterest).toBe(p.totalInterest)
  })
})

describe('validation', () => {
  const base = debt({ id: 'x', balance: '100', apr: '5', minimumPayment: '10' })
  const run = (over: Partial<DebtInput>) => () => plan([{ ...base, ...over }])

  it('wants a promotion rate and end date together', () => {
    expect(run({ promoApr: '0' })).toThrow(/both a rate and an end date/)
    expect(run({ promoEndsOn: '2027-01-01' })).toThrow(/both a rate and an end date/)
  })

  it('refuses deferred interest with no promotion', () => {
    expect(run({ promoDeferredInterest: true })).toThrow(/needs a promotion/)
  })

  it('refuses unknown options and bad dates', () => {
    expect(run({ compounding: 'weekly' as never })).toThrow(/Unknown compounding/)
    expect(run({ promoApr: '0', promoEndsOn: '2027-01-01', promoInterestBase: 'x' as never })).toThrow(/Unknown interest base/)
    expect(run({ repaymentStartsOn: '2027-02-30' })).toThrow(RangeError)
    expect(run({ promoApr: '-1', promoEndsOn: '2027-01-01' })).toThrow(/promotional APR cannot be negative/)
  })
})
