import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { moneyToUnits } from '@wickermoney/plugin-sdk/money'
import { describe, expect, it } from 'vitest'
import { buildPayoffPlan } from './buildPayoffPlan.js'
import type { DebtInput } from './DebtInput.js'
import { identityCorpus, planDigest } from './identityCorpus.js'
import type { LumpSumInput } from './LumpSumInput.js'
import type { PayoffPlan } from './PayoffPlan.js'
import { STRATEGIES } from './STRATEGIES.js'
import type { Strategy } from './Strategy.js'
import { whatIfLumpSum } from './whatIfLumpSum.js'

const START = '2026-10-10'

const debt = (id: string, balance: string, apr: string, minimumPayment: string, extra: Partial<DebtInput> = {}): DebtInput => ({
  id, name: id, balance, apr, minimumPayment, ...extra,
})

// The three debts the other strategy tests use: a is the highest rate, b the smallest balance, c the biggest.
const a = debt('a', '5000', '24', '150')
const b = debt('b', '1200', '8', '50')
const c = debt('c', '8000', '6', '200')

const lump = (onDate: string, amount: string, allocations?: LumpSumInput['allocations'], id = 'l1'): LumpSumInput => ({
  id, onDate, amount, ...(allocations === undefined ? {} : { allocations }),
})

const plan = (debts: readonly DebtInput[], strategy: Strategy, lumpSums?: readonly LumpSumInput[], extraPayment = '300'): PayoffPlan =>
  buildPayoffPlan(debts, { strategy, extraPayment, startDate: START, ...(lumpSums === undefined ? {} : { lumpSums }) })

const paymentTo = (p: PayoffPlan, month: number, debtId: string): string | undefined =>
  p.schedule[month - 1]?.debts.find((d) => d.debtId === debtId)?.payment

const units = (value: string | undefined): bigint => moneyToUnits(value ?? '0')

/** The same plan without the report of its lump sums. */
const withoutReport = ({ lumpSums: _ignored, ...rest }: PayoffPlan): Omit<PayoffPlan, 'lumpSums'> => rest

describe('all defaults: no lump sums, no change', () => {
  const corpus = identityCorpus()
  const digests = (file: string): Record<string, string> =>
    JSON.parse(readFileSync(join(import.meta.dirname, file), 'utf8')) as Record<string, string>
  const expected = { ...digests('identityDigests.json'), ...digests('identityDigestsCustom.json') }

  it('has a digest for every case under all three strategies', () => {
    expect(Object.keys(expected)).toHaveLength(corpus.length * STRATEGIES.length)
  })

  it.each(STRATEGIES)('builds byte-identical %s plans for every corpus case, given no lump sums', (strategy) => {
    // The custom-order digests were produced by the engine at origin/main 4832692, before lump sums existed.
    const mismatches = corpus.filter((c) => planDigest(c, strategy) !== expected[`${c.name} ${strategy}`]).map((c) => c.name)
    expect(mismatches).toEqual([])
  })

  it.each(STRATEGIES)('is the same bytes with an empty list, and has no lumpSums field (%s)', (strategy) => {
    for (const c of corpus) {
      const plain = buildPayoffPlan(c.debts, { strategy, extraPayment: c.extraPayment, startDate: c.startDate })
      const empty = buildPayoffPlan(c.debts, { strategy, extraPayment: c.extraPayment, startDate: c.startDate, lumpSums: [] })
      expect(JSON.stringify(empty)).toBe(JSON.stringify(plain))
      expect('lumpSums' in plain).toBe(false)
    }
  })

  it.each(STRATEGIES)('is unchanged when every lump sum is dated in the past (%s)', (strategy) => {
    for (const c of corpus) {
      const plain = buildPayoffPlan(c.debts, { strategy, extraPayment: c.extraPayment, startDate: c.startDate })
      const past = buildPayoffPlan(c.debts, {
        strategy, extraPayment: c.extraPayment, startDate: c.startDate,
        lumpSums: [lump('2000-01-01', '500', undefined, 'old1'), lump('2026-01-01', '250', undefined, 'old2')],
      })
      expect(JSON.stringify(withoutReport(past))).toBe(JSON.stringify(plain))
      expect(past.lumpSums?.map((o) => o.status)).toEqual(['past', 'past'])
    }
  })

  it('is not an empty check: the corpus has deferment, promotions, earmarks and daily interest', () => {
    const debts = corpus.flatMap((c) => c.debts)
    expect(debts.some((d) => d.repaymentStartsOn !== undefined)).toBe(true)
    expect(debts.some((d) => d.promoDeferredInterest === true)).toBe(true)
    expect(debts.some((d) => d.extraPayment !== undefined)).toBe(true)
    expect(debts.some((d) => d.compounding === 'daily_simple')).toBe(true)
    expect(new Set(Object.values(expected)).size).toBe(corpus.length * STRATEGIES.length)
  })
})

