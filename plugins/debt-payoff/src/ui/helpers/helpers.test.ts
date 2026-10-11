import { describe, expect, it } from 'vitest'
import { buildPayoffPlan } from '../../shared/index.js'
import { buildChartModel, OTHER_BAND_ID } from './buildChartModel.js'
import { checkDraft } from './checkDraft.js'
import { colorFor } from './colorFor.js'
import { describeMonth } from './describeMonth.js'
import { draftBody } from './draftBody.js'
import { draftFromDebt } from './draftFromDebt.js'
import { durationText } from './durationText.js'
import { EMPTY_DRAFT } from './EMPTY_DRAFT.js'
import { labelStep } from './labelStep.js'
import { moneyProblem } from './moneyProblem.js'
import { niceTicks } from './niceTicks.js'
import { rateProblem } from './rateProblem.js'
import { readMonth } from './readMonth.js'
import { makeDebt } from '../testing/makeDebt.js'

const money = (v: string) => `$${v}`

function planOf(debts: ReturnType<typeof makeDebt>[], strategy: 'snowball' | 'avalanche' = 'avalanche', extra = '0') {
  return buildPayoffPlan(
    debts.map((d) => ({ id: d.id, name: d.name, balance: d.balance, apr: d.apr, minimumPayment: d.minimumPayment })),
    { strategy, extraPayment: extra, startDate: '2026-10-10' },
  )
}

describe('moneyProblem and rateProblem', () => {
  it.each(['250', '250.00', '0', ' 12.3456 ', '0.0001'])('accepts %j', (text) => {
    expect(moneyProblem(text)).toBeNull()
  })
  it.each([
    ['', 'Enter an amount.'],
    ['1,500', 'at most four decimal places'],
    ['$5', 'at most four decimal places'],
    ['-5', 'at most four decimal places'],
    ['1.23456', 'at most four decimal places'],
    ['1e3', 'at most four decimal places'],
    ['9'.repeat(16), 'too large'],
  ])('refuses %j', (text, why) => {
    expect(moneyProblem(text)).toContain(why)
  })
  it('limits a rate to 999.9999%', () => {
    expect(rateProblem('999.9999')).toBeNull()
    expect(rateProblem('1000')).toContain('999.9999%')
    expect(rateProblem('')).toContain('Use 0')
  })
})

describe('checkDraft', () => {
  it('puts each problem on its own field', () => {
    const errors = checkDraft({ ...EMPTY_DRAFT, name: '  ', balance: 'abc', apr: '', minimumPayment: '10' })
    expect(Object.keys(errors.fields).sort()).toEqual(['apr', 'balance', 'name'])
    expect(errors.form).toBeNull()
  })
  it('refuses a name over 100 characters', () => {
    const errors = checkDraft({ ...EMPTY_DRAFT, name: 'x'.repeat(101), balance: '1', apr: '1', minimumPayment: '1' })
    expect(errors.fields['name']).toContain('100')
  })
  it('passes a good form', () => {
    const errors = checkDraft({ ...EMPTY_DRAFT, name: 'Visa', balance: '1,000'.replace(',', ''), apr: '24.99', minimumPayment: '35' })
    expect(errors.fields).toEqual({})
  })
})

describe('draft conversion', () => {
  it('fills the form to the cent, with the rate trimmed', () => {
    expect(draftFromDebt(makeDebt({ name: 'Visa', balance: '1234.5000', apr: '24.9900', minimumPayment: '35.0000' }))).toMatchObject({
      name: 'Visa', balance: '1234.50', apr: '24.99', minimumPayment: '35.00', accountId: '', archived: false,
    })
    expect(draftFromDebt(makeDebt({ apr: '0.0000' })).apr).toBe('0')
    expect(draftFromDebt(makeDebt({ apr: '12.0000' })).apr).toBe('12')
    // Sub-cent precision is never rounded away by editing.
    expect(draftFromDebt(makeDebt({ balance: '10.1250' })).balance).toBe('10.1250')
  })
  it('sends text, trimmed, and only an edit may archive', () => {
    const draft = { ...EMPTY_DRAFT, name: ' Visa ', balance: ' 10.5 ', apr: '1', minimumPayment: '2', accountId: '', archived: true }
    expect(draftBody(draft, false)).toEqual({ name: 'Visa', balance: '10.5', apr: '1', minimumPayment: '2', accountId: null })
    expect(draftBody(draft, true)).toMatchObject({ archived: true })
  })
})

describe('durationText', () => {
  it.each([[0, '0 months'], [1, '1 month'], [11, '11 months'], [12, '1 year'], [13, '1 year 1 month'], [30, '2 years 6 months']])(
    '%i is %j', (months, text) => { expect(durationText(months)).toBe(text) },
  )
})

