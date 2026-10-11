import { describe, expect, it } from 'vitest'
import { buildPayoffPlan } from './buildPayoffPlan.js'
import type { DebtInput } from './DebtInput.js'
import { MAX_PLAN_MONTHS } from './MAX_PLAN_MONTHS.js'
import type { PayoffPlan } from './PayoffPlan.js'
import type { Strategy } from './Strategy.js'

/**
 * The expected figures below were produced by an independent implementation of
 * the same stated rules (decimal arithmetic with an explicit half-up rounding,
 * not this module's integer formulation), so a match is evidence the rules are
 * implemented as written and not merely that the code agrees with itself.
 */

const debt = (id: string, balance: string, apr: string, minimumPayment: string, name = id): DebtInput => ({
  id, name, balance, apr, minimumPayment,
})

const START = '2026-10-10'

function plan(debts: readonly DebtInput[], strategy: Strategy, extraPayment = '0', startDate = START): PayoffPlan {
  return buildPayoffPlan(debts, { strategy, extraPayment, startDate })
}

const card = debt('card', '1000', '12', '100')

const three = [
  debt('a', '5000', '24', '150', 'Big card'),
  debt('b', '1200', '8', '50', 'Small card'),
  debt('c', '8000', '6', '200', 'Loan'),
]

describe('one debt at a time', () => {
  it('amortises 1,000.00 at 12% with 100.00 a month over 11 months', () => {
    const p = plan([card], 'avalanche', '0', '2026-01-31')

    expect(p.months).toBe(11)
    expect(p.totalInterest).toBe('58.9848')
    expect(p.totalPaid).toBe('1058.9848')
    expect(p.debtFreeDate).toBe('2026-12-31')
    expect(p.schedule[0]).toMatchObject({ month: 1, interest: '10.0000', payment: '100.0000', balance: '910.0000' })
    expect(p.schedule[1]).toMatchObject({ month: 2, interest: '9.1000', balance: '819.1000' })
    // The last payment is the balance plus that month's interest, not the minimum.
    expect(p.schedule[10]).toMatchObject({ month: 11, interest: '0.5840', payment: '58.9848', balance: '0.0000' })
    expect(p.debts[0]).toMatchObject({ payoffMonth: 11, payoffDate: '2026-12-31', totalInterest: '58.9848' })
  })

  it('dates each payment from the start date, clamping to the end of a short month', () => {
    const p = plan([card], 'avalanche', '0', '2026-01-31')
    expect(p.schedule.slice(0, 3).map((m) => m.date)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('accrues on the opening balance and pays at the end of the month', () => {
    // A 50.00 balance at 18% owes 0.75 after one month; the 100.00 minimum clears it.
    const p = plan([debt('o', '50', '18', '100')], 'avalanche')
    expect(p.months).toBe(1)
    expect(p.schedule[0]).toMatchObject({ interest: '0.7500', payment: '50.7500', balance: '0.0000' })
    expect(p.debtFreeDate).toBe('2026-11-10')
    expect(p.totalPaid).toBe('50.7500')
  })

  it('pays off in one month when the minimum covers the balance and its interest', () => {
    const p = plan([debt('t', '99.50', '0', '100')], 'snowball')
    expect(p.months).toBe(1)
    expect(p.debts[0]).toMatchObject({ payoffMonth: 1, totalPaid: '99.5000' })
  })

  it('charges no interest at a zero rate', () => {
    const p = plan([debt('z', '1000', '0', '300')], 'snowball')
    expect(p.months).toBe(4)
    expect(p.totalInterest).toBe('0.0000')
    expect(p.schedule.map((m) => m.payment)).toEqual(['300.0000', '300.0000', '300.0000', '100.0000'])
    expect(p.debtFreeDate).toBe('2027-02-10')
    expect(p.debts[0]?.minimumCoversInterest).toBe(true)
  })

  it('rounds interest to 0.0001 half away from zero, once a month', () => {
    const p = plan([debt('r', '333.33', '19.99', '25')], 'avalanche')
    expect(p.schedule[0]).toMatchObject({ interest: '5.5527', balance: '313.8827' })
    expect(p.schedule[1]).toMatchObject({ interest: '5.2288', balance: '294.1115' })
    expect(p.months).toBe(16)
    expect(p.totalInterest).toBe('46.7761')
    expect(p.schedule[15]).toMatchObject({ payment: '5.1061', balance: '0.0000' })
  })
})

describe('snowball and avalanche', () => {
  it('snowball aims at the smallest balance first', () => {
    const p = plan(three, 'snowball', '300')

    expect(p.order).toEqual(['b', 'a', 'c'])
    expect(p.monthlyBudget).toBe('700.0000')
    expect(p.debts.map((d) => [d.id, d.payoffMonth])).toEqual([['b', 4], ['a', 15], ['c', 23]])
    expect(p.months).toBe(23)
    expect(p.totalInterest).toBe('1575.7031')
    expect(p.totalPaid).toBe('15775.7031')
    expect(p.debtFreeDate).toBe('2028-09-10')
    expect(p.schedule[0]).toMatchObject({ interest: '148.0000', payment: '700.0000', balance: '13648.0000' })
    expect(p.schedule[22]).toMatchObject({ interest: '1.8692', payment: '375.7031', balance: '0.0000' })
  })

  it('avalanche aims at the highest rate first', () => {
    const p = plan(three, 'avalanche', '300')

    expect(p.order).toEqual(['a', 'b', 'c'])
    expect(p.debts.map((d) => [d.id, d.payoffMonth])).toEqual([['a', 13], ['b', 14], ['c', 23]])
    expect(p.months).toBe(23)
    expect(p.totalInterest).toBe('1415.9216')
    expect(p.totalPaid).toBe('15615.9216')
    expect(p.schedule[1]).toMatchObject({ interest: '139.9200' })
    expect(p.schedule[22]).toMatchObject({ interest: '1.0742', payment: '215.9216' })
  })

  it('costs the avalanche less interest than the snowball on the same debts', () => {
    const snow = plan(three, 'snowball', '300')
    const aval = plan(three, 'avalanche', '300')
    expect(snow.totalInterest).toBe('1575.7031')
    expect(aval.totalInterest).toBe('1415.9216')
  })

  it('rolls a freed minimum into the next debt in line', () => {
    const p = plan(three, 'snowball', '300')
    // Debt b is paid in month 4. From month 5 its 50.00 minimum is no longer
    // paid to b, yet the same 700.00 is still paid, all of it to a and c.
    const month5 = p.schedule[4]
    expect(month5?.debts.map((d) => d.debtId)).toEqual(['a', 'c'])
    expect(month5?.payment).toBe('700.0000')
    // While a is the target, c is held to its minimum.
    expect(month5?.debts.find((d) => d.debtId === 'c')?.payment).toBe('200.0000')
    expect(month5?.debts.find((d) => d.debtId === 'a')?.payment).toBe('500.0000')
  })

  it('keeps paying the same amount each month until the final payment', () => {
    const p = plan(three, 'avalanche', '300')
    for (const month of p.schedule.slice(0, -1)) expect(month.payment).toBe(p.monthlyBudget)
    expect(Number(p.schedule.at(-1)?.payment)).toBeLessThanOrEqual(Number(p.monthlyBudget))
  })

  it('applies the leftover of a small final payment to the next debt in the same month', () => {
    // Small clears with 40.00 of its 100.00 minimum; the other 60.00 and the
    // large debt's own 20.00 minimum all go to Large that month.
    const p = plan([debt('s', '40', '0', '100'), debt('l', '500', '0', '20')], 'snowball')
    expect(p.schedule[0]).toMatchObject({ payment: '120.0000', balance: '420.0000' })
    expect(p.schedule[0]?.debts).toEqual([
      { debtId: 's', interest: '0.0000', payment: '40.0000', balance: '0.0000' },
      { debtId: 'l', interest: '0.0000', payment: '80.0000', balance: '420.0000' },
    ])
    expect(p.debts.map((d) => [d.id, d.payoffMonth])).toEqual([['s', 1], ['l', 5]])
    expect(p.totalPaid).toBe('540.0000')
  })

  it('does not pay more than a debt owes when the extra is larger than every balance', () => {
    const p = plan([debt('a', '100', '0', '10'), debt('b', '200', '0', '10')], 'snowball', '10000')
    expect(p.months).toBe(1)
    expect(p.totalPaid).toBe('300.0000')
    expect(p.schedule[0]?.debts.map((d) => d.balance)).toEqual(['0.0000', '0.0000'])
  })
})

describe('extra payment and what it saves', () => {
  it('compares against paying only each debt its own minimum', () => {
    const p = plan(three, 'snowball', '300')
    expect(p.minimumsOnly).toEqual({ months: 56, totalInterest: '4382.2555', debtFreeDate: '2031-06-10', capped: false })
    expect(p.monthsSaved).toBe(33)
    expect(p.interestSaved).toBe('2806.5524')
  })

  it('saves nothing for one debt paid its minimum', () => {
    const p = plan([card], 'avalanche')
    expect(p.monthsSaved).toBe(0)
    expect(p.interestSaved).toBe('0.0000')
  })

  it('does not roll minimums over in the minimums-only comparison', () => {
    const p = plan([debt('s', '40', '0', '100'), debt('l', '500', '0', '20')], 'snowball')
    // Large keeps paying 20.00 on its own: 25 months, against 5 with the freed minimum.
    expect(p.minimumsOnly.months).toBe(25)
    expect(p.months).toBe(5)
    expect(p.monthsSaved).toBe(20)
  })

  it('shortens the plan the more is added', () => {
    const lengths = ['0', '50', '150', '600'].map((extra) => plan(three, 'avalanche', extra).months)
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a))
    expect(new Set(lengths).size).toBe(4)
  })
})

describe('ties', () => {
  it('snowball breaks a tie in balance toward the higher rate', () => {
    const p = plan([debt('x', '1000', '10', '50'), debt('y', '1000', '20', '50')], 'snowball', '100')
    expect(p.order).toEqual(['y', 'x'])
    expect(p.debts.map((d) => [d.id, d.payoffMonth])).toEqual([['y', 8], ['x', 11]])
    expect(p.totalInterest).toBe('134.0145')
  })

  it('avalanche breaks a tie in rate toward the smaller balance', () => {
    const p = plan([debt('x', '2000', '15', '50'), debt('y', '1000', '15', '50')], 'avalanche', '100')
    expect(p.order).toEqual(['y', 'x'])
    expect(p.debts.map((d) => [d.id, d.payoffMonth])).toEqual([['y', 8], ['x', 17]])
    expect(p.totalInterest).toBe('343.2038')
  })

  it('keeps the order given when two debts are identical, for both strategies', () => {
    const twins = [debt('first', '500', '10', '25'), debt('second', '500', '10', '25')]
    expect(plan(twins, 'snowball').order).toEqual(['first', 'second'])
    expect(plan(twins, 'avalanche').order).toEqual(['first', 'second'])
    expect(plan([...twins].reverse(), 'snowball').order).toEqual(['second', 'first'])
  })

  it('gives the same plan for the same input every time', () => {
    expect(plan(three, 'snowball', '300')).toEqual(plan(three, 'snowball', '300'))
  })
})

describe('limits', () => {
  it('stops at the month limit and reports no debt-free date', () => {
    // Interest of 250.00 a month against a 100.00 minimum: it only grows.
    const p = plan([debt('u', '10000', '30', '100')], 'avalanche')

    expect(p.capped).toBe(true)
    expect(p.cappedReason).toBe('month_limit')
    expect(p.monthLimit).toBe(MAX_PLAN_MONTHS)
    expect(p.months).toBe(MAX_PLAN_MONTHS)
    expect(p.schedule).toHaveLength(MAX_PLAN_MONTHS)
    expect(p.debtFreeDate).toBeNull()
    expect(p.debts[0]).toMatchObject({ payoffMonth: null, payoffDate: null, minimumCoversInterest: false })
    expect(p.totalInterest).toBe('16310674783.3003')
    expect(p.totalPaid).toBe('60000.0000')
    expect(p.schedule[0]).toMatchObject({ interest: '250.0000', balance: '10150.0000' })
    expect(p.schedule.at(-1)?.balance).toBe('16310624783.3003')
    expect(p.monthsSaved).toBeNull()
    expect(p.interestSaved).toBeNull()
  })

  it('shows the plan finishing when only the minimums-only comparison is capped', () => {
    const p = plan([debt('u', '10000', '30', '100')], 'avalanche', '2000')
    expect(p.capped).toBe(false)
    expect(p.minimumsOnly).toMatchObject({ capped: true, debtFreeDate: null, months: MAX_PLAN_MONTHS })
    expect(p.monthsSaved).toBeNull()
    expect(p.debtFreeDate).not.toBeNull()
  })

  it('finishes a 30-year loan inside the limit', () => {
    // 300,000.00 at 6.5% with the usual 30-year payment, rounded to the cent
    // (the exact figure is 1,896.2041...). Rounding the payment down leaves a
    // 4.5277 remainder for a 361st month.
    const p = plan([debt('m', '300000', '6.5', '1896.20')], 'avalanche')
    expect(p.capped).toBe(false)
    expect(p.months).toBe(361)
    expect(p.totalInterest).toBe('382636.5277')
    expect(p.schedule.at(-1)).toMatchObject({ payment: '4.5277', balance: '0.0000' })
  })

  it('stops before a balance outgrows what the database can store', () => {
    const p = plan([debt('x', '10000', '999.9999', '0')], 'avalanche')

    expect(p.capped).toBe(true)
    expect(p.cappedReason).toBe('balance_limit')
    expect(p.months).toBeLessThan(MAX_PLAN_MONTHS)
    expect(p.debtFreeDate).toBeNull()
    for (const month of p.schedule) expect(month.balance.length).toBeLessThanOrEqual(21)
  })

  it('never pays a debt that has no minimum and no extra', () => {
    const p = plan([debt('n', '100', '0', '0')], 'snowball')
    expect(p.capped).toBe(true)
    expect(p.totalPaid).toBe('0.0000')
    expect(p.debts[0]?.payoffMonth).toBeNull()
  })

  it('pays a debt with no minimum once extra money is aimed at it', () => {
    const p = plan([debt('n', '100', '0', '0')], 'snowball', '40')
    expect(p.months).toBe(3)
    expect(p.debtFreeDate).toBe('2027-01-10')
  })
})

describe('debts that need no plan', () => {
  it('has an empty schedule and is debt free on the start date when there are no debts', () => {
    const p = plan([], 'avalanche', '100')
    expect(p).toMatchObject({
      months: 0, schedule: [], order: [], debts: [], capped: false, debtFreeDate: START,
      startingBalance: '0.0000', totalInterest: '0.0000', totalPaid: '0.0000', monthlyBudget: '100.0000',
      monthsSaved: 0, interestSaved: '0.0000',
    })
  })

  it('treats a debt already at zero as paid, without its minimum or a place in line', () => {
    const p = plan([debt('done', '0', '19.99', '35'), card], 'snowball', '0')
    expect(p.order).toEqual(['card'])
    expect(p.monthlyBudget).toBe('100.0000')
    expect(p.debts.map((d) => d.id)).toEqual(['card', 'done'])
    expect(p.debts[1]).toMatchObject({ payoffMonth: 0, payoffDate: START, totalPaid: '0.0000', startingBalance: '0.0000' })
    expect(p.schedule.every((m) => m.debts.every((d) => d.debtId === 'card'))).toBe(true)
  })

  it('is debt free on the start date when every balance is zero', () => {
    const p = plan([debt('a', '0', '10', '20'), debt('b', '0.00', '0', '0')], 'snowball', '50')
    expect(p).toMatchObject({ months: 0, debtFreeDate: START, schedule: [], capped: false })
  })
})

describe('what the plan does not do', () => {
  it('does not modify its input', () => {
    const input = three.map((d) => ({ ...d }))
    const frozen = Object.freeze(input.map((d) => Object.freeze(d)))
    expect(() => plan(frozen, 'snowball', '300')).not.toThrow()
    expect(input).toEqual(three)
  })

  it('returns every amount as a string', () => {
    const p = plan(three, 'avalanche', '300')
    const amounts = [p.extraPayment, p.monthlyBudget, p.startingBalance, p.totalInterest, p.totalPaid]
    for (const m of p.schedule) amounts.push(m.interest, m.payment, m.balance)
    for (const d of p.debts) amounts.push(d.startingBalance, d.apr, d.minimumPayment, d.totalInterest, d.totalPaid)
    for (const value of amounts) expect(value).toMatch(/^\d+\.\d{4}$/)
  })
})

describe('invariants over varied inputs', () => {
  /** A small deterministic generator, so a failure is reproducible from its seed. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
  }

  const cents = (n: number): string => (n / 100).toFixed(2)

  it('conserves money: what was owed plus interest equals what was paid, month by month', () => {
    const random = lcg(20261010)
    for (let run = 0; run < 150; run += 1) {
      const count = 1 + Math.floor(random() * 6)
      const debts = Array.from({ length: count }, (_, i) =>
        debt(`d${i}`, cents(Math.floor(random() * 2_000_000)), (random() * 35).toFixed(2), cents(Math.floor(random() * 30_000))),
      )
      const strategy: Strategy = random() < 0.5 ? 'snowball' : 'avalanche'
      const p = plan(debts, strategy, cents(Math.floor(random() * 50_000)))

      let previous = BigInt(p.startingBalance.replace('.', ''))
      for (const m of p.schedule) {
        const next = BigInt(m.balance.replace('.', ''))
        const interest = BigInt(m.interest.replace('.', ''))
        const payment = BigInt(m.payment.replace('.', ''))
        expect(previous + interest - payment).toBe(next)
        expect(next).toBeGreaterThanOrEqual(0n)
        expect(payment).toBeLessThanOrEqual(BigInt(p.monthlyBudget.replace('.', '')))
        previous = next
      }
      const owed = BigInt(p.startingBalance.replace('.', ''))
      const interest = BigInt(p.totalInterest.replace('.', ''))
      const paid = BigInt(p.totalPaid.replace('.', ''))
      expect(owed + interest - paid).toBe(previous)
      if (!p.capped) expect(previous).toBe(0n)
      expect(p.schedule.length).toBe(p.months)
    }
  })

  it('never takes longer than minimums only, and never costs more interest, when the minimums cover the interest', () => {
    const random = lcg(777)
    for (let run = 0; run < 100; run += 1) {
      const debts = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => {
        const balance = 10_000 + Math.floor(random() * 1_000_000)
        const apr = (random() * 30).toFixed(2)
        // A minimum that covers the interest and a slice of principal, so even
        // minimums-only finishes inside the month limit and can be compared.
        const minimum = Math.ceil((balance * Number(apr)) / 1200) + Math.ceil(balance / 100) + 500
        return debt(`d${i}`, cents(balance), apr, cents(minimum))
      })
      const p = plan(debts, random() < 0.5 ? 'snowball' : 'avalanche', cents(Math.floor(random() * 20_000)))
      expect(p.capped).toBe(false)
      expect(p.monthsSaved).toBeGreaterThanOrEqual(0)
      expect(BigInt(p.interestSaved!.replace('.', ''))).toBeGreaterThanOrEqual(0n)
    }
  })

  it('never costs the avalanche more interest than the snowball', () => {
    const random = lcg(31337)
    for (let run = 0; run < 100; run += 1) {
      const debts = Array.from({ length: 2 + Math.floor(random() * 4) }, (_, i) => {
        const balance = 50_000 + Math.floor(random() * 1_000_000)
        const apr = (random() * 30).toFixed(2)
        return debt(`d${i}`, cents(balance), apr, cents(Math.ceil((balance * Number(apr)) / 1200) + 1_000))
      })
      const extra = cents(Math.floor(random() * 30_000))
      const snow = plan(debts, 'snowball', extra)
      const aval = plan(debts, 'avalanche', extra)
      expect(BigInt(aval.totalInterest.replace('.', ''))).toBeLessThanOrEqual(BigInt(snow.totalInterest.replace('.', '')))
    }
  })
})

describe('validation', () => {
  const good = [card]
  const bad = (change: Partial<DebtInput>) => () => plan([{ ...card, ...change }], 'avalanche')

  it.each([
    ['a negative balance', { balance: '-1' }],
    ['a negative minimum', { minimumPayment: '-5' }],
    ['a negative rate', { apr: '-1' }],
    ['a rate over 999.9999', { apr: '1000' }],
    ['a fifth decimal place', { balance: '10.00001' }],
    ['a rate with a fifth decimal place', { apr: '19.99999' }],
    ['a thousands separator', { balance: '1,000.00' }],
    ['an empty amount', { minimumPayment: '' }],
    ['a balance beyond numeric(19,4)', { balance: '1000000000000000' }],
    ['an empty id', { id: '' }],
  ])('refuses %s', (_label, change) => {
    expect(bad(change)).toThrow(RangeError)
  })

  it('refuses a number where an amount belongs', () => {
    expect(bad({ balance: 1000 as unknown as string })).toThrow(RangeError)
  })

  it('refuses a duplicate id', () => {
    expect(() => plan([card, { ...card }], 'avalanche')).toThrow(/Duplicate debt id/)
  })

  it('refuses an unknown strategy', () => {
    expect(() => plan(good, 'whatever' as Strategy)).toThrow(/Unknown strategy/)
  })

  it('refuses a negative or malformed extra payment', () => {
    expect(() => plan(good, 'avalanche', '-1')).toThrow(RangeError)
    expect(() => plan(good, 'avalanche', 'lots')).toThrow(RangeError)
  })

  it('refuses a start date that is not a calendar date, even with nothing to plan', () => {
    expect(() => plan(good, 'avalanche', '0', '2026-02-30')).toThrow(RangeError)
    expect(() => plan([], 'avalanche', '0', 'tomorrow')).toThrow(RangeError)
  })

  it('accepts the largest rate and the largest amount', () => {
    expect(() => plan([debt('x', '999999999999999.9999', '999.9999', '999999999999999.9999')], 'avalanche')).not.toThrow()
  })
})