describe('where a lump sum lands in time', () => {
  const monthOf = (onDate: string) => plan([a, b, c], 'avalanche', [lump(onDate, '100')]).lumpSums?.[0]

  it('is paid on the first payment date on or after its date', () => {
    expect(monthOf('2026-10-10')).toMatchObject({ status: 'applied', month: 1, date: '2026-11-10' })
    expect(monthOf('2026-10-11')).toMatchObject({ month: 1, date: '2026-11-10' })
    expect(monthOf('2026-11-10')).toMatchObject({ month: 1, date: '2026-11-10' })
    expect(monthOf('2026-11-11')).toMatchObject({ month: 2, date: '2026-12-10' })
    expect(monthOf('2026-12-10')).toMatchObject({ month: 2, date: '2026-12-10' })
    expect(monthOf('2026-12-11')).toMatchObject({ month: 3, date: '2027-01-10' })
  })

  it('is paid at the end of month 1 when it is dated today, and never before', () => {
    const p = plan([a, b, c], 'avalanche', [lump('2026-10-10', '1000')])
    expect(units(paymentTo(p, 1, 'a'))).toBe(units('1450'))
  })

  it('follows a month that is clamped to a short month', () => {
    const jan31 = buildPayoffPlan([a], {
      strategy: 'avalanche', extraPayment: '300', startDate: '2026-01-31', lumpSums: [lump('2026-02-28', '100')],
    })
    expect(jan31.lumpSums?.[0]).toMatchObject({ month: 1, date: '2026-02-28' })
  })

  it('ignores one dated before the start date, says so, and changes nothing', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump('2026-10-09', '5000')])
    expect(p.lumpSums).toEqual([{
      id: 'l1', onDate: '2026-10-09', amount: '5000.0000', status: 'past', month: null, date: null,
      paid: '0.0000', unused: '5000.0000',
    }])
    expect(JSON.stringify(withoutReport(p))).toBe(JSON.stringify(base))
  })

  it('ignores one past the last month the plan covers', () => {
    const p = plan([a], 'avalanche', [lump('2100-01-01', '100')])
    expect(p.lumpSums?.[0]).toMatchObject({ status: 'beyond_limit', month: null, paid: '0.0000', unused: '100.0000' })
    expect(JSON.stringify(withoutReport(p))).toBe(JSON.stringify(plan([a], 'avalanche')))
  })

  it('reports a lump sum that comes after every debt is paid as applied with nothing used', () => {
    const only = debt('only', '100', '0', '100')
    const p = plan([only], 'avalanche', [lump('2027-01-10', '50')], '0')
    expect(p.months).toBe(1)
    expect(p.lumpSums?.[0]).toMatchObject({ status: 'applied', month: 3, paid: '0.0000', unused: '50.0000' })
  })
})