describe('axis helpers', () => {
  it('niceTicks start at zero and reach the maximum', () => {
    for (const max of [1, 37, 1234.5, 48_000, 2_500_000]) {
      const ticks = niceTicks(max)
      expect(ticks[0]).toBe(0)
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max)
      expect(ticks.length).toBeLessThanOrEqual(8)
    }
    expect(niceTicks(0)).toEqual([0, 1])
  })
  it('labelStep spaces labels out as the plot narrows', () => {
    expect(labelStep(13, 800)).toBe(1)
    expect(labelStep(601, 300)).toBeGreaterThan(100)
    expect(labelStep(1, 300)).toBe(1)
  })
  it('gives the first six debts a colour of their own and the rest grey', () => {
    expect(colorFor(0)).toBe('var(--wm-chart-1)')
    expect(colorFor(5)).toBe('var(--wm-chart-6)')
    expect(colorFor(6)).toBe('var(--wm-chart-other)')
  })
})

describe('buildChartModel', () => {
  const small = makeDebt({ name: 'Small', balance: '300', apr: '10', minimumPayment: '50' })
  const big = makeDebt({ name: 'Big', balance: '2000', apr: '20', minimumPayment: '60' })

  it('has one value per band per point, starting at today and ending at zero', () => {
    const plan = planOf([small, big], 'snowball', '100')
    const colors = new Map([[small.id, colorFor(0)], [big.id, colorFor(1)]])
    const model = buildChartModel(plan, colors)!
    expect(model.dates).toHaveLength(plan.schedule.length + 1)
    expect(model.dates[0]).toBe('2026-10-10')
    for (const band of model.bands) expect(band.values).toHaveLength(model.dates.length)
    expect(model.totals[0]).toBe(2300)
    expect(model.totals[model.totals.length - 1]).toBe(0)
    expect(model.max).toBe(2300)
  })

  it('stacks the debt paid first on top, and keeps each debt its own colour', () => {
    const colors = new Map([[small.id, colorFor(0)], [big.id, colorFor(1)]])
    const snow = buildChartModel(planOf([small, big], 'snowball', '100'), colors)!
    expect(snow.bands.map((b) => b.name)).toEqual(['Big', 'Small'])
    const aval = buildChartModel(planOf([small, big], 'avalanche', '100'), colors)!
    expect(aval.bands.map((b) => b.name)).toEqual(['Small', 'Big'])
    const colorOf = (m: typeof snow, name: string) => m.bands.find((b) => b.name === name)?.color
    expect(colorOf(snow, 'Small')).toBe(colorOf(aval, 'Small'))
    expect(colorOf(snow, 'Big')).toBe(colorOf(aval, 'Big'))
  })

  it('totals match the plan balance every month', () => {
    const plan = planOf([small, big], 'avalanche', '75')
    const model = buildChartModel(plan, new Map([[small.id, colorFor(0)], [big.id, colorFor(1)]]))!
    plan.schedule.forEach((m, i) => {
      expect(model.totals[i + 1]).toBeCloseTo(Number(m.balance), 3)
    })
  })

  it('folds debts without a colour into one grey band at the bottom', () => {
    const many = Array.from({ length: 9 }, (_, i) => makeDebt({ name: `D${i}`, balance: '500', minimumPayment: '60' }))
    const colors = new Map(many.map((d, i) => [d.id, colorFor(i)] as const))
    const model = buildChartModel(planOf(many), colors)!
    expect(model.bands).toHaveLength(7)
    expect(model.bands[0]?.id).toBe(OTHER_BAND_ID)
    expect(model.bands[0]?.name).toBe('3 other debts')
    expect(model.bands[0]?.values[0]).toBe(1500)
  })

  it('is null when nothing is owed', () => {
    const paid = makeDebt({ balance: '0' })
    expect(buildChartModel(planOf([paid]), new Map())).toBeNull()
  })
})

describe('readMonth and describeMonth', () => {
  const a = makeDebt({ name: 'Card', balance: '250', apr: '12', minimumPayment: '100' })
  const plan = planOf([a])
  const model = buildChartModel(plan, new Map([[a.id, colorFor(0)]]))!

  it('describes today and a payment month in a sentence', () => {
    const today = readMonth(plan, model, 0, money)
    expect(describeMonth(today, (d) => d)).toBe('Today, 2026-10-10: $250.0000 still owed.')
    const last = readMonth(plan, model, plan.schedule.length, money)
    expect(last.clearedNames).toEqual(['Card'])
    expect(describeMonth(last, (d) => d)).toContain('Paid off: Card.')
    expect(last.rows).toEqual([])
  })
})