describe('which debt a lump sum goes to', () => {
  const ON = '2026-12-10' // plan month 2

  it('goes to the debt the strategy is aiming at: avalanche, the highest rate', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '1000')])
    expect(units(paymentTo(p, 2, 'a'))).toBe(units(paymentTo(base, 2, 'a')) + units('1000'))
    expect(paymentTo(p, 2, 'b')).toBe(paymentTo(base, 2, 'b'))
    expect(paymentTo(p, 2, 'c')).toBe(paymentTo(base, 2, 'c'))
  })

  it('goes to the smallest balance under snowball', () => {
    const base = plan([a, b, c], 'snowball')
    const p = plan([a, b, c], 'snowball', [lump(ON, '500')])
    expect(units(paymentTo(p, 2, 'b'))).toBe(units(paymentTo(base, 2, 'b')) + units('500'))
    expect(paymentTo(p, 2, 'a')).toBe(paymentTo(base, 2, 'a'))
  })

  it('goes to the first debt in the person\'s own list under custom order', () => {
    const base = plan([c, b, a], 'custom')
    const p = plan([c, b, a], 'custom', [lump(ON, '700')])
    expect(units(paymentTo(p, 2, 'c'))).toBe(units(paymentTo(base, 2, 'c')) + units('700'))
    expect(paymentTo(p, 2, 'a')).toBe(paymentTo(base, 2, 'a'))
  })

  it('rolls down the order when the first debt cannot take it all', () => {
    const tiny = debt('tiny', '100', '0', '10')
    const p = plan([tiny, a], 'custom', [lump('2026-11-10', '1000')], '0')
    expect(p.debts.find((d) => d.id === 'tiny')?.payoffMonth).toBe(1)
    // tiny owes 100 after interest, minus its 10 minimum: 90 of the lump sum, 910 to a.
    expect(paymentTo(p, 1, 'tiny')).toBe('100.0000')
    expect(units(paymentTo(p, 1, 'a'))).toBe(units('150') + units('910'))
    expect(p.lumpSums?.[0]).toMatchObject({ paid: '1000.0000', unused: '0.0000' })
  })

  it('goes to the debt named when it is allocated', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '1000', [{ debtId: 'c', amount: '1000' }])])
    expect(units(paymentTo(p, 2, 'c'))).toBe(units(paymentTo(base, 2, 'c')) + units('1000'))
    expect(paymentTo(p, 2, 'a')).toBe(paymentTo(base, 2, 'a'))
  })

  it('splits between allocated parts and the strategy for what is left', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '1000', [{ debtId: 'c', amount: '400' }, { debtId: 'b', amount: '100' }])])
    expect(units(paymentTo(p, 2, 'c'))).toBe(units(paymentTo(base, 2, 'c')) + units('400'))
    expect(units(paymentTo(p, 2, 'b'))).toBe(units(paymentTo(base, 2, 'b')) + units('100'))
    expect(units(paymentTo(p, 2, 'a'))).toBe(units(paymentTo(base, 2, 'a')) + units('500'))
  })

  it('sends what an allocated debt cannot take on to the strategy', () => {
    const small = debt('small', '100', '0', '10')
    const p = plan([a, small], 'avalanche', [lump('2026-11-10', '500', [{ debtId: 'small', amount: '500' }])], '0')
    expect(p.debts.find((d) => d.id === 'small')?.payoffMonth).toBe(1)
    expect(p.lumpSums?.[0]).toMatchObject({ paid: '500.0000', unused: '0.0000' })
    expect(units(paymentTo(p, 1, 'a'))).toBeGreaterThan(units('150'))
  })

  it('treats an allocation to a debt that is not in the plan as unallocated', () => {
    const base = plan([a, b], 'avalanche')
    const p = plan([a, b], 'avalanche', [lump(ON, '600', [{ debtId: 'not-in-plan', amount: '600' }])])
    expect(units(paymentTo(p, 2, 'a'))).toBe(units(paymentTo(base, 2, 'a')) + units('600'))
  })

  it('applies to the same debt as an earmark in one month, both capped at the balance', () => {
    const earmarked = debt('e', '300', '0', '10', { extraPayment: '100' })
    const p = plan([earmarked, a], 'avalanche', [lump('2026-11-10', '1000', [{ debtId: 'e', amount: '1000' }])], '0')
    // 10 minimum + 100 earmark + 190 of the lump sum clears it; the other 810 goes to a.
    expect(paymentTo(p, 1, 'e')).toBe('300.0000')
    expect(p.debts.find((d) => d.id === 'e')?.payoffMonth).toBe(1)
    expect(p.lumpSums?.[0]).toMatchObject({ paid: '1000.0000', unused: '0.0000' })
  })

  it('applies several lump sums in a month in the order given', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '100', undefined, 'x'), lump(ON, '200', undefined, 'y')])
    expect(units(paymentTo(p, 2, 'a'))).toBe(units(paymentTo(base, 2, 'a')) + units('300'))
    expect(p.lumpSums?.map((o) => o.id)).toEqual(['x', 'y'])
  })

  it('is not part of the monthly pool: the next month pays what it always did and nothing rolls', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '1000')])
    expect(p.monthlyBudget).toBe(base.monthlyBudget)
    // Month 3 is the same total payment: the lump sum was a one-off.
    expect(p.schedule[2]?.payment).toBe(base.schedule[2]?.payment)
    expect(p.schedule[1]?.payment).not.toBe(base.schedule[1]?.payment)
  })

  it('still rolls freed minimums when a lump sum clears a debt early', () => {
    const base = plan([b, a], 'snowball')
    const p = plan([b, a], 'snowball', [lump('2026-11-10', '5000', [{ debtId: 'b', amount: '5000' }])])
    expect(p.debts.find((d) => d.id === 'b')?.payoffMonth).toBe(1)
    // From month 2 b's minimum is aimed at a: a is paid the whole pool.
    expect(units(paymentTo(p, 2, 'a'))).toBe(units('150') + units('50') + units('300'))
    expect(base.debts.find((d) => d.id === 'b')?.payoffMonth).toBeGreaterThan(1)
  })

  it('leaves the minimums-only comparison alone', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '1000')])
    expect(p.minimumsOnly).toEqual(base.minimumsOnly)
  })

  it('pays a deferred debt only when it is named, never by the strategy', () => {
    const deferred = debt('d', '1000', '30', '50', { repaymentStartsOn: '2027-06-01' })
    const byStrategy = plan([deferred, b], 'avalanche', [lump('2026-11-10', '400')])
    expect(paymentTo(byStrategy, 1, 'd')).toBe('0.0000')
    const named = plan([deferred, b], 'avalanche', [lump('2026-11-10', '400', [{ debtId: 'd', amount: '400' }])])
    expect(paymentTo(named, 1, 'd')).toBe('400.0000')
  })

  it('saves interest and brings the date forward', () => {
    const base = plan([a, b, c], 'avalanche')
    const p = plan([a, b, c], 'avalanche', [lump(ON, '3000')])
    expect(units(p.totalInterest)).toBeLessThan(units(base.totalInterest))
    expect(p.months).toBeLessThan(base.months)
  })

  it('does not modify its input and gives the same plan every time', () => {
    const lumps = [lump(ON, '1000', [{ debtId: 'c', amount: '100' }])]
    const copy = structuredClone(lumps)
    const first = JSON.stringify(plan([a, b, c], 'avalanche', lumps))
    expect(lumps).toEqual(copy)
    expect(JSON.stringify(plan([a, b, c], 'avalanche', lumps))).toBe(first)
  })
})

describe('what a lump sum reports', () => {
  it('always adds up: paid plus unused is the amount, across the corpus', () => {
    for (const c of identityCorpus()) {
      for (const strategy of STRATEGIES) {
        const p = buildPayoffPlan(c.debts, {
          strategy, extraPayment: c.extraPayment, startDate: c.startDate,
          lumpSums: [
            lump('2026-12-01', '700.50', undefined, 'x'),
            lump('2028-03-15', '90000', undefined, 'y'),
            lump('2035-06-01', '10', c.debts[0] === undefined ? undefined : [{ debtId: c.debts[0].id, amount: '4' }], 'z'),
          ],
        })
        for (const o of p.lumpSums ?? []) expect(units(o.paid) + units(o.unused)).toBe(units(o.amount))
        for (const month of p.schedule) for (const line of month.debts) expect(units(line.balance)).toBeGreaterThanOrEqual(0n)
        if (!p.capped) expect(p.schedule.at(-1)?.balance ?? '0.0000').toBe('0.0000')
      }
    }
  })
})

describe('refuses what it cannot read', () => {
  const run = (lumpSums: readonly LumpSumInput[]) => () => plan([a], 'avalanche', lumpSums)

  it('refuses a duplicate or empty id', () => {
    expect(run([lump(START, '1'), lump(START, '2')])).toThrow(/Duplicate lump sum id/)
    expect(run([lump(START, '1', undefined, '')])).toThrow(/needs an id/)
  })

  it('refuses a date that is not on the calendar', () => {
    expect(run([lump('2026-02-30', '10')])).toThrow()
    expect(run([lump('soon', '10')])).toThrow()
  })

  it('refuses an amount that is zero, negative, a number or has too many places', () => {
    expect(run([lump(START, '0')])).toThrow(/more than zero/)
    expect(run([lump(START, '-5')])).toThrow()
    expect(run([lump(START, 100 as unknown as string)])).toThrow()
    expect(run([lump(START, '1.00001')])).toThrow()
  })

  it('refuses parts that add up to more than the whole, a repeated debt, or a part of nothing', () => {
    expect(run([lump(START, '100', [{ debtId: 'a', amount: '60' }, { debtId: 'b', amount: '60' }])])).toThrow(/more than the lump sum/)
    expect(run([lump(START, '100', [{ debtId: 'a', amount: '10' }, { debtId: 'a', amount: '10' }])])).toThrow(/only once/)
    expect(run([lump(START, '100', [{ debtId: 'a', amount: '0' }])])).toThrow(/more than zero/)
    expect(run([lump(START, '100', [{ debtId: '', amount: '10' }])])).toThrow(/needs a debt/)
  })

  it('accepts parts that add up to exactly the whole', () => {
    expect(run([lump(START, '100', [{ debtId: 'a', amount: '60' }, { debtId: 'b', amount: '40' }])])).not.toThrow()
  })
})

describe('what-if preview', () => {
  const debts = [a, b, c]
  const options = { strategy: 'avalanche' as const, extraPayment: '300', startDate: START }
  const candidate = lump('2026-12-10', '3000', undefined, 'candidate')

  it('shows the debt-free date and interest saved against the current plan', () => {
    const result = whatIfLumpSum(debts, options, candidate)
    const now = buildPayoffPlan(debts, options)
    const saved = buildPayoffPlan(debts, { ...options, lumpSums: [candidate] })
    expect(result.current).toEqual({ debtFreeDate: now.debtFreeDate, months: now.months, totalInterest: now.totalInterest, capped: false })
    expect(result.withLumpSum.debtFreeDate).toBe(saved.debtFreeDate)
    expect(result.withLumpSum.totalInterest).toBe(saved.totalInterest)
    expect(units(result.interestSaved ?? '0')).toBe(units(now.totalInterest) - units(saved.totalInterest))
    expect(units(result.interestSaved ?? '0')).toBeGreaterThan(0n)
    expect(result.monthsSaved).toBe(now.months - saved.months)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.lumpSum).toMatchObject({ id: 'candidate', status: 'applied', month: 2, paid: '3000.0000' })
  })

  it('compares against the plan with the saved lump sums, so the difference is the candidate alone', () => {
    const savedOne = lump('2026-11-10', '2000', undefined, 'saved')
    const withSaved = { ...options, lumpSums: [savedOne] }
    const result = whatIfLumpSum(debts, withSaved, candidate)
    const now = buildPayoffPlan(debts, withSaved)
    expect(result.current.totalInterest).toBe(now.totalInterest)
    const both = buildPayoffPlan(debts, { ...options, lumpSums: [savedOne, candidate] })
    expect(result.withLumpSum.totalInterest).toBe(both.totalInterest)
  })

  it('saves nothing: it is a pure function and does not touch its input', () => {
    const copy = structuredClone({ debts, options, candidate })
    const first = JSON.stringify(whatIfLumpSum(debts, options, candidate))
    expect({ debts, options, candidate }).toEqual(copy)
    expect(JSON.stringify(whatIfLumpSum(debts, options, candidate))).toBe(first)
  })

  it('is the same under every strategy as saving the lump sum', () => {
    for (const strategy of STRATEGIES) {
      const opts = { ...options, strategy }
      const result = whatIfLumpSum(debts, opts, candidate)
      expect(result.withLumpSum.totalInterest).toBe(buildPayoffPlan(debts, { ...opts, lumpSums: [candidate] }).totalInterest)
    }
  })

  it('says a past-dated candidate does nothing', () => {
    const result = whatIfLumpSum(debts, options, lump('2026-01-01', '9999', undefined, 'candidate'))
    expect(result.lumpSum.status).toBe('past')
    expect(result.interestSaved).toBe('0.0000')
    expect(result.monthsSaved).toBe(0)
    expect(result.withLumpSum).toEqual(result.current)
  })

  it('has no comparison when either plan never ends', () => {
    const stuck = debt('s', '100000', '30', '1')
    const result = whatIfLumpSum([stuck], { ...options, extraPayment: '0' }, lump('2026-11-10', '10', undefined, 'candidate'))
    expect(result.current.capped).toBe(true)
    expect(result.interestSaved).toBeNull()
    expect(result.monthsSaved).toBeNull()
  })

  it('refuses an invalid candidate the way the plan does', () => {
    expect(() => whatIfLumpSum(debts, options, lump('2026-12-10', '0', undefined, 'candidate'))).toThrow(/more than zero/)
    expect(() => whatIfLumpSum(debts, { ...options, lumpSums: [candidate] }, candidate)).toThrow(/Duplicate/)
  })
})
